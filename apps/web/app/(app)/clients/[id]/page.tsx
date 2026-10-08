"use client";

import { Check, Lock } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SCENARIO_PROMPTS } from "@/components/home/scenarios";
import { Badge, Button, ErrorNote, Skeleton } from "@/components/ui";
import { ConversationArea } from "@/components/workspace/conversation-area";
import { ContextPanel } from "@/components/workspace/context-panel";
import { useWorkspace } from "@/components/workspace/context";
import { EvidenceDrawer } from "@/components/workspace/evidence-drawer";
import { XrayToggle } from "@/components/workspace/xray";
import { ApiError } from "@/lib/api";
import { accentFor, initialsOf, periodLabel } from "@/lib/format";
import { useCancelExecution, useClientProfile, useClients, useConversation, useSources, useSubmitTurn } from "@/lib/hooks";
import { useSession } from "@/lib/session";

const STARTERS = [
  "Compare our last two Pinterest campaigns. Explain what changed and suggest what we should try next.",
  "What worked best in our creative so far?",
  "Create a performance report for our last two Pinterest campaigns.",
];

function Workspace() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const session = useSession();
  const { setActiveExecutionId, clearAttachments, closeEvidence, setGeekTurns } = useWorkspace();

  const profile = useClientProfile(id);
  const clients = useClients();
  const sources = useSources();
  const conversation = useConversation(id);
  const submit = useSubmitTurn(id);
  const cancel = useCancelExecution(id);

  const [sendError, setSendError] = useState<string | null>(null);
  const scenarioStarted = useRef(false);

  const turns = conversation.data?.turns ?? [];
  const client = clients.data?.find((c) => c.id === id);
  const allSources = useMemo(() => sources.data ?? [], [sources.data]);
  const attachable = useMemo(() => allSources.filter((s) => s.clientId === id), [allSources, id]);

  // Reset per-client UI state when switching clients.
  useEffect(() => {
    clearAttachments();
    closeEvidence();
    scenarioStarted.current = false;
  }, [id, clearAttachments, closeEvidence]);

  // The panel can step between this conversation's turns.
  useEffect(() => {
    setGeekTurns(turns.filter((t) => t.executionId).map((t) => ({ executionId: t.executionId!, seq: t.seq, label: t.userMessage })));
  }, [turns, setGeekTurns]);

  // Reconnect to the latest run after a refresh or navigation.
  useEffect(() => {
    const last = turns[turns.length - 1];
    setActiveExecutionId(last?.executionId ?? null);
  }, [turns, setActiveExecutionId]);

  const send = useCallback(
    async (message: string, attachmentSourceIds: string[], referencedVersionId?: string, key?: string) => {
      setSendError(null);
      try {
        const result = await submit.mutateAsync({ message, attachmentSourceIds, referencedVersionId, key });
        setActiveExecutionId(result.executionId);
      } catch (error) {
        setSendError(error instanceof ApiError ? error.message : "The request could not be sent.");
      }
    },
    [submit, setActiveExecutionId],
  );

  // A guided scenario starts once, with a stable key so a reload or double render cannot send it twice.
  useEffect(() => {
    const scenario = search.get("scenario");
    if (!scenario || scenarioStarted.current || !conversation.data) return;
    const prompt = scenario === "evidence" ? SCENARIO_PROMPTS.evidence : scenario === "memory" ? SCENARIO_PROMPTS.memory : null;
    scenarioStarted.current = true;
    router.replace(`/clients/${id}`);
    if (prompt && !conversation.data.turns.some((t) => t.userMessage === prompt)) {
      void send(prompt, [], `scenario-${scenario}-${session.agencyId}`);
    }
  }, [search, conversation.data, router, id, send, session.agencyId]);

  const accent = accentFor(profile.data?.slug ?? "");

  if (profile.isError) {
    const notFound = profile.error instanceof ApiError && profile.error.status === 404;
    return (
      <div className="p-8">
        <ErrorNote title={notFound ? "That client is not in this demo" : "This client could not load"} action={<Button onClick={() => router.push("/")}>Back to clients</Button>}>
          {notFound ? "The link may be from an earlier demo. Pick a client from the home screen." : "Nothing was changed."}
        </ErrorNote>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* Top bar: client identity and reporting period */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-surface px-5 py-3">
        {profile.data ? (
          <>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-xs font-medium text-white" style={{ backgroundColor: accent }} aria-hidden>
              {initialsOf(profile.data.name)}
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-[18px] font-medium leading-tight">{profile.data.name}</h1>
              <p className="truncate text-xs text-text-muted">{profile.data.category} · {periodLabel(profile.data.reportingPeriod)}</p>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
            {client && (
              <ul className="flex flex-wrap items-center gap-1.5" aria-label="Sharing for cross-client analysis">
                <li><Badge tone={client.sharing.performancePatterns ? "success" : "danger"}>{client.sharing.performancePatterns ? <Check size={11} aria-hidden /> : <Lock size={11} aria-hidden />} Performance patterns {client.sharing.performancePatterns ? "approved" : "restricted"}</Badge></li>
                <li><Badge tone={client.sharing.creativeAssets ? "success" : "danger"}>{client.sharing.creativeAssets ? <Check size={11} aria-hidden /> : <Lock size={11} aria-hidden />} Creative assets {client.sharing.creativeAssets ? "approved" : "restricted"}</Badge></li>
              </ul>
            )}
            <XrayToggle />
            </div>
          </>
        ) : (
          <><Skeleton className="h-9 w-9" /><Skeleton className="h-8 w-56" /></>
        )}
      </div>
      <ContextPanel clientId={id} />

      <ConversationArea
        turns={turns}
        isLoading={conversation.isLoading}
        isError={conversation.isError}
        onReload={() => conversation.refetch()}
        sources={allSources}
        attachable={attachable}
        accentSlug={profile.data?.slug ?? ""}
        emptyTitle={`What would you like to know about ${profile.data?.name ?? "this client"}?`}
        emptyHint="The workspace already holds the brand voice, goals, and campaign data. Just ask, or start from a suggestion."
        starters={STARTERS}
        send={(message, attachments, referenced) => send(message, attachments, referenced)}
        cancel={(executionId) => cancel.mutate(executionId)}
        submitting={submit.isPending}
        sendError={sendError}
        resetKey={id}
      />

      <EvidenceDrawer />
    </div>
  );
}

export default function ClientPage() {
  return (
    <Suspense fallback={<div className="p-6"><Skeleton className="h-8 w-64" /></div>}>
      <Workspace />
    </Suspense>
  );
}
