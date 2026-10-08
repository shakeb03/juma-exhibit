"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Check, FileText, Lightbulb, Link2, Lock, MessageSquare, StickyNote, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { accentFor, initialsOf } from "@/lib/format";
import { useSourcePreview } from "@/lib/hooks";
import { useCanvasUi } from "./ui-context";

interface NodeData extends Record<string, unknown> {
  title?: string;
  text?: string;
  clientId?: string;
  sourceId?: string;
}

const MAX_TEXT = 4000;

/** "Connect to…" as a menu, for anyone who cannot or would rather not drag a line. */
function ConnectMenu({ id, isChat }: { id: string; isChat: boolean }) {
  const ui = useCanvasUi();
  const [open, setOpen] = useState(false);
  // Connections always join a chat node to something it can read.
  const choices = isChat
    ? ui.connectableNodes
    : ui.chatNodes.map((c) => ({ id: c.id, label: c.title }));
  return (
    <div className="relative nodrag">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex min-h-8 items-center gap-1 rounded px-2 text-xs text-teal hover:bg-aqua/60"
      >
        <Link2 size={13} aria-hidden /> {isChat ? "Connect a node" : "Connect to chat"}
      </button>
      {open && (
        <ul role="menu" className="fade-in absolute left-0 top-full z-30 mt-1 max-h-56 w-60 overflow-y-auto rounded-[var(--radius-control)] border border-border bg-surface p-1 shadow-float">
          {choices.length === 0 && <li className="px-3 py-2 text-xs text-text-muted">Nothing to connect to yet.</li>}
          {choices.map((choice) => {
            const connected = isChat ? ui.isConnected(id, choice.id) : ui.isConnected(choice.id, id);
            return (
              <li key={choice.id} role="none">
                <button
                  role="menuitem"
                  disabled={connected}
                  onClick={() => { if (isChat) ui.connect(choice.id, id); else ui.connect(id, choice.id); setOpen(false); }}
                  className="flex min-h-8 w-full items-center justify-between gap-2 rounded px-3 py-1.5 text-left text-xs hover:bg-surface-muted disabled:opacity-50"
                >
                  <span className="truncate">{choice.label}</span>
                  {connected && <span className="text-text-muted">connected</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Shell({ id, selected, children, tone = "default", label }: { id: string; selected?: boolean; children: React.ReactNode; tone?: "default" | "inert"; label: string }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "w-[270px] rounded-[var(--radius-card)] border bg-surface p-3.5 text-left",
        selected ? "border-teal outline outline-2 outline-teal/40" : "border-border-strong",
        tone === "inert" && "bg-surface-muted",
      )}
      data-node-id={id}
    >
      {children}
    </div>
  );
}

function RemoveButton({ id, name }: { id: string; name: string }) {
  const ui = useCanvasUi();
  return (
    <button type="button" onClick={() => ui.remove(id)} aria-label={`Remove ${name} from the canvas`} className="nodrag grid h-7 w-7 shrink-0 place-items-center rounded text-text-muted hover:bg-surface-muted hover:text-danger">
      <X size={14} aria-hidden />
    </button>
  );
}

function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("nodrag relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-60", checked ? "border-success bg-success" : "border-border-strong bg-surface-muted")}
    >
      <span className={cn("absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-all", checked ? "left-[18px]" : "left-0.5 bg-border-strong")} />
    </button>
  );
}

export function ClientNode({ id, data, selected }: NodeProps) {
  const ui = useCanvasUi();
  const d = data as NodeData;
  const client = ui.clients.find((c) => c.id === d.clientId);
  if (!client) return <Shell id={id} label="Client not found"><p className="text-sm text-text-muted">This client is no longer in the workspace.</p><RemoveButton id={id} name="client" /></Shell>;
  const accent = accentFor(client.slug);
  const { performancePatterns, creativeAssets } = client.sharing;
  const inert = !performancePatterns && !creativeAssets;
  const set = (patch: Partial<typeof client.sharing>) => ui.toggleSharing(client.id, { performancePatterns, creativeAssets, ...patch });

  return (
    <Shell id={id} selected={selected} tone={inert ? "inert" : "default"} label={`Client: ${client.name}`}>
      <div className="flex items-start gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-xs font-medium text-white" style={{ backgroundColor: inert ? "#7a8e8b" : accent }} aria-hidden>{initialsOf(client.name)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{client.name}</p>
          <p className="truncate text-xs text-text-muted">{client.category}</p>
        </div>
        <RemoveButton id={id} name={client.name} />
      </div>
      <div className="my-2.5 h-0.5 w-8 rounded-full" style={{ backgroundColor: inert ? "#d9e5e2" : accent }} aria-hidden />
      <ul className="space-y-1.5 text-xs" aria-label={`Sharing for ${client.name}`}>
        {([["Performance patterns", performancePatterns, (v: boolean) => set({ performancePatterns: v })], ["Creative assets", creativeAssets, (v: boolean) => set({ creativeAssets: v })]] as const).map(([label, on, change]) => (
          <li key={label} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              {on ? <Check size={13} className="text-success" aria-hidden /> : <Lock size={13} className="text-danger" aria-hidden />}
              {label}: <span className={on ? "text-success" : "text-danger"}>{on ? "approved" : "restricted"}</span>
            </span>
            <Switch checked={on} onChange={change} disabled={ui.sharingBusy} label={`${label} for ${client.name}`} />
          </li>
        ))}
      </ul>
      {inert && <p className="mt-2 text-xs text-text-muted">No approved information. Connecting this client shares nothing.</p>}
      <p className="mt-2 text-[11px] leading-snug text-text-muted">Switches model each client's consent. Demo data, not a legal record.</p>
      <ConnectMenu id={id} isChat={false} />
      <Handle type="source" position={Position.Right} aria-label={`Connect ${client.name} to a chat node`} className="!h-3 !w-3 !border-2 !border-surface !bg-teal" />
    </Shell>
  );
}

function SeededText({ sourceId }: { sourceId: string }) {
  const preview = useSourcePreview(sourceId);
  if (preview.isLoading) return <div className="skeleton h-12 w-full" />;
  return <p className="nowheel max-h-28 overflow-y-auto whitespace-pre-line text-xs text-text-muted">{preview.data?.text.slice(0, 700) ?? "Preview unavailable."}{(preview.data?.text.length ?? 0) > 700 ? "…" : ""}</p>;
}

/** Brief, reference, and idea nodes carry text the user supplies. That text is explicit context for any chat connected to it. */
function TextNode({ id, data, selected, icon: Icon, kind, placeholder }: NodeProps & { icon: typeof FileText; kind: string; placeholder: string }) {
  const ui = useCanvasUi();
  const d = data as NodeData;
  const text = d.text ?? "";
  return (
    <Shell id={id} selected={selected} label={`${kind}: ${d.title ?? ""}`}>
      <div className="flex items-start gap-2">
        <Icon size={16} className="mt-1 shrink-0 text-teal" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-text-muted">{kind}</p>
          {d.sourceId ? (
            <p className="truncate text-sm font-medium">{d.title ?? "Supplied brief"}</p>
          ) : (
            <input
              aria-label={`${kind} title`}
              value={d.title ?? ""}
              placeholder="Title"
              onChange={(e) => ui.update(id, { title: e.target.value })}
              className="nodrag w-full rounded border border-transparent bg-transparent text-sm font-medium hover:border-border focus:border-border-strong"
            />
          )}
        </div>
        <RemoveButton id={id} name={d.title ?? kind} />
      </div>
      <div className="mt-2">
        {d.sourceId ? (
          <>
            <SeededText sourceId={d.sourceId} />
            <p className="mt-1.5 text-[11px] text-text-muted">Supplied by the agency. Read only.</p>
          </>
        ) : (
          <>
            <textarea
              aria-label={`${kind} text`}
              value={text}
              placeholder={placeholder}
              maxLength={MAX_TEXT}
              rows={4}
              onChange={(e) => ui.update(id, { text: e.target.value })}
              className="nodrag nowheel w-full resize-none rounded border border-border bg-background p-2 text-xs leading-relaxed placeholder:text-text-muted"
            />
            <p className="tabular text-right text-[11px] text-text-muted">{text.length.toLocaleString()} / {MAX_TEXT.toLocaleString()}</p>
          </>
        )}
      </div>
      <ConnectMenu id={id} isChat={false} />
      <Handle type="source" position={Position.Right} aria-label={`Connect ${kind.toLowerCase()} to a chat node`} className="!h-3 !w-3 !border-2 !border-surface !bg-teal" />
    </Shell>
  );
}

export const BriefNode = (props: NodeProps) => <TextNode {...props} icon={FileText} kind="New-client brief" placeholder="Describe the new client: who they are, what they sell, who it is for, the budget." />;
export const ReferenceNode = (props: NodeProps) => <TextNode {...props} icon={StickyNote} kind="Reference" placeholder="Paste a note or description of a reference you want considered." />;
export const IdeaNode = (props: NodeProps) => <TextNode {...props} icon={Lightbulb} kind="Idea" placeholder="Your own idea, in a sentence or two. It is context, not a finding." />;

export function ChatNode({ id, data, selected }: NodeProps) {
  const ui = useCanvasUi();
  const d = data as NodeData;
  const chosen = ui.selectedChatId === id;
  const connected = ui.connectedTo(id);
  return (
    <Shell id={id} selected={selected || chosen} label={`Chat: ${d.title ?? "Chat"}`}>
      <Handle type="target" position={Position.Left} aria-label="Connections arrive here" className="!h-3 !w-3 !border-2 !border-surface !bg-teal" />
      <div className="flex items-start gap-2">
        <MessageSquare size={16} className="mt-1 shrink-0 text-teal" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-text-muted">Chat</p>
          <input
            aria-label="Chat name"
            value={d.title ?? ""}
            placeholder="Chat"
            onChange={(e) => ui.update(id, { title: e.target.value })}
            className="nodrag w-full rounded border border-transparent bg-transparent text-sm font-medium hover:border-border focus:border-border-strong"
          />
        </div>
        {ui.chatNodes.length > 1 && <RemoveButton id={id} name="chat" />}
      </div>
      <p className="mt-2 text-xs text-text-muted">
        {connected.length === 0 ? "Nothing connected yet. Connect clients, a brief, or an idea." : `Can read what ${connected.length} connected node${connected.length === 1 ? "" : "s"} allow.`}
      </p>
      {connected.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1" aria-label="Connected nodes">
          {connected.map((nodeId) => {
            const entry = ui.passportByNode.get(nodeId);
            return (
              <li key={nodeId} className={cn("rounded-full px-2 py-0.5 text-[11px]", entry?.status === "restricted" ? "bg-danger-bg text-danger" : "bg-surface-muted text-text-muted")}>
                {ui.labelOf(nodeId)}{entry?.status === "restricted" ? " (0 shared)" : ""}
              </li>
            );
          })}
        </ul>
      )}
      <button
        type="button"
        onClick={() => ui.onSelectChat(id)}
        aria-pressed={chosen}
        className={cn("nodrag mt-2.5 min-h-8 w-full rounded-[var(--radius-control)] border px-3 text-xs font-medium", chosen ? "border-teal bg-aqua" : "border-border-strong hover:bg-surface-muted")}
      >
        {chosen ? "Conversation open below" : "Open this conversation"}
      </button>
      <ConnectMenu id={id} isChat />
    </Shell>
  );
}
