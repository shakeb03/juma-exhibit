"use client";

import { Check, Lock } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SCENARIO_PROMPTS } from "@/components/home/scenarios";
import { Badge, Button, EmptyState, ErrorNote, Skeleton } from "@/components/ui";
import { ArtifactPane } from "@/components/workspace/artifact-pane";
import { Composer } from "@/components/workspace/composer";
import { ContextPanel } from "@/components/workspace/context-panel";
import { useWorkspace } from "@/components/workspace/context";
import { EvidenceDrawer } from "@/components/workspace/evidence-drawer";
import { TurnView } from "@/components/workspace/turn-view";
import { XrayToggle } from "@/components/workspace/xray";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { accentFor, initialsOf, periodLabel } from "@/lib/format";
import { useCancelExecution, useClientProfile, useClients, useConversation, useSources, useSubmitTurn } from "@/lib/hooks";
import { useSession } from "@/lib/session";
import type { Turn } from "@/lib/types";

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
  const { setActiveExecutionId, fillComposer, clearAttachments, closeEvidence } = useWorkspace();

  const profile = useClientProfile(id);
  const clients = useClients();
  const sources = useSources();
  const conversation = useConversation(id);
  const submit = useSubmitTurn(id);
  const cancel = useCancelExecution(id);

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<"chat" | "artifact">("chat");
  const [sendError, setSendError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const scenarioStarted = useRef(false);

  const turns = conversation.data?.turns ?? [];
  const client = clients.data?.find((c) => c.id === id);
  const allSources = useMemo(() => sources.data ?? [], [sources.data]);
  const sourceMap = useMemo(() => new Map(allSources.map((s) => [s.id, s])), [allSources]);
  const attachable = useMemo(() => allSources.filter((s) => s.clientId === id), [allSources, id]);

  // The latest artifact and the version the user is looking at.
  const lastWithArtifact = [...turns].reverse().find((t) => t.artifact);
  const artifactId = lastWithArtifact?.artifact?.artifactId ?? null;
  const latestVersionId = lastWithArtifact?.artifact?.versionId ?? null;
  const shownVersionId = selectedVersionId ?? latestVersionId;

  const busy = turns.some((t) => t.status === "queued" || t.status === "running");

  // Reset per-client UI state when switching clients.
  useEffect(() => {
    setSelectedVersionId(null);
    clearAttachments();
    closeEvidence();
    scenarioStarted.current = false;
  }, [id, clearAttachments, closeEvidence]);

  // Reconnect to the latest run after a refresh or navigation.
  useEffect(() => {
    const last = turns[turns.length - 1];
    setActiveExecutionId(last?.executionId ?? null);
  }, [turns, setActiveExecutionId]);

  // Keep the newest content in view while the reader is already at the bottom. Scrolling up to read
  // earlier turns is never interrupted: the pane only follows when it was near the end.
  const pinned = useRef(true);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!el || !inner) return;
    const onScroll = () => { pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; };
    el.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(() => { if (pinned.current) el.scrollTop = el.scrollHeight; });
    observer.observe(inner);
    return () => { el.removeEventListener("scroll", onScroll); observer.disconnect(); };
  }, [conversation.isLoading]);
  const lastTurnId = turns[turns.length - 1]?.id;
  useEffect(() => { pinned.current = true; }, [lastTurnId]); // a new request always follows

  // New artifact version from a turn: show the latest.
  const lastArtifactKey = lastWithArtifact?.artifact?.versionId;
  useEffect(() => {
    if (lastArtifactKey) {
      setSelectedVersionId(null);
      setMobileTab("artifact");
    }
  }, [lastArtifactKey]);

  const send = useCallback(
    async (message: string, attachmentSourceIds: string[], key?: string) => {
      setSendError(null);
      try {
        const result = await submit.mutateAsync({ message, attachmentSourceIds, referencedVersionId: shownVersionId ?? undefined, key });
        setActiveExecutionId(result.executionId);
        setMobileTab("chat");
      } catch (error) {
        setSendError(error instanceof ApiError ? error.message : "The request could not be sent.");
      }
    },
    [submit, shownVersionId, setActiveExecutionId],
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

  const lastTurn = turns[turns.length - 1];
  const suggestions = !busy && lastTurn?.status === "succeeded" && lastTurn.replyKind === "answer"
    ? [
        ...(lastTurn.reply?.evidence && Object.keys(lastTurn.reply.evidence).length > 0 ? ["What's your evidence for that?"] : []),
        ...(!lastTurn.artifact ? ["Make that into a performance report."] : ["Focus on conversions.", "Make this ready for the client."]),
      ]
    : [];

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

      {/* Below 768px chat and the artifact become tabs */}
      {artifactId && <div role="tablist" aria-label="Workspace view" className="flex gap-1 border-b border-border bg-surface px-4 py-2 md:hidden">
        {(["chat", "artifact"] as const).map((tab) => (
          <button key={tab} role="tab" aria-selected={mobileTab === tab} onClick={() => setMobileTab(tab)} className={cn("min-h-9 rounded-full px-4 text-sm font-medium", mobileTab === tab ? "bg-aqua" : "text-text-muted")}>
            {tab === "chat" ? "Conversation" : "Artifact"}
          </button>
        ))}
      </div>}

      {/* Until there is an artifact the conversation uses the full width. When one is saved it slides in beside it. */}
      <div className={cn("grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)]", artifactId && "md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]")}>
        {/* Conversation: its own scroll, composer anchored below */}
        <section aria-label="Conversation" className={cn("min-h-0 flex-col md:flex", !artifactId || mobileTab === "chat" ? "flex" : "hidden")}>
          <div ref={scroller} className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-5 py-5" role="log" aria-live="polite" aria-label="Conversation history">
           <div ref={content} className={cn("space-y-6", !artifactId && "mx-auto max-w-[760px]")}>
            {conversation.isLoading && <div className="space-y-3"><Skeleton className="ml-auto h-10 w-2/3" /><Skeleton className="h-24 w-full" /></div>}
            {conversation.isError && <ErrorNote title="The conversation could not load" action={<Button onClick={() => conversation.refetch()}>Try again</Button>}>Saved turns are safe. Only the view failed.</ErrorNote>}
            {!conversation.isLoading && turns.length === 0 && (
              <EmptyState title={`What would you like to know about ${profile.data?.name ?? "this client"}?`}>
                The workspace already holds the brand voice, goals, and campaign data. Just ask, or start from a suggestion.
              </EmptyState>
            )}
            {turns.map((turn: Turn) => (
              <TurnView
                key={turn.id}
                turn={turn}
                sources={sourceMap}
                onOpenVersion={(versionId) => { setSelectedVersionId(versionId === latestVersionId ? null : versionId); setMobileTab("artifact"); }}
                onFill={fillComposer}
                onRetry={(t) => send(t.userMessage, t.attachmentSourceIds)}
                onCancel={(executionId) => cancel.mutate(executionId)}
              />
            ))}
            {turns.length === 0 && !conversation.isLoading && (
              <ul className="flex flex-wrap justify-center gap-2" aria-label="Suggestions">
                {STARTERS.map((text) => (
                  <li key={text}><button onClick={() => fillComposer(text)} className="min-h-9 rounded-full border border-border-strong bg-surface px-3.5 py-1.5 text-left text-sm hover:bg-aqua/60">{text}</button></li>
                ))}
              </ul>
            )}
            {suggestions.length > 0 && (
              <ul className="flex flex-wrap gap-2" aria-label="Suggested follow-ups">
                {suggestions.map((text) => (
                  <li key={text}><button onClick={() => fillComposer(text)} className="min-h-9 rounded-full border border-border-strong bg-surface px-3.5 py-1.5 text-sm hover:bg-aqua/60">{text}</button></li>
                ))}
              </ul>
            )}
           </div>
          </div>
          <div className="shrink-0 border-t border-border bg-background px-4 pb-4 pt-3">
           <div className={cn(!artifactId && "mx-auto max-w-[760px]")}>
            {sendError && <p role="alert" className="mb-2 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{sendError}</p>}
            <Composer sources={allSources} attachable={attachable} disabled={submit.isPending} onSend={(m, a) => send(m, a)} />
           </div>
          </div>
        </section>

        {/* Artifact: its own scroll. Only present once something has been saved. */}
        {artifactId && <section aria-label="Artifact" className={cn("fade-in min-h-0 border-l border-border bg-surface md:flex md:flex-col", mobileTab === "artifact" ? "flex flex-col" : "hidden")}>
          <ArtifactPane
            artifactId={artifactId}
            latestVersionId={latestVersionId}
            selectedVersionId={selectedVersionId}
            onSelectVersion={setSelectedVersionId}
            clientSlug={profile.data?.slug ?? ""}
            onAsk={fillComposer}
          />
        </section>}
      </div>

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
