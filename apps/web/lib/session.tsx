"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { ApiError, api, setCsrfToken } from "./api";

interface SessionInfo {
  agencyId: string;
  expiresAt: string;
  csrfToken: string;
}

type State =
  | { status: "loading" }
  | { status: "ready"; session: SessionInfo }
  | { status: "error"; message: string };

const SessionContext = createContext<SessionInfo | null>(null);
export const useSession = () => {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used inside a ready SessionProvider.");
  return session;
};

// One bootstrap per page load, even when React runs effects twice in development.
let bootstrap: Promise<SessionInfo> | null = null;

async function ensureSession(): Promise<SessionInfo> {
  try {
    return await api<SessionInfo>("/session");
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
  }
  // No usable session: open the demo. The backend seeds a private agency of fictional clients.
  return api<SessionInfo>("/session", { method: "POST", body: {} });
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    bootstrap ??= ensureSession();
    let cancelled = false;
    bootstrap.then(
      (session) => {
        setCsrfToken(session.csrfToken);
        if (!cancelled) setState({ status: "ready", session });
      },
      (error: unknown) => {
        bootstrap = null;
        if (!cancelled) setState({ status: "error", message: error instanceof Error ? error.message : "Could not start the demo." });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (state.status === "ready") return <SessionContext.Provider value={state.session}>{children}</SessionContext.Provider>;

  return (
    <main className="grid min-h-screen place-items-center p-8">
      <div className="max-w-sm text-center" role="status" aria-live="polite">
        <p className="font-serif text-xl italic text-teal">Exhibit A</p>
        {state.status === "loading" ? (
          <>
            <h1 className="mt-3 text-lg font-medium">Setting up your demo agency</h1>
            <p className="mt-1 text-sm text-text-muted">Loading three fictional clothing brands with synthetic data. No signup needed.</p>
            <div className="skeleton mx-auto mt-6 h-2 w-48" />
          </>
        ) : (
          <>
            <h1 className="mt-3 text-lg font-medium">The demo could not start</h1>
            <p className="mt-1 text-sm text-text-muted" role="alert">{state.message}</p>
            <button
              onClick={() => {
                setState({ status: "loading" });
                setAttempt((n) => n + 1);
              }}
              className="mt-5 h-10 rounded-[var(--radius-control)] bg-teal px-4 text-sm font-medium text-white hover:bg-teal-dark"
            >
              Try again
            </button>
          </>
        )}
      </div>
    </main>
  );
}
