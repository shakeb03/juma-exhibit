import type { AgentReply, Block } from "@exhibit/contracts";
import { renderText, type RegistryMetric } from "./registry.js";

type Lookup = (id: string) => RegistryMetric | undefined;

/** Fields that hold identifiers or structure, never display text. */
const SKIP = new Set(["id", "key", "type", "metricIds", "sourceRefs", "basedOn", "scopeId", "scopes", "metrics", "level"]);

function mapText<T>(value: T, lookup: Lookup): T {
  if (typeof value === "string") return renderText(value, lookup) as T;
  if (Array.isArray(value)) return value.map((item) => mapText(item, lookup)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, SKIP.has(key) ? item : mapText(item, lookup)]),
    ) as T;
  }
  return value;
}

/** Fill {{metric}} placeholders with verified, formatted values. */
export const renderReply = (reply: AgentReply, lookup: Lookup): AgentReply => mapText(reply, lookup);
export const renderBlocks = (blocks: Block[], lookup: Lookup): Block[] => mapText(blocks, lookup);
