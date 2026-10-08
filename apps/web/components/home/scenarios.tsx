"use client";

import { ArrowRight, Brain, FlaskConical, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { ClientSummary } from "@/lib/types";

export const SCENARIO_PROMPTS = {
  evidence: "Compare our last two Pinterest campaigns. Explain what changed and suggest what we should try next.",
  memory: "Write the September performance report for Elise.",
} as const;

/** Three guided starting points. Each runs the real system; free-form input is always available. */
export function Scenarios({ clients }: { clients: ClientSummary[] }) {
  const ridgeline = clients.find((c) => c.slug === "ridgeline-outfitters");
  const marlowe = clients.find((c) => c.slug === "marlowe-finch");

  const cards = [
    {
      key: "evidence",
      icon: FlaskConical,
      title: "Ask for evidence",
      line: "Get a recommendation, then see the records and calculations behind every number.",
      href: ridgeline ? `/clients/${ridgeline.id}?scenario=evidence` : null,
      cta: "Compare two campaigns",
    },
    {
      key: "permissions",
      icon: ShieldCheck,
      title: "Respect permissions",
      line: "Combine approved patterns from two brands, and watch restricted material stay out.",
      href: "/intelligence",
      cta: "Open the canvas",
    },
    {
      key: "memory",
      icon: Brain,
      title: "Skip the re-brief",
      line: "Ask for a report without explaining the brand. The workspace already knows it.",
      href: marlowe ? `/clients/${marlowe.id}?scenario=memory` : null,
      cta: "Write a report",
    },
  ];

  return (
    <section aria-labelledby="scenarios-heading">
      <h2 id="scenarios-heading" className="text-[13px] font-medium text-text-muted">Try the real system</h2>
      <ul className="mt-3 grid gap-3 md:grid-cols-3">
        {cards.map(({ key, icon: Icon, title, line, href, cta }) => (
          <li key={key}>
            {href ? (
              <Link href={href} className="group flex h-full flex-col rounded-[var(--radius-card)] border border-border bg-surface p-5 transition-colors hover:bg-aqua/40">
                <Icon size={20} className="text-teal" aria-hidden />
                <h3 className="mt-3 text-[15px] font-medium">{title}</h3>
                <p className="mt-1 flex-1 text-sm text-text-muted">{line}</p>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-teal">
                  {cta} <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
              </Link>
            ) : (
              <div className="skeleton h-full min-h-[148px] rounded-[var(--radius-card)]" aria-hidden />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
