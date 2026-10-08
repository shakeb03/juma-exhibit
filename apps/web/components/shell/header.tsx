"use client";

import { Menu, RotateCcw } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { api, setCsrfToken } from "@/lib/api";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui";
import { useWorkspace } from "@/components/workspace/context";

/** A small bracket mark and a text wordmark. The app shell stays neutral; clients carry the colour. */
export function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2 rounded-md" aria-label="Exhibit A, home">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M8 4H5v16h3M16 4h3v16h-3" stroke="var(--color-teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M9.5 16l2.5-8 2.5 8M10.4 13.5h3.2" stroke="var(--color-text)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="whitespace-nowrap text-[17px] font-medium tracking-tight">Exhibit A</span>
    </Link>
  );
}

const NAV = [
  { href: "/", label: "Client workspaces", short: "Clients", match: (p: string) => p === "/" || p.startsWith("/clients") },
  { href: "/intelligence", label: "Intelligence canvas", short: "Canvas", match: (p: string) => p.startsWith("/intelligence") },
];

export function Header() {
  const pathname = usePathname();
  const { setSidebarOpen, sidebarOpen } = useWorkspace();
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function startOver() {
    setResetting(true);
    try {
      await api("/session", { method: "DELETE" });
    } catch {
      /* the session may already be gone; reloading opens a fresh one either way */
    }
    setCsrfToken(null);
    window.location.href = "/";
  }

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 sm:gap-4 sm:px-4 desk:px-6">
      <Wordmark />
      <nav aria-label="Workspaces" className="flex min-w-0 items-center gap-0.5 sm:ml-2 sm:gap-1">
        {NAV.map((item) => {
          const active = item.match(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "min-h-9 whitespace-nowrap rounded-full px-2.5 py-1.5 text-sm font-medium transition-colors sm:px-3.5",
                active ? "bg-aqua text-text" : "text-text-muted hover:bg-surface-muted hover:text-text",
              )}
            >
              <span className="sm:hidden">{item.short}</span>
              <span className="hidden sm:inline">{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        <span className="hidden text-xs text-text-muted sm:inline">Demo agency · synthetic data</span>
        {confirming ? (
          <span className="flex items-center gap-2" role="group" aria-label="Confirm start over">
            <span className="hidden text-xs text-text-muted md:inline">Delete this demo and open a fresh one?</span>
            <Button variant="danger" compact onClick={startOver} disabled={resetting}>{resetting ? "Resetting" : "Start over"}</Button>
            <Button compact onClick={() => setConfirming(false)}>Cancel</Button>
          </span>
        ) : (
          <Button variant="ghost" compact onClick={() => setConfirming(true)} aria-label="Start over with a fresh demo agency">
            <RotateCcw size={16} aria-hidden /> <span className="hidden md:inline">Start over</span>
          </Button>
        )}
        <Button
          variant="secondary"
          compact
          className="desk:hidden"
          aria-label={sidebarOpen ? "Close files and run panel" : "Open files and run panel"}
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          <Menu size={16} aria-hidden /> <span className="hidden sm:inline">Files and run</span>
        </Button>
      </div>
    </header>
  );
}
