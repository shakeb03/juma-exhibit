"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

const MAX_SHOWN = 24_000;

/** Raw, monospaced, copyable. Redacted values are marked, and a truncated payload says how much was kept. */
export function PayloadView({ value, label }: { value: unknown; label: string }) {
  const [all, setAll] = useState(false);
  const [copied, setCopied] = useState(false);

  if (value === undefined || value === null) {
    return <p className="rounded-md bg-geek-bg px-3 py-2 font-mono text-xs text-geek-muted">{label}: unavailable</p>;
  }
  const marker = (value as { _truncated?: boolean; originalBytes?: number; limitBytes?: number })?._truncated ? (value as { originalBytes: number; limitBytes: number }) : null;
  const text = JSON.stringify(value, null, 2);
  const shown = all || text.length <= MAX_SHOWN ? text : text.slice(0, MAX_SHOWN);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard can be blocked; the text stays selectable */
    }
  }

  // Mark [redacted] so a reader can see that something was withheld rather than absent.
  const parts = shown.split("[redacted]");
  return (
    <div className="rounded-md bg-geek-bg">
      <div className="flex items-center justify-between gap-2 border-b border-geek-border px-3 py-1.5">
        <span className="font-mono text-xs text-geek-muted">{label}</span>
        <button type="button" onClick={copy} className="flex min-h-7 items-center gap-1.5 rounded px-2 text-xs text-geek-muted hover:bg-geek-raised hover:text-geek-text" aria-label={`Copy ${label}`}>
          {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {marker && (
        <p className="border-b border-geek-border bg-geek-amber/10 px-3 py-1.5 font-mono text-xs text-geek-amber" role="note">
          Truncated: this payload was {marker.originalBytes.toLocaleString()} bytes, over the {marker.limitBytes.toLocaleString()} byte limit. Showing a preview.
        </p>
      )}
      <pre className="scroll-quiet max-h-80 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[11.5px] leading-relaxed text-geek-text">
        {parts.map((part, index) => (
          <span key={index}>
            {part}
            {index < parts.length - 1 && <mark className="rounded bg-geek-red/20 px-1 text-geek-red">[redacted]</mark>}
          </span>
        ))}
      </pre>
      {!all && text.length > MAX_SHOWN && (
        <button type="button" onClick={() => setAll(true)} className="w-full border-t border-geek-border px-3 py-1.5 text-left text-xs text-geek-teal hover:bg-geek-raised">
          Show all {text.length.toLocaleString()} characters
        </button>
      )}
    </div>
  );
}
