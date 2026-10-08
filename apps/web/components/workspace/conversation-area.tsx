"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FileText } from "lucide-react";
import { Button, EmptyState, ErrorNote, Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { SourceSummary, Turn } from "@/lib/types";
import { ArtifactPane } from "./artifact-pane";
import { Composer } from "./composer";
import { useWorkspace } from "./context";
import { TurnView } from "./turn-view";

interface Props {
  turns: Turn[];
  isLoading: boolean;
  isError: boolean;
  onReload: () => void;
  /** Files known to this workspace, for naming attachments, and the subset that can be attached. */
  sources: SourceSummary[];
  attachable: SourceSummary[];
  allowAttach?: boolean;
  accentSlug: string;
  /** Heading and hint for an empty conversation. */
  emptyTitle: string;
  emptyHint: ReactNode;
  starters: string[];
  placeholder?: string;
  /** Sends a request. The version being viewed is passed so revisions apply to what the user sees. */
  send: (message: string, attachmentIds: string[], referencedVersionId?: string) => Promise<void>;
  cancel: (executionId: string) => void;
  submitting: boolean;
  sendError: string | null;
  /** Changes when the conversation changes (another client, another chat node), resetting local view state. */
  resetKey: string;
}

/**
 * The conversation and its artifact, side by side. Until an artifact exists the conversation uses the full width;
 * when one is saved it slides in beside it. Shared by client workspaces and canvas chat nodes.
 */
export function ConversationArea(props: Props) {
  const { turns, sources, attachable, accentSlug } = props;
  const { fillComposer, closeEvidence } = useWorkspace();
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<"chat" | "artifact">("chat");
  // Closing hides the artifact without deleting it; it comes back on request or when a new version arrives.
  const [artifactOpen, setArtifactOpen] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  const sourceMap = useMemo(() => new Map(sources.map((s) => [s.id, s])), [sources]);
  const lastWithArtifact = [...turns].reverse().find((t) => t.artifact);
  const artifactId = lastWithArtifact?.artifact?.artifactId ?? null;
  const latestVersionId = lastWithArtifact?.artifact?.versionId ?? null;
  const shownVersionId = selectedVersionId ?? latestVersionId;
  const staleReasons = lastWithArtifact?.reply?.stale ?? [];
  const busy = turns.some((t) => t.status === "queued" || t.status === "running");
  const lastTurn = turns[turns.length - 1];

  useEffect(() => {
    setSelectedVersionId(null);
    setArtifactOpen(true);
    closeEvidence();
  }, [props.resetKey, closeEvidence]);

  // Keep the newest content in view while the reader is already at the bottom. Scrolling up to read earlier turns
  // is never interrupted: the pane only follows when it was near the end.
  useEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!el || !inner) return;
    const onScroll = () => { pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120; };
    el.addEventListener("scroll", onScroll, { passive: true });
    const observer = new ResizeObserver(() => { if (pinned.current) el.scrollTop = el.scrollHeight; });
    observer.observe(inner);
    return () => { el.removeEventListener("scroll", onScroll); observer.disconnect(); };
  }, [props.isLoading]);
  useEffect(() => { pinned.current = true; }, [lastTurn?.id]); // a new request always follows

  // A new artifact version from a turn: show the latest.
  useEffect(() => {
    if (latestVersionId) {
      setSelectedVersionId(null);
      setArtifactOpen(true);
      setMobileTab("artifact");
    }
  }, [latestVersionId]);

  const showArtifact = Boolean(artifactId) && artifactOpen;
  const closeArtifact = () => { setArtifactOpen(false); setMobileTab("chat"); };

  const suggestions =
    !busy && lastTurn?.status === "succeeded" && lastTurn.replyKind === "answer"
      ? [
          ...(lastTurn.reply?.evidence && Object.keys(lastTurn.reply.evidence).length > 0 ? ["What's your evidence for that?"] : []),
          ...(!lastTurn.artifact ? ["Make that into a performance report."] : ["Focus on conversions.", "Make this ready for the client."]),
        ]
      : [];

  const send = async (message: string, attachmentIds: string[]) => {
    await props.send(message, attachmentIds, shownVersionId ?? undefined);
    setMobileTab("chat");
  };

  return (
    <>
      {/* Below 768px chat and the artifact become tabs */}
      {showArtifact && (
        <div role="tablist" aria-label="Workspace view" className="flex gap-1 border-b border-border bg-surface px-4 py-2 md:hidden">
          {(["chat", "artifact"] as const).map((tab) => (
            <button key={tab} role="tab" aria-selected={mobileTab === tab} onClick={() => setMobileTab(tab)} className={cn("min-h-9 rounded-full px-4 text-sm font-medium", mobileTab === tab ? "bg-aqua" : "text-text-muted")}>
              {tab === "chat" ? "Conversation" : "Artifact"}
            </button>
          ))}
        </div>
      )}

      <div className={cn("grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)]", showArtifact && "md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]")}>
        <section aria-label="Conversation" className={cn("min-h-0 flex-col md:flex", !showArtifact || mobileTab === "chat" ? "flex" : "hidden")}>
          <div ref={scroller} className="scroll-quiet min-h-0 flex-1 overflow-y-auto px-5 py-5" role="log" aria-live="polite" aria-label="Conversation history">
            <div ref={content} className={cn("space-y-6", !showArtifact && "mx-auto max-w-[760px]")}>
              {props.isLoading && <div className="space-y-3"><Skeleton className="ml-auto h-10 w-2/3" /><Skeleton className="h-24 w-full" /></div>}
              {props.isError && <ErrorNote title="The conversation could not load" action={<Button onClick={props.onReload}>Try again</Button>}>Saved turns are safe. Only the view failed.</ErrorNote>}
              {!props.isLoading && !props.isError && turns.length === 0 && <EmptyState title={props.emptyTitle}>{props.emptyHint}</EmptyState>}
              {turns.map((turn) => (
                <TurnView
                  key={turn.id}
                  turn={turn}
                  sources={sourceMap}
                  onOpenVersion={(versionId) => { setSelectedVersionId(versionId === latestVersionId ? null : versionId); setArtifactOpen(true); setMobileTab("artifact"); }}
                  onFill={fillComposer}
                  onRetry={(t) => send(t.userMessage, t.attachmentSourceIds)}
                  onCancel={props.cancel}
                />
              ))}
              {turns.length === 0 && !props.isLoading && !props.isError && (
                <ul className="flex flex-wrap justify-center gap-2" aria-label="Suggestions">
                  {props.starters.map((text) => (
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
            <div className={cn(!showArtifact && "mx-auto max-w-[760px]")}>
              {artifactId && !artifactOpen && (
                <button
                  type="button"
                  onClick={() => { setArtifactOpen(true); setMobileTab("artifact"); }}
                  className="mb-2 inline-flex min-h-9 items-center gap-2 rounded-full border border-border-strong bg-surface px-3.5 text-sm font-medium hover:bg-aqua/60"
                >
                  <FileText size={15} aria-hidden /> Open the artifact
                </button>
              )}
              {props.sendError && <p role="alert" className="mb-2 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">{props.sendError}</p>}
              <Composer sources={sources} attachable={attachable} allowAttach={props.allowAttach} placeholder={props.placeholder} disabled={props.submitting} onSend={(m, a) => send(m, a)} />
            </div>
          </div>
        </section>

        {showArtifact && (
          <section aria-label="Artifact" className={cn("fade-in min-h-0 border-l border-border bg-surface md:flex md:flex-col", mobileTab === "artifact" ? "flex flex-col" : "hidden")}>
            <ArtifactPane
              artifactId={artifactId}
              latestVersionId={latestVersionId}
              selectedVersionId={selectedVersionId}
              onSelectVersion={setSelectedVersionId}
              clientSlug={accentSlug}
              onAsk={fillComposer}
              onClose={closeArtifact}
              stale={staleReasons}
            />
          </section>
        )}
      </div>
    </>
  );
}
