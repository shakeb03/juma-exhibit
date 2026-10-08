"use client";

import { ArrowUp, Paperclip, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge, Button } from "@/components/ui";
import { DRAG_TYPE } from "@/components/shell/files-panel";
import { cn } from "@/lib/cn";
import { KIND_LABEL } from "@/lib/format";
import type { SourceSummary } from "@/lib/types";
import { useWorkspace } from "./context";

/** Enter sends, Shift+Enter adds a line. Attaching adds explicit context; it never starts a task or grants permission. */
export function Composer({
  sources,
  attachable,
  disabled,
  onSend,
}: {
  sources: SourceSummary[];
  /** This client's files, available for click-to-attach. */
  attachable: SourceSummary[];
  disabled: boolean;
  onSend: (message: string, attachmentIds: string[]) => void;
}) {
  const { attachments, addAttachment, removeAttachment, clearAttachments, pendingFill, clearFill } = useWorkspace();
  const [text, setText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [menu, setMenu] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const byId = new Map(sources.map((s) => [s.id, s]));

  // Suggestions only fill the box. The user chooses when to send.
  useEffect(() => {
    if (pendingFill !== null) {
      setText(pendingFill);
      clearFill();
      requestAnimationFrame(() => {
        area.current?.focus();
        area.current?.setSelectionRange(pendingFill.length, pendingFill.length);
      });
    }
  }, [pendingFill, clearFill]);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  function send() {
    const message = text.trim();
    if (!message || disabled) return;
    onSend(message, attachments);
    setText("");
    clearAttachments();
  }

  return (
    <div
      className={cn(
        "rounded-[var(--radius-composer)] border bg-surface p-3 transition-colors",
        dragging ? "border-teal bg-aqua/50" : "border-border-strong",
      )}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(DRAG_TYPE)) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const id = event.dataTransfer.getData(DRAG_TYPE);
        if (id && attachable.some((s) => s.id === id)) addAttachment(id);
      }}
    >
      {attachments.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Files attached to this request">
          {attachments.map((id) => {
            const source = byId.get(id);
            return (
              <li key={id}>
                <Badge tone="aqua" className="gap-1.5 py-1 pl-2.5 pr-1">
                  <Paperclip size={12} aria-hidden />
                  <span>{source?.name ?? "File"}</span>
                  <span className="text-text-muted">adds {KIND_LABEL[source?.kind ?? ""]?.toLowerCase() ?? "context"}</span>
                  <button type="button" onClick={() => removeAttachment(id)} aria-label={`Remove ${source?.name ?? "file"}`} className="grid h-5 w-5 place-items-center rounded-full hover:bg-surface/70">
                    <X size={12} aria-hidden />
                  </button>
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
      <label htmlFor="composer" className="sr-only">Message to the agent</label>
      <textarea
        id="composer"
        ref={area}
        value={text}
        rows={1}
        placeholder="Ask about this client's work, or ask for a report"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            send();
          }
        }}
        className="block max-h-[180px] w-full resize-none bg-transparent px-1 py-1 text-[15px] placeholder:text-text-muted focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="relative">
          <Button variant="ghost" compact onClick={() => setMenu((v) => !v)} aria-expanded={menu} aria-haspopup="menu">
            <Paperclip size={15} aria-hidden /> Attach
          </Button>
          {menu && (
            <ul role="menu" aria-label="Attach a file" className="fade-in absolute bottom-full left-0 z-10 mb-1 max-h-64 w-72 overflow-y-auto rounded-[var(--radius-control)] border border-border bg-surface p-1 shadow-float">
              {attachable.map((source) => (
                <li key={source.id} role="none">
                  <button
                    role="menuitem"
                    onClick={() => { addAttachment(source.id); setMenu(false); area.current?.focus(); }}
                    className="flex w-full flex-col rounded-md px-3 py-2 text-left hover:bg-surface-muted"
                  >
                    <span className="truncate text-sm">{source.name}</span>
                    <span className="text-xs text-text-muted">{KIND_LABEL[source.kind] ?? source.kind}</span>
                  </button>
                </li>
              ))}
              {attachable.length === 0 && <li className="px-3 py-2 text-sm text-text-muted">No files for this client.</li>}
            </ul>
          )}
        </div>
        <Button variant="primary" onClick={send} disabled={disabled || text.trim().length === 0} aria-label="Send message">
          <ArrowUp size={16} aria-hidden /> Send
        </Button>
      </div>
    </div>
  );
}
