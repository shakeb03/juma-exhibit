/** Keys whose values are credentials. Token *counts* such as max_tokens are deliberately not matched. */
const SECRET_KEY = /^(authorization|cookie|set-cookie|x-proxy-secret|x-csrf-token|api[-_]?key|apikey|password|secret|access[-_]?token|refresh[-_]?token|session[-_]?token|ticket|token)$|(_secret|Secret|_api_key|ApiKey)$/i;
const SECRET_VALUE = [/sk-or-[A-Za-z0-9_-]{8,}/g, /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g];

export const REDACTED = "[redacted]";

/** Deep copy with credentials replaced. Safe for anything that is about to be stored or displayed. */
export function redact<T>(value: T): T {
  if (typeof value === "string") {
    let text: string = value;
    for (const pattern of SECRET_VALUE) text = text.replace(pattern, REDACTED);
    return text as T;
  }
  if (Array.isArray(value)) return value.map((item) => redact(item)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = SECRET_KEY.test(key) ? REDACTED : redact(item);
    return out as T;
  }
  return value;
}

export interface Bounded {
  value: unknown;
  truncated: boolean;
}

/**
 * Keep stored payloads within a size limit. Over the limit, the payload is replaced by a visible marker
 * with a preview, never silently cut, so reviewers know what they are looking at.
 */
export function bound(value: unknown, maxBytes: number): Bounded {
  if (value === undefined) return { value: undefined, truncated: false };
  const json = JSON.stringify(value);
  const size = Buffer.byteLength(json);
  if (size <= maxBytes) return { value, truncated: false };
  return {
    value: {
      _truncated: true,
      originalBytes: size,
      limitBytes: maxBytes,
      preview: json.slice(0, Math.max(0, Math.min(2000, maxBytes - 200))),
    },
    truncated: true,
  };
}

/** Redact first, then bound, which is the order everything stored for the geek panel goes through. */
export function prepare(value: unknown, maxBytes: number): Bounded {
  return bound(redact(value), maxBytes);
}
