/** "12 Sep 2026, 14:03" style date for versions and records. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)} s` : `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const KIND_LABEL: Record<string, string> = {
  brand_context: "Brand notes",
  brief: "Client brief",
  campaign_data: "Campaign data",
  creative_references: "Creative references",
  creative_image: "Creative image",
  previous_work: "Previous work",
  new_client_brief: "New-client brief",
  reference: "Reference",
  attachment: "Challenge file",
  performance_report: "Performance report",
  campaign_brief: "Campaign brief",
  client_summary: "Client summary",
  campaign_concepts: "Campaign concepts",
  experiment_plan: "Experiment plan",
};

export function periodLabel(period: { first: string; last: string } | null): string {
  if (!period) return "No campaign data";
  const month = (p: string) => new Date(`${p}-01T00:00:00`).toLocaleString("en-GB", { month: "short", year: "numeric" });
  return period.first === period.last ? month(period.last) : `${month(period.first)} to ${month(period.last)}`;
}

/** Each client keeps its own accent on thumbnails, cards, and the artifact title rule. The app shell stays neutral. */
export const BRAND_ACCENT: Record<string, string> = {
  "ridgeline-outfitters": "#b4531a",
  "marlowe-finch": "#2f4b6e",
  "velvet-static": "#6a3a8c",
};
export const accentFor = (slug: string) => BRAND_ACCENT[slug] ?? "#075e61";
export const initialsOf = (name: string) =>
  name.split(/[\s&]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");

/** Split "text {{metric-id}} text" into plain and metric parts so each number can be inspected. */
export type Segment = { type: "text"; value: string } | { type: "metric"; id: string };
export function segmentText(text: string): Segment[] {
  const parts: Segment[] = [];
  let last = 0;
  for (const match of text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    if (match.index! > last) parts.push({ type: "text", value: text.slice(last, match.index) });
    parts.push({ type: "metric", id: match[1]! });
    last = match.index! + match[0].length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts;
}

const CURRENCY_SYMBOL: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };
const num = (value: number, decimals: number) => value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/** Display for an input to a calculation: money as currency, counts with separators, rates by the metric's unit. */
export function formatInput(name: string, value: number | null, metric: { unit: string; change: string; currency: string | null }): string {
  if (value === null) return "unavailable";
  const symbol = metric.currency ? (CURRENCY_SYMBOL[metric.currency] ?? `${metric.currency} `) : "";
  if (name === "from" || name === "to") {
    // Inputs to a comparison are values of the compared metric.
    switch (metric.unit) {
      case "percent": return `${num(value * 100, 2)}%`;
      case "currency": return `${symbol}${num(value, Math.abs(value) >= 1000 ? 0 : 2)}`;
      case "multiple": return `${num(value, 2)}x`;
      case "per1k": return num(value, 2);
      default: return num(value, 0);
    }
  }
  if (name === "spend" || name === "revenue") return `${symbol}${num(value, Math.abs(value) >= 1000 ? 0 : 2)}`;
  return num(value, Number.isInteger(value) ? 0 : 2);
}

/** Every metric id referenced by {{placeholders}} in a piece of text. */
export function extractIds(text: string): string[] {
  return segmentText(text).flatMap((part) => (part.type === "metric" ? [part.id] : []));
}
