import { CheckCircle2, FlaskConical, Info, Lightbulb, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Kind = "observation" | "hypothesis" | "recommendation" | "note" | "limitation";

/**
 * The three content types look different without relying on colour: a label, an icon, and a border style
 * (solid, dashed, or double) each carry the meaning. Order is always observation, hypothesis, recommendation.
 */
const STYLE: Record<Kind, { label: string; short: string; icon: typeof Info; bar: string; tint: string; ink: string }> = {
  observation: { label: "Observation: supported by supplied data", short: "Observation", icon: CheckCircle2, bar: "border-l-[3px] border-solid border-success", tint: "bg-observation-bg", ink: "text-success" },
  hypothesis: { label: "Hypothesis: possible explanation, untested", short: "Hypothesis, untested", icon: Lightbulb, bar: "border-l-[3px] border-dashed border-amber-dark", tint: "bg-amber-light", ink: "text-amber-dark" },
  recommendation: { label: "Experiment: something to test next", short: "Experiment", icon: FlaskConical, bar: "border-l-[5px] border-double border-teal", tint: "bg-recommendation-bg", ink: "text-teal" },
  note: { label: "Note", short: "Note", icon: Info, bar: "border-l-[3px] border-solid border-border-strong", tint: "bg-surface-muted", ink: "text-text-muted" },
  limitation: { label: "Limitation", short: "Limitation", icon: TriangleAlert, bar: "border-l-[3px] border-dotted border-text-muted", tint: "bg-surface-muted", ink: "text-text-muted" },
};

interface Props {
  kind: Kind;
  children: ReactNode;
  /** Reasoning, measurement, and limitation for a recommendation. */
  details?: { label: string; content: ReactNode }[];
  className?: string;
  /**
   * "card" is the full tinted treatment used in deliverables. "inline" is for chat: the same label, icon, and
   * border style, but no fill, so a long answer reads as prose with margin labels instead of a stack of boxes.
   */
  variant?: "card" | "inline";
}

export function Statement({ kind, children, details, className, variant = "card" }: Props) {
  const style = STYLE[kind];
  const Icon = style.icon;
  const inline = variant === "inline";

  const detailList = details && details.length > 0 && (
    <dl className="space-y-1.5 text-sm">
      {details.map((d) => (
        <div key={d.label}>
          <dt className="inline text-xs font-medium text-text-muted">{d.label}: </dt>
          <dd className="inline text-text">{d.content}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <section
      className={cn("fade-in", style.bar, inline ? "py-0.5 pl-3" : cn("rounded-r-[var(--radius-control)] py-2.5 pl-3.5 pr-3", style.tint), className)}
      aria-label={style.label}
    >
      <p className={cn("flex items-center gap-1.5 text-xs font-medium", style.ink)}>
        <Icon size={14} aria-hidden /> {inline ? style.short : style.label}
      </p>
      <div className={cn("mt-0.5 text-[15px] leading-relaxed text-text")}>{children}</div>
      {detailList && !inline && <div className="mt-2">{detailList}</div>}
      {detailList && inline && (
        <details className="group mt-1">
          <summary className="cursor-pointer text-xs font-medium text-teal underline-offset-2 hover:underline">Why, how to measure, limits</summary>
          <div className="mt-1.5">{detailList}</div>
        </details>
      )}
    </section>
  );
}
