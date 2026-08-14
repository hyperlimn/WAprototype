import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

export function registerMcpPrompts(server: McpServer): void {
  server.registerPrompt("explore-universe", { title: "Explore ProtoUniverse", description: "Orient, investigate one attention suggestion, zoom out, and compare it with an analogue.",
    argsSchema: z.object({ seed: z.string().optional() }) }, ({ seed }) => ({ messages: [{ role: "user", content: { type: "text", text: `Explore ${seed ? `ProtoUniverse archive ${seed}` : "the active ProtoUniverse"}. Begin with orient, select an evidence-backed attention suggestion, inspect it, use context and similarity or history, then report authoritative observations separately from derived or inferred conclusions.` } }] }));
  server.registerPrompt("resume-observer", { title: "Resume observer", description: "Resume an explicit observer identity and investigate its most meaningful change.",
    argsSchema: z.object({ observer: z.string(), seed: z.string().optional() }) }, ({ observer, seed }) => ({ messages: [{ role: "user", content: { type: "text", text: `Orient as observer ${observer}${seed ? ` in universe ${seed}` : ""}, use the where-you-left-off summary and recall_observer_memory as needed, then investigate the most meaningful open thread with inspect/context/history. Keep observer inference separate from authoritative evidence.` } }] }));
}
