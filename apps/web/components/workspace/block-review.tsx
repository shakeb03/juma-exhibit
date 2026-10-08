"use client";

import { Check, Loader2, MessageSquarePlus, Pencil, RotateCcw } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { wordDiff } from "@/lib/diff";
import { useCommentAction, useCreateComment, useManualEdit } from "@/lib/hooks";
import type { Block, CommentView } from "@/lib/types";

/** The text fields a person can change on each block type, in reading order. Structure (IDs, citations) is not editable. */
const FIELDS: Record<Block["type"], { field: string; label: string; long?: boolean }[]> = {
  heading: [{ field: "text", label: "Heading" }],
  paragraph: [{ field: "text", label: "Text", long: true }],
  metric_table: [{ field: "caption", label: "Caption" }],
  observation: [{ field: "text", label: "Observation", long: true }],
  hypothesis: [{ field: "text", label: "Hypothesis", long: true }],
  recommendation: [
    { field: "text", label: "Recommendation", long: true }, { field: "reasoning", label: "Why", long: true },
    { field: "measurement", label: "How to measure", long: true }, { field: "limitation", label: "Limit", long: true },
  ],
  experiment: [
    { field: "title", label: "Concept" }, { field: "hypothesis", label: "Hypothesis", long: true }, { field: "design", label: "Design", long: true },
    { field: "measurement", label: "How to measure", long: true }, { field: "limitation", label: "Limit", long: true },
  ],
  limitation: [{ field: "text", label: "Limitation", long: true }],
};

const valueOf = (block: Block, field: string) => String((block as Record<string, unknown>)[field] ?? "");

/** Fields whose displayed text differs between two renderings of the same block. */
const changedFields = (before: Block, after: Block) =>
  FIELDS[after.type].filter(({ field }) => valueOf(before, field) !== valueOf(after, field));

const inputClass = "w-full rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 py-2 text-[15px] leading-relaxed focus:border-teal focus:outline-none";

/**
 * A proposed change to one field. Small edits are marked inline, word by word. A rewrite would read as a scatter of
 * struck-through words, so it is shown as the old text above the new text instead.
 */
function Diff({ before, after }: { before: string; after: string }) {
  const { parts, similarity } = wordDiff(before, after);
  if (similarity < 0.6) {
    return (
      <div className="space-y-1.5 text-[15px] leading-relaxed">
        <p className="rounded-sm bg-danger-bg px-2 py-1 text-danger"><span className="mr-1.5 text-xs font-medium">Before</span>{before}</p>
        <p className="rounded-sm bg-observation-bg px-2 py-1 text-success"><span className="mr-1.5 text-xs font-medium">After</span>{after}</p>
      </div>
    );
  }
  return (
    <p className="text-[15px] leading-relaxed">
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && " "}
          <span className={cn(part.kind === "removed" && "rounded-sm bg-danger-bg text-danger line-through decoration-1", part.kind === "added" && "rounded-sm bg-observation-bg font-medium text-success")}>
            {part.text}
          </span>
          {part.kind !== "same" && <span className="sr-only"> ({part.kind})</span>}
        </span>
      ))}
    </p>
  );
}

function Spinner({ label }: { label: string }) {
  return <p className="flex items-center gap-2 text-sm text-text-muted" role="status"><Loader2 size={14} className="animate-spin" aria-hidden /> {label}</p>;
}

function CommentThread({ comment, artifactId, onVersion }: { comment: CommentView; artifactId: string; onVersion: () => void }) {
  const accept = useCommentAction(artifactId, "accept");
  const reject = useCommentAction(artifactId, "reject");
  const retry = useCommentAction(artifactId, "retry");
  const busy = accept.isPending || reject.isPending || retry.isPending;
  const error = (accept.error ?? reject.error ?? retry.error) as Error | null;
  const changes = comment.proposal?.before ? changedFields(comment.proposal.before, comment.proposal.after) : [];

  return (
    <li className="rounded-[var(--radius-control)] border border-border bg-surface px-3 py-2.5">
      <p className="text-sm"><span className="font-medium">You: </span>{comment.body}</p>
      {comment.selection && <p className="mt-0.5 text-xs text-text-muted">About “{comment.selection}”</p>}

      {comment.status === "open" && <div className="mt-2"><Spinner label="Writing a proposal for this block only…" /></div>}

      {comment.status === "proposed" && comment.proposal && (
        <div className="mt-2 space-y-2 border-t border-border pt-2">
          <p className="text-sm text-text-muted">{comment.proposal.summary}</p>
          {changes.length === 0 ? (
            <p className="text-sm italic text-text-muted">No change was proposed.</p>
          ) : (
            changes.map(({ field, label }) => (
              <div key={field}>
                {changes.length > 1 && <p className="mb-0.5 text-xs font-medium text-text-muted">{label}</p>}
                <Diff before={valueOf(comment.proposal!.before!, field)} after={valueOf(comment.proposal!.after, field)} />
              </div>
            ))
          )}
          <div className="flex flex-wrap gap-2">
            {changes.length > 0 && (
              <Button variant="primary" compact disabled={busy} onClick={() => accept.mutate(comment.id, { onSuccess: onVersion })}>
                <Check size={15} aria-hidden /> Accept edit
              </Button>
            )}
            <Button compact disabled={busy} onClick={() => reject.mutate(comment.id)}>{changes.length > 0 ? "Dismiss" : "Close"}</Button>
            <Button compact variant="ghost" disabled={busy} onClick={() => retry.mutate(comment.id)}><RotateCcw size={14} aria-hidden /> Try again</Button>
          </div>
        </div>
      )}

      {comment.status === "stale" && (
        <div className="mt-2 space-y-2 border-t border-border pt-2">
          <p className="text-sm text-amber-dark">This block changed after you commented, so the proposal no longer applies.</p>
          <div className="flex gap-2">
            <Button compact disabled={busy} onClick={() => retry.mutate(comment.id)}><RotateCcw size={14} aria-hidden /> Ask again</Button>
            <Button compact variant="ghost" disabled={busy} onClick={() => reject.mutate(comment.id)}>Dismiss</Button>
          </div>
        </div>
      )}

      {comment.status === "failed" && (
        <div className="mt-2 space-y-2 border-t border-border pt-2">
          <p className="text-sm text-danger">{comment.error ?? "A proposal could not be made."}</p>
          <div className="flex gap-2">
            <Button compact disabled={busy} onClick={() => retry.mutate(comment.id)}><RotateCcw size={14} aria-hidden /> Try again</Button>
            <Button compact variant="ghost" disabled={busy} onClick={() => reject.mutate(comment.id)}>Dismiss</Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error.message}</p>}
    </li>
  );
}

function CommentComposer({ selection, onCancel, onSend, pending, error }: { selection: string | null; onCancel: () => void; onSend: (body: string) => void; pending: boolean; error: string | null }) {
  const [body, setBody] = useState("");
  return (
    <form
      className="mt-2 space-y-2 rounded-[var(--radius-control)] border border-border-strong bg-surface p-3"
      onSubmit={(event) => { event.preventDefault(); if (body.trim()) onSend(body.trim()); }}
    >
      <label className="block text-sm font-medium" htmlFor="comment-body">Comment on this block</label>
      {selection && <p className="text-xs text-text-muted">About “{selection}”</p>}
      <textarea
        id="comment-body"
        autoFocus
        rows={2}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && body.trim()) onSend(body.trim()); if (event.key === "Escape") onCancel(); }}
        placeholder="What should change? For example: make this punchier."
        className={inputClass}
      />
      <p className="text-xs text-text-muted">The AI proposes a change to this block only. Nothing is applied until you accept it.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" compact disabled={pending || !body.trim()}>{pending ? "Sending…" : "Ask for an edit"}</Button>
        <Button type="button" compact variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function BlockEditor({ shown, onCancel, onSave, pending, error }: { shown: Block; onCancel: () => void; onSave: (fields: Record<string, string>) => void; pending: boolean; error: string | null }) {
  const fields = FIELDS[shown.type];
  const [values, setValues] = useState(() => Object.fromEntries(fields.map(({ field }) => [field, valueOf(shown, field)])));
  // Only what the person actually changed is sent, so untouched fields keep their metric placeholders.
  const changed = Object.fromEntries(fields.filter(({ field }) => values[field] !== valueOf(shown, field)).map(({ field }) => [field, values[field]!]));
  const dirty = Object.keys(changed).length > 0;
  const empty = Object.values(changed).some((v) => !v.trim());

  return (
    <form className="space-y-3 rounded-[var(--radius-control)] border border-teal/60 bg-surface p-3" onSubmit={(event) => { event.preventDefault(); if (dirty && !empty) onSave(changed); }}>
      {fields.map(({ field, label, long }) => (
        <div key={field}>
          <label htmlFor={`edit-${shown.id}-${field}`} className="mb-1 block text-xs font-medium text-text-muted">{label}</label>
          {long ? (
            <textarea id={`edit-${shown.id}-${field}`} rows={3} value={values[field]} onChange={(e) => setValues({ ...values, [field]: e.target.value })} className={inputClass} />
          ) : (
            <input id={`edit-${shown.id}-${field}`} value={values[field]} onChange={(e) => setValues({ ...values, [field]: e.target.value })} className={inputClass} />
          )}
        </div>
      ))}
      <p className="text-xs text-text-muted">
        Your wording is saved as written. Numbers you type are yours and are not checked. Saving makes a new version and clears approval.
      </p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" compact disabled={pending || !dirty || empty}>{pending ? "Saving…" : "Save as a new version"}</Button>
        <Button type="button" compact variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

/**
 * One block with its review tools: comment, edit by hand, and the comments already made on it. The block is
 * shown unchanged until a proposal is accepted or an edit is saved, and either one creates a new version.
 */
export function BlockReview({
  block, shown, artifactId, versionId, canAct, comments, onChanged, children,
}: {
  block: Block;
  /** The same block with metric values filled in, which is what the person sees and edits. */
  shown: Block;
  artifactId: string;
  versionId: string;
  canAct: boolean;
  comments: CommentView[];
  /** Called after a new version was saved, so the pane can move to it. */
  onChanged: () => void;
  children: ReactNode;
}) {
  const [mode, setMode] = useState<"view" | "comment" | "edit">("view");
  const [selection, setSelection] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const create = useCreateComment(artifactId);
  const edit = useManualEdit(artifactId);
  const canComment = block.type !== "metric_table";
  const visible = comments.filter((c) => ["open", "proposed", "stale", "failed"].includes(c.status));
  const resolved = comments.filter((c) => c.status === "accepted");

  const startComment = () => {
    const text = window.getSelection()?.toString().trim();
    const anchor = window.getSelection()?.anchorNode;
    setSelection(text && anchor && root.current?.contains(anchor) ? text.slice(0, 500) : null);
    setMode("comment");
  };

  return (
    <div ref={root} className="group relative">
      {mode === "edit" ? (
        <BlockEditor
          shown={shown}
          pending={edit.isPending}
          error={edit.error ? (edit.error as Error).message : null}
          onCancel={() => { edit.reset(); setMode("view"); }}
          onSave={(fields) => edit.mutate({ baseVersionId: versionId, blockId: block.id, fields }, { onSuccess: () => { setMode("view"); onChanged(); } })}
        />
      ) : (
        <>
          {children}
          {canAct && mode === "view" && (
            <div className="absolute -top-3 right-0 flex gap-1 rounded-full border border-border bg-surface px-1 py-0.5 opacity-100 shadow-sm md:opacity-0 md:transition-opacity md:group-focus-within:opacity-100 md:group-hover:opacity-100">
              {canComment && (
                <button
                  type="button"
                  // Keep the reader's highlighted text when the button is pressed.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={startComment}
                  className="inline-flex min-h-7 items-center gap-1 rounded-full px-2 text-xs font-medium text-text-muted hover:bg-surface-muted hover:text-text"
                >
                  <MessageSquarePlus size={13} aria-hidden /> Comment<span className="sr-only"> on this block</span>
                </button>
              )}
              <button type="button" onClick={() => setMode("edit")} className="inline-flex min-h-7 items-center gap-1 rounded-full px-2 text-xs font-medium text-text-muted hover:bg-surface-muted hover:text-text">
                <Pencil size={13} aria-hidden /> Edit<span className="sr-only"> this block</span>
              </button>
            </div>
          )}
        </>
      )}

      {mode === "comment" && (
        <CommentComposer
          selection={selection}
          pending={create.isPending}
          error={create.error ? (create.error as Error).message : null}
          onCancel={() => { create.reset(); setMode("view"); }}
          onSend={(body) => create.mutate({ versionId, blockId: block.id, body, selection: selection ?? undefined }, { onSuccess: () => setMode("view") })}
        />
      )}

      {canAct && visible.length > 0 && (
        <ul className="mt-2 space-y-2" aria-label="Comments on this block">
          {visible.map((comment) => <CommentThread key={comment.id} comment={comment} artifactId={artifactId} onVersion={onChanged} />)}
        </ul>
      )}
      {canAct && resolved.length > 0 && (
        <p className="mt-1.5 text-xs text-text-muted">{resolved.length} accepted comment edit{resolved.length > 1 ? "s" : ""} on this block</p>
      )}
    </div>
  );
}
