import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANT: Record<Variant, string> = {
  primary: "bg-teal text-white hover:bg-teal-dark disabled:bg-border-strong",
  secondary: "border border-border-strong bg-surface text-text hover:bg-surface-muted",
  ghost: "text-text hover:bg-surface-muted",
  danger: "bg-danger text-white hover:opacity-90",
};

export function Button({
  variant = "secondary",
  compact = false,
  className,
  ref,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; compact?: boolean; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={ref}
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        compact ? "min-h-8 px-3" : "min-h-10 px-4",
        VARIANT[variant],
        className,
      )}
    />
  );
}

const TONE = {
  neutral: "bg-surface-muted text-text-muted",
  aqua: "bg-aqua text-text",
  success: "bg-observation-bg text-success",
  amber: "bg-amber-light text-amber-dark",
  teal: "bg-recommendation-bg text-teal",
  danger: "bg-danger-bg text-danger",
} as const;

export function Badge({ tone = "neutral", children, className }: { tone?: keyof typeof TONE; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium", TONE[tone], className)}>{children}</span>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}

/** One sentence on what belongs here, one action to fill it. */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid place-items-center px-6 py-10 text-center">
      <div className="max-w-xs">
        <p className="text-sm font-medium">{title}</p>
        {children && <p className="mt-1 text-sm text-text-muted">{children}</p>}
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}

export function ErrorNote({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div role="alert" className="rounded-[var(--radius-control)] border border-danger/30 bg-danger-bg p-4 text-sm">
      <p className="font-medium text-danger">{title}</p>
      {children && <p className="mt-1 text-text">{children}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
