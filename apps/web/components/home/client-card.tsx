"use client";

import { Check, Lock } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { accentFor, initialsOf } from "@/lib/format";
import type { ClientSummary } from "@/lib/types";

/** Brand thumbnail, name, category, and the two approvals shown separately and literally. */
export function ClientCard({ client }: { client: ClientSummary }) {
  const accent = accentFor(client.slug);
  const { performancePatterns, creativeAssets } = client.sharing;
  return (
    <Link
      href={`/clients/${client.id}`}
      className="group block rounded-[var(--radius-card)] border border-border bg-surface p-5 transition-colors hover:bg-surface-muted"
    >
      <div className="flex items-start gap-3">
        <span
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-sm font-medium text-white"
          style={{ backgroundColor: accent }}
          aria-hidden
        >
          {initialsOf(client.name)}
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-[17px] font-medium">{client.name}</h3>
          <p className="truncate text-sm text-text-muted">{client.category}</p>
        </div>
      </div>
      <div className="mt-4 h-0.5 w-10 rounded-full" style={{ backgroundColor: accent }} aria-hidden />
      <ul className="mt-3 space-y-1.5 text-sm" aria-label={`Sharing for ${client.name}`}>
        <li className="flex items-center gap-2">
          {performancePatterns ? <Check size={15} className="text-success" aria-hidden /> : <Lock size={15} className="text-danger" aria-hidden />}
          <span>{performancePatterns ? "Performance patterns approved" : "Performance patterns restricted"}</span>
        </li>
        <li className="flex items-center gap-2">
          {creativeAssets ? <Check size={15} className="text-success" aria-hidden /> : <Lock size={15} className="text-danger" aria-hidden />}
          <span>{creativeAssets ? "Creative assets approved" : "Creative assets restricted"}</span>
        </li>
      </ul>
      <p className="mt-3 text-xs text-text-muted">
        {client.counts.campaigns} campaigns · {client.counts.sources} files
        {client.counts.creativeReferences > 0 && ` · ${client.counts.creativeReferences} creative descriptions`}
      </p>
      <span className="sr-only">Open workspace</span>
    </Link>
  );
}

export function ClientCardSkeleton() {
  return <div className="skeleton h-[196px] rounded-[var(--radius-card)]" aria-hidden />;
}

export { Badge };
