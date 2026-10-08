"use client";

import { ChevronDown, ChevronRight, FileCode2, Folder } from "lucide-react";
import { useMemo, useState } from "react";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import { highlight } from "@/lib/highlight";
import { useFrontendCommit, useRepoFile, useRepoTree, useRepositoryMeta } from "@/lib/hooks";

interface Node {
  name: string;
  path: string;
  size?: number;
  children?: Node[];
}

function buildTree(entries: { path: string; size: number }[]): Node[] {
  const root: Node = { name: "", path: "", children: [] };
  for (const entry of entries) {
    const parts = entry.path.split("/");
    let cursor = root;
    parts.forEach((part, index) => {
      const last = index === parts.length - 1;
      const path = parts.slice(0, index + 1).join("/");
      let child = cursor.children!.find((c) => c.name === part);
      if (!child) {
        child = last ? { name: part, path, size: entry.size } : { name: part, path, children: [] };
        cursor.children!.push(child);
      }
      cursor = child;
    });
  }
  const sort = (nodes: Node[]) => {
    nodes.sort((a, b) => Number(Boolean(b.children)) - Number(Boolean(a.children)) || a.name.localeCompare(b.name));
    nodes.forEach((n) => n.children && sort(n.children));
  };
  sort(root.children!);
  return root.children!;
}

function TreeNodes({ nodes, depth, open, toggle, selected, onSelect }: {
  nodes: Node[]; depth: number; open: Set<string>; toggle: (path: string) => void; selected: string | null; onSelect: (path: string) => void;
}) {
  return (
    <ul role={depth === 0 ? "tree" : "group"}>
      {nodes.map((node) => {
        const isOpen = open.has(node.path);
        return (
          <li key={node.path} role="treeitem" aria-expanded={node.children ? isOpen : undefined} aria-selected={!node.children && selected === node.path}>
            <button
              type="button"
              onClick={() => (node.children ? toggle(node.path) : onSelect(node.path))}
              style={{ paddingLeft: 8 + depth * 12 }}
              className={cn(
                "flex min-h-7 w-full items-center gap-1.5 rounded pr-2 text-left font-mono text-xs hover:bg-geek-raised",
                selected === node.path ? "bg-geek-raised text-geek-teal" : "text-geek-text",
              )}
            >
              {node.children ? (isOpen ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />) : <span className="w-[13px]" />}
              {node.children ? <Folder size={13} className="text-geek-muted" aria-hidden /> : <FileCode2 size={13} className="text-geek-muted" aria-hidden />}
              <span className="truncate">{node.name}</span>
            </button>
            {node.children && isOpen && <TreeNodes nodes={node.children} depth={depth + 1} open={open} toggle={toggle} selected={selected} onSelect={onSelect} />}
          </li>
        );
      })}
    </ul>
  );
}

const GUIDE = [
  { label: "The agent turn", path: "apps/api/src/agent/clientTurn.ts" },
  { label: "Evidence checks", path: "apps/api/src/agent/validate.ts" },
  { label: "Metric calculations", path: "apps/api/src/metrics/calculate.ts" },
  { label: "Permission filter", path: "apps/api/src/permissions/context.ts" },
];

const short = (commit: string | null | undefined) => (commit ? commit.slice(0, 7) : "unavailable");

function Notice({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="max-w-sm">
        <p className="text-sm font-medium text-geek-text">{title}</p>
        <p className="mt-1 text-sm text-geek-muted">{children}</p>
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}

/** The deployed source, fetched from the repository at the running commit. Shown as code, never run as HTML. */
export function CodeBrowser() {
  const meta = useRepositoryMeta(true);
  const frontend = useFrontendCommit(true);
  const tree = useRepoTree(Boolean(meta.data?.configured));
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set(["apps", "apps/api", "apps/api/src"]));
  const nodes = useMemo(() => buildTree(tree.data?.entries ?? []), [tree.data]);
  const path = selected ?? (tree.data?.entries.some((e) => e.path === "README.md") ? "README.md" : (tree.data?.entries[0]?.path ?? null));
  const file = useRepoFile(path, tree.data?.ref ?? null);
  const html = useMemo(() => (file.data ? highlight(file.data.content, file.data.language) : ""), [file.data]);

  const select = (next: string) => {
    setSelected(next);
    // Open every folder above the chosen file so the tree shows where it lives.
    const parts = next.split("/");
    setOpen((prev) => new Set([...prev, ...parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"))]));
  };
  const toggle = (p: string) => setOpen((prev) => { const next = new Set(prev); if (next.has(p)) next.delete(p); else next.add(p); return next; });

  if (meta.isLoading) return <div className="p-6"><div className="h-6 w-48 animate-pulse rounded bg-geek-surface" /></div>;
  if (meta.isError) return <Notice title="The code browser could not start" action={<RetryButton onClick={() => meta.refetch()} />}>The backend could not be reached. Nothing was changed.</Notice>;
  if (!meta.data?.configured) {
    return <Notice title="No repository is connected to this deployment">The source code is shown here once the repository is configured. Until then it is not available in the app.</Notice>;
  }

  const treeError = tree.error instanceof ApiError ? tree.error : null;
  if (tree.isError) {
    return (
      <Notice title={treeError?.status === 502 ? "GitHub could not be reached" : "The code could not be loaded"} action={<RetryButton onClick={() => tree.refetch()} />}>
        {treeError?.message ?? "Try again in a moment."} The deployed code is unchanged.
      </Notice>
    );
  }

  const ref = tree.data?.ref;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 space-y-2 border-b border-geek-border px-5 py-3">
        <p className="font-mono text-[11px] leading-relaxed text-geek-muted">
          {meta.data.owner}/{meta.data.repository} · backend <span className="text-geek-text">{short(meta.data.backendCommit)}</span> · frontend <span className="text-geek-text">{short(frontend.data)}</span>
          {" · "}viewing <span className="text-geek-text">{short(ref)}</span> {tree.data?.pinned ? "(deployed commit, pinned)" : "(branch tip, not a pinned commit)"}
        </p>
        <ul className="flex flex-wrap gap-1.5" aria-label="Where to start">
          {GUIDE.map((g) => (
            <li key={g.path}>
              <button type="button" onClick={() => select(g.path)} className="min-h-7 rounded-full border border-geek-border px-2.5 text-xs text-geek-teal hover:bg-geek-raised">{g.label}</button>
            </li>
          ))}
        </ul>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(150px,240px)_minmax(0,1fr)]">
        <nav aria-label="Files" className="scroll-quiet overflow-y-auto border-r border-geek-border py-2">
          {tree.isLoading ? <div className="space-y-1.5 p-3">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-5 animate-pulse rounded bg-geek-surface" />)}</div> : <TreeNodes nodes={nodes} depth={0} open={open} toggle={toggle} selected={path} onSelect={select} />}
        </nav>
        <div className="flex min-h-0 min-w-0 flex-col bg-geek-bg">
          {path && (
            <p className="shrink-0 truncate border-b border-geek-border px-4 py-2 font-mono text-xs text-geek-muted">
              {path}{file.data ? ` · ${formatBytes(file.data.size)}` : ""}
            </p>
          )}
          <div className="scroll-quiet min-h-0 flex-1 overflow-auto">
            {file.isLoading && <div className="space-y-1.5 p-4">{Array.from({ length: 12 }, (_, i) => <div key={i} className="h-4 animate-pulse rounded bg-geek-surface" style={{ width: `${40 + ((i * 37) % 55)}%` }} />)}</div>}
            {file.isError && <Notice title="That file could not be shown" action={<RetryButton onClick={() => file.refetch()} />}>{file.error instanceof ApiError ? file.error.message : "Try again."}</Notice>}
            {file.data && (
              <div className="flex min-w-max font-mono text-[12px] leading-[1.6]">
                <pre aria-hidden className="select-none border-r border-geek-border px-3 py-3 text-right text-geek-muted/70">{file.data.content.split("\n").map((_, i) => i + 1).join("\n")}</pre>
                <pre className="px-4 py-3"><code className="hljs" dangerouslySetInnerHTML={{ __html: html }} /></pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RetryButton({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="min-h-9 rounded-[var(--radius-control)] border border-geek-teal px-4 text-sm text-geek-teal hover:bg-geek-raised">Try again</button>;
}
