"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PassportPanel } from "@/components/canvas/passport-panel";
import { CanvasBoard, type BoardHandle } from "@/components/canvas/board";
import { SCENARIO_PROMPTS } from "@/components/home/scenarios";
import { Button, ErrorNote, Skeleton } from "@/components/ui";
import { ConversationArea } from "@/components/workspace/conversation-area";
import { useWorkspace } from "@/components/workspace/context";
import { EvidenceDrawer } from "@/components/workspace/evidence-drawer";
import { XrayToggle } from "@/components/workspace/xray";
import { ApiError, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  useCancelCanvasExecution, useCanvas, useCanvasConversation, usePassport, useSources, useSubmitCanvasTurn,
} from "@/lib/hooks";
import { useSession } from "@/lib/session";
import { useNarrow } from "@/lib/useNarrow";

const STARTERS = [
  "What is working for these brands?",
  "What patterns do the connected brands share?",
  SCENARIO_PROMPTS.permissions,
  "Also borrow Velvet Static's best-performing tactics.",
];

function IntelligenceWorkspace() {
  const router = useRouter();
  const search = useSearchParams();
  const session = useSession();
  const queryClient = useQueryClient();
  const narrow = useNarrow();
  const { setActiveExecutionId, setGeekTurns, closeEvidence } = useWorkspace();

  const canvas = useCanvas();
  const sources = useSources();
  const board = useRef<BoardHandle>(null);
  const scenarioStarted = useRef(false);

  const [boardKey, setBoardKey] = useState(0);
  const [revision, setRevision] = useState<number | null>(null);
  const [chatNodeId, setChatNodeId] = useState<string | null>(null);
  const [chatNodes, setChatNodes] = useState<{ id: string; title: string }[]>([]);
  const [passportOpen, setPassportOpen] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [split, setSplit] = useState(0.42);
  const column = useRef<HTMLDivElement>(null);

  const conversation = useCanvasConversation(chatNodeId);
  const passport = usePassport(chatNodeId, revision ?? canvas.data?.revision ?? null);
  const submit = useSubmitCanvasTurn(chatNodeId);
  const cancel = useCancelCanvasExecution(chatNodeId);
  const turns = useMemo(() => conversation.data?.turns ?? [], [conversation.data]);
  const chatTitle = chatNodes.find((c) => c.id === chatNodeId)?.title ?? "Chat";

  useEffect(() => {
    setGeekTurns(turns.filter((t) => t.executionId).map((t) => ({ executionId: t.executionId!, seq: t.seq, label: t.userMessage })));
  }, [turns, setGeekTurns]);
  useEffect(() => {
    setActiveExecutionId(turns[turns.length - 1]?.executionId ?? null);
  }, [turns, setActiveExecutionId]);
  useEffect(() => () => closeEvidence(), [closeEvidence]);

  const send = useCallback(
    async (message: string, _attachments: string[], referencedVersionId?: string, key?: string) => {
      setSendError(null);
      try {
        // The turn is tied to a saved canvas revision, so any pending edit is saved first.
        await board.current?.flush();
        const result = await submit.mutateAsync({ message, referencedVersionId, key });
        setRevision(result.canvasRevision);
        setActiveExecutionId(result.executionId);
      } catch (error) {
        setSendError(error instanceof ApiError ? error.message : "The request could not be sent.");
      }
    },
    [submit, setActiveExecutionId],
  );

  // The guided permissions scenario: connect every node, including the restricted client, then ask. Connecting
  // alone grants nothing, which is what the passport and the answer then show.
  useEffect(() => {
    if (search.get("scenario") !== "permissions" || scenarioStarted.current || !canvas.data || !chatNodeId || !conversation.data) return;
    scenarioStarted.current = true;
    router.replace("/intelligence");
    if (conversation.data.turns.some((t) => t.userMessage === SCENARIO_PROMPTS.permissions)) return;
    void (async () => {
      const current = canvas.data!;
      const edges = current.nodes.filter((n) => n.type !== "chat").map((n) => ({ id: `${n.id}->${chatNodeId}`, source: n.id, target: chatNodeId }));
      try {
        const saved = await api<{ revision: number }>("/canvas", { method: "PUT", body: { baseRevision: current.revision, nodes: current.nodes, edges } });
        await queryClient.invalidateQueries({ queryKey: ["canvas"] });
        setRevision(saved.revision);
        setBoardKey((k) => k + 1);
        setPassportOpen(true);
        await send(SCENARIO_PROMPTS.permissions, [], undefined, `scenario-permissions-${session.agencyId}`);
      } catch (error) {
        setSendError(error instanceof ApiError ? error.message : "The scenario could not start.");
      }
    })();
  }, [search, canvas.data, chatNodeId, conversation.data, router, queryClient, send, session.agencyId]);

  const dragSplit = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const el = column.current;
    if (!el) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = el.getBoundingClientRect();
    const move = (e: PointerEvent) => setSplit(Math.min(0.75, Math.max(0.2, (e.clientY - rect.top) / rect.height)));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);

  if (canvas.isError) {
    return <div className="p-8"><ErrorNote title="The canvas could not load" action={<Button onClick={() => canvas.refetch()}>Try again</Button>}>Your saved canvas is safe. Only the view failed.</ErrorNote></div>;
  }
  if (!canvas.data) {
    return <div className="space-y-3 p-6"><Skeleton className="h-8 w-64" /><Skeleton className="h-[40vh] w-full" /></div>;
  }

  return (
    <div className="relative flex h-full flex-col" ref={column}>
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-surface px-5 py-2.5">
        <div className="min-w-0">
          <h1 className="text-[18px] font-medium leading-tight">Intelligence canvas</h1>
          <p className="text-xs text-text-muted">Connect clients that approved sharing to a chat, and ask what is working across them.</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {chatNodes.length > 1 && (
            <div role="tablist" aria-label="Chats" className="flex gap-1">
              {chatNodes.map((c) => (
                <button key={c.id} role="tab" aria-selected={c.id === chatNodeId} onClick={() => setChatNodeId(c.id)} className={cn("min-h-8 rounded-full px-3 text-sm", c.id === chatNodeId ? "bg-aqua font-medium" : "text-text-muted hover:bg-surface-muted")}>{c.title}</button>
              ))}
            </div>
          )}
          <XrayToggle />
        </div>
      </div>

      <div className="shrink-0 border-b border-border" style={{ height: `${split * 100}%` }}>
        <CanvasBoard
          key={boardKey}
          ref={board}
          initial={canvas.data}
          selectedChatId={chatNodeId}
          onSelectChat={setChatNodeId}
          onRevision={setRevision}
          passport={passport.data?.passport.entries ?? []}
          onOpenPassport={() => setPassportOpen(true)}
          onChatNodes={setChatNodes}
          readOnly={narrow}
          fitSignal={Math.round(split * 100) + boardKey * 1000}
        />
      </div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the canvas and the conversation"
        aria-valuenow={Math.round(split * 100)}
        aria-valuemin={20}
        aria-valuemax={75}
        tabIndex={0}
        onPointerDown={dragSplit}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") setSplit((v) => Math.max(0.2, v - 0.05));
          if (e.key === "ArrowDown") setSplit((v) => Math.min(0.75, v + 0.05));
        }}
        className="hidden h-2 shrink-0 cursor-row-resize border-b border-border bg-surface-muted hover:bg-aqua md:block"
      />

      <PassportPanel open={passportOpen} onToggle={() => setPassportOpen((v) => !v)} loading={passport.isLoading} error={passport.isError} view={passport.data} chatTitle={chatTitle} />

      <ConversationArea
        turns={turns}
        isLoading={conversation.isLoading && Boolean(chatNodeId)}
        isError={conversation.isError}
        onReload={() => conversation.refetch()}
        sources={sources.data ?? []}
        attachable={[]}
        allowAttach={false}
        accentSlug=""
        emptyTitle="Ask what is working across the connected brands"
        emptyHint="The chat can only see what each connected client approved. Open the passport above to check exactly what that is."
        starters={STARTERS}
        placeholder="Ask about the connected brands, or ask for concepts"
        send={(message, attachments, referenced) => send(message, attachments, referenced)}
        cancel={(executionId) => cancel.mutate(executionId)}
        submitting={submit.isPending}
        sendError={sendError}
        resetKey={chatNodeId ?? "none"}
      />
      <EvidenceDrawer />
    </div>
  );
}

export default function IntelligencePage() {
  return (
    <Suspense fallback={<div className="p-6"><Skeleton className="h-8 w-64" /></div>}>
      <IntelligenceWorkspace />
    </Suspense>
  );
}
