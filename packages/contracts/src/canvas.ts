import { z } from "zod";

export const canvasNodeTypeSchema = z.enum(["client", "brief", "reference", "idea", "chat"]);
export type CanvasNodeType = z.infer<typeof canvasNodeTypeSchema>;

/**
 * A canvas node. Client nodes point at a client; brief and reference nodes point at a source;
 * idea nodes carry their own text; chat nodes carry nothing (their context is whatever connects to them).
 */
export const canvasNodeSchema = z.object({
  id: z.string().min(1),
  type: canvasNodeTypeSchema,
  position: z.object({ x: z.number(), y: z.number() }),
  clientId: z.string().uuid().optional(),
  sourceId: z.string().uuid().optional(),
  text: z.string().max(4000).optional(),
  title: z.string().max(200).optional(),
});
export type CanvasNode = z.infer<typeof canvasNodeSchema>;

export const canvasEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().max(200).optional(),
});
export type CanvasEdge = z.infer<typeof canvasEdgeSchema>;
