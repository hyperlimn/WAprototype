import * as z from "zod/v4";

export const seed = z.string().min(1).max(120).optional();
export const limit = z.number().int().min(1).max(100).optional();
export const targetKind = z.enum(["entity", "relationship", "region", "checkpoint", "event"]);
export const targetSchema = z.object({ kind: targetKind, seed, id: z.string().min(1).max(300).optional(), x: z.number().finite().optional(),
  y: z.number().finite().optional(), radius: z.number().finite().min(0).optional(), tick: z.number().int().min(0).optional(), sequence: z.number().int().min(0).optional(),
  depth: z.number().int().min(1).max(3).optional() });
export const historySchema = z.object({ seed, sinceTick: z.number().int().min(0).optional(), untilTick: z.number().int().min(0).optional(),
  type: z.enum(["external-arrival", "reproduction", "relationship-formed", "relationship-destroyed", "rupture", "dimensional-transition"]).optional(),
  entityId: z.number().int().min(0).optional(), relationshipId: z.string().min(1).max(300).optional(), limit,
  cursor: z.string().min(1).max(4096).optional() });
