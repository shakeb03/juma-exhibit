"use client";

import { ChevronDown, ChevronUp, BookOpen } from "lucide-react";
import { useState } from "react";
import { Skeleton } from "@/components/ui";
import { useClientProfile } from "@/lib/hooks";

function Field({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-text-muted">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-line text-sm">{text || <span className="text-text-muted">None stored</span>}</dd>
    </div>
  );
}

/** What the workspace already knows, so nobody re-briefs. Inspectable without hiding the chat. */
export function ContextPanel({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const profile = useClientProfile(clientId);
  return (
    <section aria-label="Context held for this client" className="border-b border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-5 py-2 text-left text-sm text-text-muted hover:bg-surface-muted"
      >
        <BookOpen size={15} aria-hidden />
        <span className="font-medium text-text">Context the workspace already holds</span>
        <span className="hidden sm:inline">brand voice, audience, goals, constraints, files</span>
        {open ? <ChevronUp size={15} className="ml-auto" aria-hidden /> : <ChevronDown size={15} className="ml-auto" aria-hidden />}
      </button>
      {open && (
        <div className="scroll-quiet fade-in max-h-[40vh] overflow-y-auto border-t border-border px-5 py-4">
          {profile.isLoading && <div className="space-y-2"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-12 w-full" /></div>}
          {profile.data && (
            <dl className="grid gap-4 md:grid-cols-2">
              <Field label="Brand voice" text={profile.data.brandVoice} />
              <Field label="Audience" text={profile.data.audience} />
              <Field label="Goals" text={profile.data.goals} />
              <Field label="Constraints" text={profile.data.constraints} />
              <div className="md:col-span-2"><Field label="Standing instructions" text={profile.data.standingInstructions} /></div>
            </dl>
          )}
        </div>
      )}
    </section>
  );
}
