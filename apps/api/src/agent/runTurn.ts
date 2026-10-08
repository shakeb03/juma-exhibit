import { conversationAgency, getTurn } from "@exhibit/database";
import type { RunContext } from "../exec/context.js";
import { runCanvasTurn } from "./canvasTurn.js";
import { runClientTurn } from "./clientTurn.js";

/** A turn belongs either to one client's conversation or to a chat node on the canvas. */
export async function runTurn(ctx: RunContext, turnId: string): Promise<void> {
  const turn = await getTurn(ctx.db, ctx.agencyId, turnId);
  if (!turn) throw new Error("Turn not found.");
  const conversation = await conversationAgency(ctx.db, ctx.agencyId, turn.conversationId);
  if (conversation?.kind === "canvas_chat") return runCanvasTurn(ctx, turnId);
  return runClientTurn(ctx, turnId);
}
