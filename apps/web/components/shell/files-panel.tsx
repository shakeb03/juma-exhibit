"use client";

import { ChevronDown, ChevronRight, FileSpreadsheet, FileText, GripVertical, Paperclip, Lock } from "lucide-react";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge, Button, EmptyState, Skeleton } from "@/components/ui";
import { useWorkspace } from "@/components/workspace/context";
import { KIND_LABEL, formatBytes } from "@/lib/format";
import { useClients, useSourcePreview, useSources } from "@/lib/hooks";
import type { ClientSummary, SourceSummary } from "@/lib/types";

export const DRAG_TYPE = "application/x-exhibit-source";

function scopeLabel(source: SourceSummary, client: ClientSummary | undefined): { text: string; tone: "success" | "danger" | "neutral" } {
  if (source.kind === "campaign_data" && client) {
    return client.sharing.performancePatterns ? { text: "Performance patterns approved", tone: "success" } : { text: "Performance restricted", tone: "danger" };
  }
  if ((source.kind === "creative_references" || source.kind === "creative_image") && client) {
    return client.sharing.creativeAssets ? { text: "Creative assets approved", tone: "success" } : { text: "Creative restricted", tone: "danger" };
  }
  if (source.kind === "new_client_brief") return { text: "Supplied by the agency", tone: "neutral" };
  return { text: "Private to this client", tone: "neutral" };
}

function FileRow({ source, client, currentClientId }: { source: SourceSummary; client?: ClientSummary; currentClientId: string | null }) {
  const [open, setOpen] = useState(false);
  const { attachments, addAttachment, removeAttachment } = useWorkspace();
  const preview = useSourcePreview(open ? source.id : null);
  const scope = scopeLabel(source, client);
  const attachable = Boolean(currentClientId) && source.clientId === currentClientId;
  const attached = attachments.includes(source.id);
  const Icon = source.mimeType === "text/csv" ? FileSpreadsheet : FileText;

  return (
    <li className="rounded-[var(--radius-control)] hover:bg-surface-muted">
      <div
        className="flex items-center gap-1.5 px-1.5 py-1"
        draggable={attachable}
        onDragStart={(event) => {
          event.dataTransfer.setData(DRAG_TYPE, source.id);
          event.dataTransfer.effectAllowed = "copy";
        }}
      >
        <GripVertical size={14} className={attachable ? "text-border-strong" : "text-transparent"} aria-hidden />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left"
        >
          <Icon size={16} className="shrink-0 text-text-muted" aria-hidden />
          <span className="min-w-0">
            <span className="block truncate text-sm">{source.name}</span>
            <span className="block truncate text-xs text-text-muted">{KIND_LABEL[source.kind] ?? source.kind} · {scope.text}</span>
          </span>
        </button>
        {attachable && (
          <Button
            variant={attached ? "primary" : "ghost"}
            compact
            aria-pressed={attached}
            aria-label={attached ? `Remove ${source.name} from the next request` : `Attach ${source.name} to the next request`}
            onClick={() => (attached ? removeAttachment(source.id) : addAttachment(source.id))}
          >
            <Paperclip size={14} aria-hidden /> {attached ? "Attached" : "Attach"}
          </Button>
        )}
      </div>
      {open && (
        <div className="mx-2 mb-2 rounded-[var(--radius-control)] border border-border bg-surface p-3 text-xs">
          <div className="mb-2 flex items-center justify-between gap-2 text-text-muted">
            <span>{formatBytes(source.sizeBytes)}</span>
            {!attachable && source.clientId && <span>Open this client to attach</span>}
          </div>
          {preview.isLoading && <Skeleton className="h-16 w-full" />}
          {preview.isError && <p role="alert" className="text-danger">Preview unavailable. Try again.</p>}
          {preview.data && (
            <>
              <pre className="scroll-quiet max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">{preview.data.text}</pre>
              {preview.data.truncated && <p className="mt-2 text-text-muted">Showing the first {preview.data.text.length.toLocaleString()} of {preview.data.totalChars.toLocaleString()} characters.</p>}
            </>
          )}
        </div>
      )}
    </li>
  );
}

function Group({ title, badge, children, defaultOpen }: { title: string; badge?: React.ReactNode; children: React.ReactNode; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-1.5 rounded-md px-1 py-1.5 text-left">
        {open ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
        <span className="text-sm font-medium">{title}</span>
        {badge}
      </button>
      {open && <ul className="mt-0.5">{children}</ul>}
    </section>
  );
}

/** Demo files, grouped by client. Drag a row onto the composer or use Attach; both go through the same checks. */
export function FilesPanel() {
  const params = useParams<{ id?: string }>();
  const currentClientId = params.id ?? null;
  const clients = useClients();
  const sources = useSources();

  const groups = useMemo(() => {
    const bySource = new Map<string | null, SourceSummary[]>();
    for (const source of sources.data ?? []) bySource.set(source.clientId, [...(bySource.get(source.clientId) ?? []), source]);
    return bySource;
  }, [sources.data]);

  if (sources.isLoading || clients.isLoading) {
    return (
      <div className="space-y-3 p-5" aria-busy>
        <Skeleton className="h-5 w-40" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (sources.isError || clients.isError) {
    return <EmptyState title="Files could not load" action={<Button onClick={() => { sources.refetch(); clients.refetch(); }}>Try again</Button>}>Your files are safe. This is only the list.</EmptyState>;
  }

  const clientList = clients.data ?? [];
  const canvasLevel = groups.get(null) ?? [];

  return (
    <div className="space-y-1 px-4 pb-4">
      {clientList.map((client) => {
        const list = groups.get(client.id) ?? [];
        const own = list.filter((s) => s.kind !== "attachment");
        const challenges = list.filter((s) => s.kind === "attachment");
        return (
          <Group
            key={`${client.id}:${client.id === currentClientId}`}
            title={client.name}
            defaultOpen={client.id === currentClientId}
            badge={!client.sharing.performancePatterns && !client.sharing.creativeAssets ? <Badge tone="danger"><Lock size={11} aria-hidden /> Restricted</Badge> : undefined}
          >
            {own.map((s) => <FileRow key={s.id} source={s} client={client} currentClientId={currentClientId} />)}
            {challenges.length > 0 && <li className="px-2 pt-2 text-xs font-medium text-text-muted">Challenge files</li>}
            {challenges.map((s) => <FileRow key={s.id} source={s} client={client} currentClientId={currentClientId} />)}
          </Group>
        );
      })}
      {canvasLevel.length > 0 && (
        <Group title="New-client briefs" defaultOpen={false}>
          {canvasLevel.map((s) => <FileRow key={s.id} source={s} currentClientId={currentClientId} />)}
        </Group>
      )}
    </div>
  );
}
