import type { IntelligenceContext } from "./types.js";

export interface PassportEntry {
  nodeId: string;
  type: "client" | "brief" | "reference" | "idea";
  title: string;
  /** "restricted" means nothing flows; "partial" means one of the two approvals is missing. */
  status: "approved" | "partial" | "restricted" | "explicit";
  /** Plain-language summary of what a chat node may see through this connection. */
  included: string[];
  excluded: string[];
  /** Why something is excluded, in the user's terms. */
  reasons: string[];
  fieldsShared: number;
}

export interface Passport {
  chatNodeId: string;
  entries: PassportEntry[];
  /** Things that never leave any client, whatever is approved. */
  neverShared: string[];
  note: string;
}

const NEVER_SHARED = [
  "Raw spend, impressions, clicks, conversions, and revenue",
  "Audience descriptions, brand voice, and constraints",
  "Private briefs and previous work",
  "Campaign names and files attached to a request",
];

/**
 * What flows through each connection, derived from the very same context object that goes to the model, so the
 * passport can never promise something the context does not do. It contains no client content, only descriptions.
 */
export function describePassport(
  context: IntelligenceContext,
  nodes: { id: string; type: string; clientId?: string; title?: string }[],
): Passport {
  const entries: PassportEntry[] = [];

  for (const client of context.clients) {
    const node = nodes.find((n) => n.type === "client" && n.clientId === client.clientId);
    const included: string[] = [];
    const excluded: string[] = [];
    const reasons: string[] = [];

    if (client.performanceApproved) {
      included.push(`Rates per 1,000 impressions for ${client.campaigns.length} campaign${client.campaigns.length === 1 ? "" : "s"}: click-through, conversion rate, CPM, return on ad spend`);
    } else {
      excluded.push("Performance patterns");
      reasons.push("This client has not approved sharing performance patterns.");
    }
    if (client.creativeApproved) {
      included.push(`${client.creativeReferences.length} creative description${client.creativeReferences.length === 1 ? "" : "s"} (text only, no images)`);
    } else {
      excluded.push("Creative assets");
      reasons.push("This client has not approved sharing creative assets.");
    }
    if (client.performanceApproved && client.creativeApproved) {
      included.push("Patterns grouped by visual style and storytelling approach");
    } else if (client.performanceApproved) {
      excluded.push("Patterns by visual style and storytelling");
      reasons.push("Grouping by creative style needs both approvals.");
    }

    const status = !client.performanceApproved && !client.creativeApproved ? "restricted" : client.performanceApproved && client.creativeApproved ? "approved" : "partial";
    entries.push({
      nodeId: node?.id ?? client.clientId,
      type: "client",
      title: client.name,
      status,
      included,
      excluded,
      reasons,
      fieldsShared: included.length,
    });
  }

  for (const item of context.explicit) {
    const node = nodes.find((n) => item.ref === `canvas:${item.kind}:${n.id}`);
    entries.push({
      nodeId: node?.id ?? item.ref,
      type: item.kind,
      title: item.title,
      status: "explicit",
      included: [`${item.text.length.toLocaleString()} characters of text you added to the canvas`],
      excluded: [],
      reasons: [],
      fieldsShared: 1,
    });
  }

  return {
    chatNodeId: context.chatNodeId,
    entries,
    neverShared: NEVER_SHARED,
    note: "Connecting nodes never grants access. Each client's sharing choices decide what flows.",
  };
}
