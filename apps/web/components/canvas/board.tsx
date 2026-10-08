"use client";

import "@xyflow/react/dist/style.css";
import {
  Background, BackgroundVariant, Controls, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange,
} from "@xyflow/react";
import { ChevronDown, FileText, Lightbulb, MessageSquare, Plus, ScanLine, StickyNote, Users } from "lucide-react";
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { Badge } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useClients, useUpdateSharing } from "@/lib/hooks";
import type { CanvasEdgeData, CanvasNodeData, CanvasState, PassportEntry } from "@/lib/types";
import { PassportEdge, type PassportEdgeData } from "./edge";
import { BriefNode, ChatNode, ClientNode, IdeaNode, ReferenceNode } from "./nodes";
import { CanvasUiProvider, type CanvasUi } from "./ui-context";

const nodeTypes = { client: ClientNode, brief: BriefNode, reference: ReferenceNode, idea: IdeaNode, chat: ChatNode };
const edgeTypes = { passport: PassportEdge };
const SAVE_DELAY_MS = 700;

export interface BoardHandle {
  /** Save any pending change and resolve once the server has the latest revision. */
  flush: () => Promise<void>;
}

const toRfNode = (n: CanvasNodeData): Node => ({
  id: n.id, type: n.type, position: n.position,
  data: { title: n.title, text: n.text, clientId: n.clientId, sourceId: n.sourceId },
});
const fromRfNode = (n: Node): CanvasNodeData => {
  const d = n.data as { title?: string; text?: string; clientId?: string; sourceId?: string };
  return {
    id: n.id, type: n.type as CanvasNodeData["type"], position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
    ...(d.clientId ? { clientId: d.clientId } : {}), ...(d.sourceId ? { sourceId: d.sourceId } : {}),
    ...(d.text !== undefined && d.text !== "" ? { text: d.text } : {}), ...(d.title ? { title: d.title } : {}),
  };
};
const toRfEdge = (e: CanvasEdgeData): Edge => ({ id: e.id, source: e.source, target: e.target, type: "passport", data: { label: e.label } });
const fromRfEdge = (e: Edge): CanvasEdgeData => ({ id: e.id, source: e.source, target: e.target, ...((e.data as PassportEdgeData | undefined)?.label ? { label: (e.data as PassportEdgeData).label } : {}) });

type SaveState = { kind: "saved"; revision: number } | { kind: "saving" } | { kind: "error"; message: string } | { kind: "reloaded" };

interface Props {
  initial: CanvasState;
  selectedChatId: string | null;
  onSelectChat: (id: string | null) => void;
  /** Called with the saved revision so the passport and conversation follow the canvas. */
  onRevision: (revision: number) => void;
  passport: PassportEntry[];
  onOpenPassport: () => void;
  /** Chat nodes currently on the canvas, with their names, so the page can label the open conversation. */
  onChatNodes?: (nodes: { id: string; title: string }[]) => void;
  /** Below 768px the canvas is for viewing and chatting only. */
  readOnly?: boolean;
  /** Changes when the space around the canvas changes, so it can be refitted to the new size. */
  fitSignal?: number;
  ref?: Ref<BoardHandle>;
}

function Board({ initial, selectedChatId, onSelectChat, onRevision, passport, onOpenPassport, onChatNodes, readOnly = false, fitSignal = 0, ref }: Props) {
  const clients = useClients();
  const sharing = useUpdateSharing();
  const flow = useReactFlow();
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<Node>(initial.nodes.map(toRfNode));
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState<Edge>(initial.edges.map(toRfEdge));
  const [saveState, setSaveState] = useState<SaveState>({ kind: "saved", revision: initial.revision });
  const [addMenu, setAddMenu] = useState(false);
  const revision = useRef(initial.revision);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const dirty = useRef(false);
  const latest = useRef({ nodes, edges });
  latest.current = { nodes, edges };

  const clientList = clients.data ?? [];

  // Fit once the layout has settled, and again whenever the space around the canvas changes.
  useEffect(() => {
    // Leave room above the nodes for the toolbar.
    const timeout = setTimeout(() => { void flow.fitView({ padding: { top: "64px", right: "16px", bottom: "16px", left: "16px" }, maxZoom: 1, duration: 150 }); }, 250);
    return () => clearTimeout(timeout);
  }, [fitSignal, flow]);

  const save = useCallback(async () => {
    if (!dirty.current) return;
    if (inFlight.current) { await inFlight.current; if (!dirty.current) return; }
    dirty.current = false;
    setSaveState({ kind: "saving" });
    const { nodes: n, edges: e } = latest.current;
    const run = (async () => {
      try {
        const result = await api<{ revision: number }>("/canvas", { method: "PUT", body: { baseRevision: revision.current, nodes: n.map(fromRfNode), edges: e.map(fromRfEdge) } });
        revision.current = result.revision;
        setSaveState({ kind: "saved", revision: result.revision });
        onRevision(result.revision);
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          // Another tab or request saved first. Take the server's version rather than overwrite it.
          const current = (error.body as { current?: { revision: number; nodes: CanvasNodeData[]; edges: CanvasEdgeData[] } } | null)?.current;
          if (current) {
            revision.current = current.revision;
            setNodes(current.nodes.map(toRfNode));
            setEdges(current.edges.map(toRfEdge));
            setSaveState({ kind: "reloaded" });
            onRevision(current.revision);
            return;
          }
        }
        dirty.current = true;
        setSaveState({ kind: "error", message: error instanceof ApiError ? error.message : "The canvas could not be saved." });
      }
    })();
    inFlight.current = run;
    await run;
    inFlight.current = null;
  }, [onRevision, setNodes, setEdges]);

  const markDirty = useCallback(() => {
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void save(); }, SAVE_DELAY_MS);
  }, [save]);

  useImperativeHandle(ref, () => ({
    flush: async () => {
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      await save();
    },
  }), [save]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    onNodesChangeBase(changes);
    // Save when something is added, removed, or finished moving. Selection and measuring do not need a save.
    if (changes.some((c) => c.type === "remove" || c.type === "add" || (c.type === "position" && c.dragging === false))) markDirty();
  }, [onNodesChangeBase, markDirty]);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    onEdgesChangeBase(changes);
    if (changes.some((c) => c.type === "remove" || c.type === "add")) markDirty();
  }, [onEdgesChangeBase, markDirty]);

  const isChat = useCallback((id: string) => latest.current.nodes.find((n) => n.id === id)?.type === "chat", []);

  const connect = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return;
    // A connection joins a chat node to something it can read. Two ordinary nodes are not connected to each other.
    if (isChat(fromId) === isChat(toId)) return;
    setEdges((existing) => {
      if (existing.some((e) => [e.source, e.target].sort().join("|") === [fromId, toId].sort().join("|"))) return existing;
      const source = isChat(fromId) ? toId : fromId;
      const target = isChat(fromId) ? fromId : toId;
      return [...existing, { id: `${source}->${target}`, source, target, type: "passport", data: {} }];
    });
    markDirty();
  }, [isChat, markDirty, setEdges]);

  const onConnect = useCallback((c: Connection) => { if (c.source && c.target) connect(c.source, c.target); }, [connect]);

  const update = useCallback((id: string, patch: { title?: string; text?: string }) => {
    setNodes((existing) => existing.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
    markDirty();
  }, [markDirty, setNodes]);

  const remove = useCallback((id: string) => {
    setNodes((existing) => existing.filter((n) => n.id !== id));
    setEdges((existing) => existing.filter((e) => e.source !== id && e.target !== id));
    markDirty();
  }, [markDirty, setNodes, setEdges]);

  const setLabel = useCallback((id: string, label: string) => {
    setEdges((existing) => existing.map((e) => (e.id === id ? { ...e, data: { ...(e.data as object), label } } : e)));
    markDirty();
  }, [markDirty, setEdges]);

  // Where new nodes land: just right of centre, staggered, so they never stack on top of each other.
  const nextPosition = useCallback(() => {
    const centre = flow.screenToFlowPosition({ x: window.innerWidth * 0.4, y: window.innerHeight * 0.3 });
    const offset = (latest.current.nodes.length % 6) * 28;
    return { x: Math.round(centre.x + offset), y: Math.round(centre.y + offset) };
  }, [flow]);

  const add = useCallback((node: Omit<CanvasNodeData, "id" | "position">) => {
    const id = `${node.type}-${Math.random().toString(36).slice(2, 8)}`;
    setNodes((existing) => [...existing, toRfNode({ ...node, id, position: nextPosition() })]);
    markDirty();
    setAddMenu(false);
    if (node.type === "chat") onSelectChat(id);
  }, [markDirty, nextPosition, onSelectChat, setNodes]);

  const chatNodes = useMemo(() => nodes.filter((n) => n.type === "chat").map((n) => ({ id: n.id, title: (n.data as { title?: string }).title || "Chat" })), [nodes]);
  useEffect(() => { onChatNodes?.(chatNodes); }, [chatNodes, onChatNodes]);
  useEffect(() => {
    if (selectedChatId === null || !chatNodes.some((c) => c.id === selectedChatId)) onSelectChat(chatNodes[0]?.id ?? null);
  }, [chatNodes, selectedChatId, onSelectChat]);

  const passportByNode = useMemo(() => {
    const map = new Map<string, PassportEntry>();
    for (const entry of passport) map.set(entry.nodeId, entry);
    // Client entries are keyed by client id when no node id matched; map them to their node.
    for (const n of nodes) {
      const clientId = (n.data as { clientId?: string }).clientId;
      if (n.type === "client" && clientId) {
        const entry = passport.find((p) => p.nodeId === clientId || p.nodeId === n.id);
        if (entry) map.set(n.id, entry);
      }
    }
    return map;
  }, [passport, nodes]);

  const labelOf = useCallback((nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return nodeId;
    const d = node.data as { title?: string; clientId?: string };
    if (node.type === "client") return clientList.find((c) => c.id === d.clientId)?.name ?? "Client";
    return d.title || ({ brief: "New-client brief", reference: "Reference", idea: "Idea", chat: "Chat" } as Record<string, string>)[node.type ?? ""] || nodeId;
  }, [nodes, clientList]);

  const ui = useMemo<CanvasUi>(() => ({
    clients: clientList,
    passportByNode,
    selectedChatId,
    onSelectChat: (id) => onSelectChat(id),
    update, remove, connect,
    connectedTo: (chatId) => edges.filter((e) => e.source === chatId || e.target === chatId).map((e) => (e.source === chatId ? e.target : e.source)),
    isConnected: (a, b) => edges.some((e) => (e.source === a && e.target === b) || (e.source === b && e.target === a)),
    chatNodes,
    connectableNodes: nodes.filter((n) => n.type !== "chat").map((n) => ({ id: n.id, label: labelOf(n.id) })),
    toggleSharing: (clientId, next) => sharing.mutate({ clientId, ...next }),
    sharingBusy: sharing.isPending,
    labelOf,
  }), [clientList, passportByNode, selectedChatId, onSelectChat, update, remove, connect, edges, chatNodes, nodes, labelOf, sharing]);

  // Edges show what flows through them, for the chat that is currently open.
  const shownEdges = useMemo(() => edges.map((e): Edge => {
    const other = e.source === selectedChatId ? e.target : e.target === selectedChatId ? e.source : null;
    const entry = other ? passportByNode.get(other) : undefined;
    const base = (e.data ?? {}) as PassportEdgeData;
    return { ...e, type: "passport", data: { ...base, status: entry?.status ?? "approved", shared: entry?.fieldsShared ?? 0, nodeId: other ?? undefined, onLabel: setLabel, onOpenPassport } };
  }), [edges, selectedChatId, passportByNode, setLabel, onOpenPassport]);

  const unplacedClients = clientList.filter((c) => !nodes.some((n) => (n.data as { clientId?: string }).clientId === c.id));
  const hasClients = nodes.some((n) => n.type === "client");

  return (
    <CanvasUiProvider value={ui}>
      <div className="relative h-full w-full" aria-label="Intelligence canvas">
        <ReactFlow
          nodes={nodes}
          edges={shownEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={(c) => Boolean(c.source && c.target && isChat(c.source) !== isChat(c.target))}
          fitView
          fitViewOptions={{ padding: { top: "64px", right: "16px", bottom: "16px", left: "16px" }, maxZoom: 1 }}
          minZoom={0.3}
          maxZoom={1.4}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, node) => { if (node.type === "chat") onSelectChat(node.id); }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="#c9d9d6" />
          <Controls position="bottom-right" showInteractive={false} aria-label="Zoom controls" />
        </ReactFlow>

        {/* Compact toolbar */}
        {!readOnly && <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-1.5 rounded-[var(--radius-control)] border border-border bg-surface p-1 shadow-float" role="toolbar" aria-label="Canvas tools">
          <div className="relative">
            <button type="button" onClick={() => setAddMenu((v) => !v)} aria-expanded={addMenu} aria-haspopup="menu" className="flex min-h-8 items-center gap-1.5 rounded px-2.5 text-sm font-medium hover:bg-surface-muted">
              <Plus size={15} aria-hidden /> Add <ChevronDown size={13} aria-hidden />
            </button>
            {addMenu && (
              <ul role="menu" aria-label="Add to the canvas" className="fade-in absolute left-0 top-full z-30 mt-1 w-64 rounded-[var(--radius-control)] border border-border bg-surface p-1 shadow-float">
                <li className="px-3 pb-0.5 pt-1.5 text-[11px] font-medium text-text-muted">Client</li>
                {unplacedClients.length === 0 && <li className="px-3 py-1.5 text-xs text-text-muted">Every client is on the canvas.</li>}
                {unplacedClients.map((c) => (
                  <li key={c.id} role="none"><button role="menuitem" onClick={() => add({ type: "client", clientId: c.id })} className="flex min-h-8 w-full items-center gap-2 rounded px-3 text-left text-sm hover:bg-surface-muted"><Users size={14} aria-hidden /> {c.name}</button></li>
                ))}
                <li className="my-1 border-t border-border" aria-hidden />
                {([["brief", "New-client brief", FileText], ["reference", "Reference", StickyNote], ["idea", "Idea", Lightbulb]] as const).map(([type, label, Icon]) => (
                  <li key={type} role="none"><button role="menuitem" onClick={() => add({ type, title: label === "Idea" ? "My idea" : label, text: "" })} className="flex min-h-8 w-full items-center gap-2 rounded px-3 text-left text-sm hover:bg-surface-muted"><Icon size={14} aria-hidden /> {label}</button></li>
                ))}
                <li role="none"><button role="menuitem" disabled={chatNodes.length >= 3} onClick={() => add({ type: "chat", title: `Chat ${chatNodes.length + 1}` })} className="flex min-h-8 w-full items-center gap-2 rounded px-3 text-left text-sm hover:bg-surface-muted disabled:opacity-50"><MessageSquare size={14} aria-hidden /> Chat node{chatNodes.length >= 3 ? " (limit reached)" : ""}</button></li>
              </ul>
            )}
          </div>
          <button type="button" onClick={() => flow.fitView({ padding: { top: "64px", right: "16px", bottom: "16px", left: "16px" }, maxZoom: 1, duration: 200 })} className="flex min-h-8 items-center gap-1.5 rounded px-2.5 text-sm hover:bg-surface-muted">
            <ScanLine size={15} aria-hidden /> Fit canvas
          </button>
          <span className="px-1.5" role="status" aria-live="polite">
            {saveState.kind === "saving" && <Badge>Saving</Badge>}
            {saveState.kind === "saved" && <Badge tone="success">Saved · revision {saveState.revision}</Badge>}
            {saveState.kind === "reloaded" && <Badge tone="amber">Changed elsewhere, reloaded</Badge>}
            {saveState.kind === "error" && (
              <button type="button" onClick={() => { dirty.current = true; void save(); }} className="rounded-full bg-danger-bg px-2.5 py-0.5 text-xs font-medium text-danger">Not saved: {saveState.message} Retry</button>
            )}
          </span>
        </div>}

        {!hasClients && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="rounded-[var(--radius-card)] bg-surface/90 p-6 text-center">
              <p className="font-serif text-xl italic">Bring two brands. Find something worth testing.</p>
              <p className="mt-1 text-sm text-text-muted">Use Add to place a client, then connect it to a chat node.</p>
            </div>
          </div>
        )}
      </div>
    </CanvasUiProvider>
  );
}

export function CanvasBoard(props: Props) {
  // The query cache keeps the canvas fresh elsewhere; this board owns its working copy.
  return <ReactFlowProvider><Board {...props} /></ReactFlowProvider>;
}
