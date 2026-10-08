"use client";

import { CheckCircle2, Download, FileText, History, X } from "lucide-react";
import { useState } from "react";
import { Badge, Button, EmptyState, ErrorNote, Skeleton } from "@/components/ui";
import { accentFor, formatDateTime, KIND_LABEL } from "@/lib/format";
import { useApproveVersion, useArtifact, useArtifactVersion, useExportPdf } from "@/lib/hooks";
import type { ArtifactSummary } from "@/lib/types";
import { BlockView } from "./blocks";

const CAUSE_LABEL: Record<string, string> = { turn: "Requested in chat", comment: "Accepted comment edit", manual: "Manual edit" };

function VersionMenu({ summary, selected, onSelect }: { summary: ArtifactSummary; selected: string; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button compact onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="listbox">
        <History size={15} aria-hidden /> Versions
      </Button>
      {open && (
        <ul role="listbox" aria-label="Versions" className="fade-in absolute right-0 z-10 mt-1 w-64 rounded-[var(--radius-control)] border border-border bg-surface p-1 shadow-float">
          {[...summary.versions].reverse().map((v) => (
            <li key={v.id}>
              <button
                role="option"
                aria-selected={v.id === selected}
                onClick={() => { onSelect(v.id); setOpen(false); }}
                className={`flex w-full flex-col rounded-md px-3 py-2 text-left hover:bg-surface-muted ${v.id === selected ? "bg-aqua/60" : ""}`}
              >
                <span className="text-sm font-medium">Version {v.version}{v.approved ? " · Approved" : ""}</span>
                <span className="text-xs text-text-muted">{CAUSE_LABEL[v.causeKind] ?? v.causeKind} · {formatDateTime(v.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The deliverable beside the conversation: a clean document with its own scroll, distinct from chat. */
export function ArtifactPane({
  artifactId,
  latestVersionId,
  selectedVersionId,
  onSelectVersion,
  clientSlug,
  onAsk,
  onClose,
  stale = [],
}: {
  artifactId: string | null;
  latestVersionId: string | null;
  selectedVersionId: string | null;
  onSelectVersion: (id: string | null) => void;
  clientSlug: string;
  onAsk: (text: string) => void;
  /** Hides the artifact so the conversation takes the full width again. */
  onClose: () => void;
  stale?: string[];
}) {
  const shownId = selectedVersionId ?? latestVersionId;
  const version = useArtifactVersion(shownId);
  const summary = useArtifact(artifactId, latestVersionId);
  const accent = accentFor(clientSlug);
  const approve = useApproveVersion(artifactId);
  const exportPdf = useExportPdf();

  if (!artifactId || !shownId) {
    return (
      <EmptyState
        title="No artifact yet"
        action={<Button onClick={() => onAsk("Create a performance report for our last two Pinterest campaigns.")}>Draft a report request</Button>}
      >
        Ask a question first. When you want finished work, ask for a report, brief, summary, concepts, or an experiment plan.
      </EmptyState>
    );
  }
  if (version.isLoading) {
    return (
      <div className="space-y-3 p-6" aria-busy aria-label="Loading artifact">
        <Skeleton className="h-6 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /><Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (version.isError || !version.data) {
    return <div className="p-6"><ErrorNote title="This version could not load" action={<Button onClick={() => version.refetch()}>Try again</Button>}>The artifact is saved. Only the view failed.</ErrorNote></div>;
  }

  const data = version.data;
  const isLatest = shownId === latestVersionId;
  const title = summary.data?.artifact.title;
  const claims = data.checks.claims;
  const approvedEarlier = [...(summary.data?.versions ?? [])].reverse().find((v) => v.approved && v.id !== data.id);

  return (
    <article className="flex h-full min-h-0 flex-col" aria-label={`${KIND_LABEL[data.kind] ?? "Artifact"}, version ${data.version}`}>
      <header className="shrink-0 border-b border-border px-5 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="aqua"><FileText size={12} aria-hidden /> {KIND_LABEL[data.kind] ?? data.kind}</Badge>
          <Badge>Version {data.version}</Badge>
          {data.approval ? (
            <Badge tone="success"><CheckCircle2 size={12} aria-hidden /> Approved {formatDateTime(data.approval.approvedAt)}</Badge>
          ) : (
            <Badge tone="amber">Draft</Badge>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close artifact"
            title="Close artifact"
            className="ml-auto inline-flex size-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-muted hover:text-text"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {!data.approval && (
            <Button
              variant="primary"
              compact
              disabled={approve.isPending || (isLatest && stale.length > 0)}
              onClick={() => approve.mutate(data.id)}
              title={isLatest && stale.length > 0 ? "Run this again before approving, because its sources changed." : "Approve exactly this version"}
            >
              <CheckCircle2 size={15} aria-hidden /> {approve.isPending ? "Approving…" : "Approve this version"}
            </Button>
          )}
          <Button compact disabled={exportPdf.isPending} onClick={() => exportPdf.mutate(data.id)}>
            <Download size={15} aria-hidden /> {exportPdf.isPending ? "Preparing PDF…" : data.approval ? "Download approved PDF" : "Download draft PDF"}
          </Button>
          <div className="ml-auto">{summary.data && <VersionMenu summary={summary.data} selected={shownId} onSelect={(id) => onSelectVersion(id === latestVersionId ? null : id)} />}</div>
        </div>
        {(approve.isError || exportPdf.isError) && (
          <p role="alert" className="mt-2 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
            {((approve.error ?? exportPdf.error) as Error).message}
          </p>
        )}
        {!data.approval && isLatest && approvedEarlier && (
          <p className="mt-2 text-sm text-text-muted" role="status">Changed since version {approvedEarlier.version} was approved. This version needs its own approval.</p>
        )}
        {stale.length > 0 && isLatest && (
          <p role="status" className="mt-2 rounded-md bg-amber-light px-3 py-2 text-sm text-amber-dark">
            <span className="font-medium">Out of date.</span> {stale.join(" ")}
          </p>
        )}
        {!isLatest && (
          <p className="mt-2 flex items-center gap-2 text-sm text-text-muted" role="status">
            You are viewing an earlier version.
            <button className="font-medium text-teal underline underline-offset-2" onClick={() => onSelectVersion(null)}>Open the latest</button>
          </p>
        )}
      </header>

      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto bg-background px-4 py-5">
        <div className="mx-auto max-w-[720px] rounded-[var(--radius-card)] border border-border bg-surface px-7 py-7">
          <div className="mb-5 pb-4" style={{ borderBottom: `3px solid ${accent}` }}>
            <p className="text-xs text-text-muted">{KIND_LABEL[data.kind] ?? data.kind} · Version {data.version} · {formatDateTime(data.createdAt)}</p>
            {title && <h1 className="mt-1 text-[24px] font-medium tracking-tight">{title}</h1>}
          </div>
          <div className="space-y-4">
            {data.blocks.map((block) => (
              <BlockView
                key={block.id}
                block={block}
                metrics={data.metrics}
                accent={accent}
                produced={data.produced}
                observationOrder={data.blocks.filter((b) => b.type === "observation").map((b) => b.id)}
              />
            ))}
          </div>
          <footer className="mt-6 border-t border-border pt-3 text-xs text-text-muted">
            {claims && <p className="tabular">Numerical claims verified: {claims.verified}/{claims.total}</p>}
            <p className="mt-1">Synthetic data for a fictional client. {data.approval ? `Approved ${formatDateTime(data.approval.approvedAt)}.` : "Draft, not yet approved."}</p>
          </footer>
        </div>
      </div>
    </article>
  );
}
