import type { CanvasEdge, CanvasNode } from "@exhibit/contracts";
import { withTransaction } from "./transaction.js";
import type { Database } from "./pool.js";
import type { Queryable } from "./transaction.js";

export interface CanvasRecord {
  id: string;
  revision: number;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  updatedAt: Date;
}

/** The one saved canvas of this agency session. */
export async function getCanvas(db: Queryable, agencyId: string): Promise<CanvasRecord | null> {
  const result = await db.query("select id, revision, nodes, edges, updated_at from canvases where agency_id = $1", [agencyId]);
  const row = result.rows[0];
  return row ? { id: row.id, revision: row.revision, nodes: row.nodes, edges: row.edges, updatedAt: row.updated_at } : null;
}

export type SaveCanvasResult = { ok: true; revision: number } | { ok: false; current: CanvasRecord };

/**
 * Save a new revision only if the caller started from the current one, so a stale browser cannot overwrite
 * another edit. Every saved revision is kept as an immutable snapshot that turns can point at.
 */
export async function saveCanvas(
  db: Database,
  agencyId: string,
  input: { baseRevision: number; nodes: CanvasNode[]; edges: CanvasEdge[] },
): Promise<SaveCanvasResult | null> {
  return withTransaction(db, async (tx) => {
    const locked = await tx.query("select id, revision, nodes, edges, updated_at from canvases where agency_id = $1 for update", [agencyId]);
    const row = locked.rows[0];
    if (!row) return null;
    if (row.revision !== input.baseRevision) {
      return { ok: false as const, current: { id: row.id, revision: row.revision, nodes: row.nodes, edges: row.edges, updatedAt: row.updated_at } };
    }
    const revision = row.revision + 1;
    await tx.query("update canvases set revision = $2, nodes = $3, edges = $4, updated_at = now() where id = $1", [
      row.id, revision, JSON.stringify(input.nodes), JSON.stringify(input.edges),
    ]);
    await tx.query("insert into canvas_revisions (canvas_id, revision, nodes, edges) values ($1, $2, $3, $4)", [
      row.id, revision, JSON.stringify(input.nodes), JSON.stringify(input.edges),
    ]);
    return { ok: true as const, revision };
  });
}

/** One conversation per chat node, created on first use. Returns null if the canvas is not this agency's. */
export async function getOrCreateCanvasConversation(db: Queryable, agencyId: string, chatNodeId: string): Promise<{ id: string; canvasId: string } | null> {
  const canvas = await getCanvas(db, agencyId);
  if (!canvas) return null;
  await db.query(
    `insert into conversations (agency_id, kind, canvas_id, chat_node_id) values ($1, 'canvas_chat', $2, $3)
     on conflict (canvas_id, chat_node_id) where kind = 'canvas_chat' do nothing`,
    [agencyId, canvas.id, chatNodeId],
  );
  const result = await db.query("select id from conversations where agency_id = $1 and kind = 'canvas_chat' and canvas_id = $2 and chat_node_id = $3", [agencyId, canvas.id, chatNodeId]);
  return { id: result.rows[0].id, canvasId: canvas.id };
}

export async function canvasConversationInfo(db: Queryable, agencyId: string, conversationId: string) {
  const result = await db.query("select canvas_id, chat_node_id from conversations where id = $1 and agency_id = $2 and kind = 'canvas_chat'", [conversationId, agencyId]);
  const row = result.rows[0];
  return row ? { canvasId: row.canvas_id as string, chatNodeId: row.chat_node_id as string } : null;
}
