"use client";

import { ScanSearch } from "lucide-react";
import { useWorkspace } from "@/components/workspace/context";
import { cn } from "@/lib/cn";
import { extractIds } from "@/lib/format";
import type { Block, Metric, ModelCallView, ProducedBy } from "@/lib/types";

const shortModel = (model: string) => model.replace(/^[^/]+\//, "");

export function XrayToggle({ className }: { className?: string }) {
  const { xray, setXray } = useWorkspace();
  return (
    <button
      type="button"
      onClick={() => setXray(!xray)}
      aria-pressed={xray}
      title="Show where every claim came from"
      className={cn(
        "inline-flex min-h-8 items-center gap-1.5 rounded-[var(--radius-control)] border px-3 text-sm font-medium transition-colors",
        xray ? "border-amber-dark bg-amber-light text-amber-dark" : "border-border-strong bg-surface text-text hover:bg-surface-muted",
        className,
      )}
    >
      <ScanSearch size={15} aria-hidden /> X-ray {xray ? "on" : "off"}
    </button>
  );
}

function modelFor(produced: ProducedBy | undefined, task: string): string | null {
  const found = produced?.models.find((m) => m.task === task);
  return found ? shortModel(found.model) : null;
}

/** What stands behind one block: which calculated values it uses, what checked them, and what wrote the words. */
export function BlockXray({ block, metrics, produced, observationOrder }: { block: Block; metrics: Record<string, Metric>; produced?: ProducedBy; observationOrder: string[] }) {
  const { xray } = useWorkspace();
  if (!xray) return null;

  const ids = new Set<string>();
  const collect = (text: string) => extractIds(text).forEach((id) => ids.add(id));
  switch (block.type) {
    case "heading":
    case "paragraph":
    case "limitation":
      collect(block.text);
      break;
    case "observation":
      collect(block.text);
      block.metricIds.forEach((id) => ids.add(id));
      break;
    case "hypothesis":
      collect(block.text);
      break;
    case "recommendation":
      [block.text, block.reasoning, block.measurement, block.limitation].forEach(collect);
      break;
    case "experiment":
      [block.title, block.hypothesis, block.design, block.measurement, block.limitation].forEach(collect);
      break;
    case "metric_table":
      for (const scope of block.scopes) for (const name of block.metrics) ids.add(`metric:${scope.scopeId}:${name}`);
      break;
  }
  const known = [...ids].filter((id) => metrics[id]);
  const rows = [...new Set(known.flatMap((id) => metrics[id]!.rowIds))];
  const writer = modelFor(produced, "explain");

  const parts: string[] = [];
  if (block.type === "metric_table") parts.push(`All ${known.length} values calculated in code`);
  else if (known.length > 0) parts.push(`${known.length} calculated value${known.length === 1 ? "" : "s"}, each checked against its metric record`);
  else if (block.type === "hypothesis") parts.push("Untested idea, no calculated values");
  else parts.push("No calculated values");
  if (block.type === "observation") parts.push("causal wording rejected");
  if ((block.type === "recommendation" || block.type === "experiment") && block.basedOn.length > 0) {
    parts.push(`rests on ${block.basedOn.map((id) => `observation ${observationOrder.indexOf(id) + 1 || "?"}`).join(", ")}`);
  }
  if (block.type !== "metric_table") parts.push(writer ? `words by ${writer}` : "words by a model");

  return (
    <p className="mt-1 border-l-2 border-dashed border-amber-dark/50 pl-2.5 font-mono text-[11px] leading-snug text-amber-dark" aria-label="X-ray">
      {parts.join(" · ")}
      {rows.length > 0 && <span className="text-text-muted"> · rows {rows.join(", ")}</span>}
    </p>
  );
}

/** One line under a chat answer: which models gathered and wrote it, and how long the work took. */
export function TurnXray({ calls, tools, claims }: { calls: ModelCallView[] | undefined; tools: number; claims: { verified: number; total: number } | null | undefined }) {
  const { xray } = useWorkspace();
  if (!xray) return null;
  const good = (calls ?? []).filter((c) => !c.error);
  const by = (task: string) => good.find((c) => c.task === task);
  const gather = by("interpret");
  const write = by("explain");
  const ms = good.reduce((sum, c) => sum + (c.durationMs ?? 0), 0);
  const tokens = good.reduce((sum, c) => sum + (c.inputTokens ?? 0) + (c.outputTokens ?? 0), 0);
  return (
    <p className="border-l-2 border-dashed border-amber-dark/50 pl-2.5 font-mono text-[11px] leading-snug text-amber-dark">
      {calls === undefined ? "Loading the record" : (
        <>
          gathered by {gather ? shortModel(gather.actualModel ?? gather.requestedModel) : "unavailable"} · written by {write ? shortModel(write.actualModel ?? write.requestedModel) : "unavailable"}
          {" · "}{tools} tool call{tools === 1 ? "" : "s"} · {good.length} model call{good.length === 1 ? "" : "s"} · {(ms / 1000).toFixed(1)} s of model time · {tokens.toLocaleString()} tokens
          {claims && claims.total > 0 ? ` · ${claims.verified}/${claims.total} numbers verified` : ""}
        </>
      )}
    </p>
  );
}
