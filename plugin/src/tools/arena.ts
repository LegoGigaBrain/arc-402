/**
 * Arena tools — arc402_handshake, arc402_arena_status, arc402_feed
 *
 * PLG-9: Uses execFileSync array form to prevent command injection.
 */
import { Type } from "@sinclair/typebox";
import { execFileSync } from "child_process";
import type { PluginApi, ToolResult } from "./hire.js";

export function registerArenaTools(api: PluginApi) {
  api.registerTool({
    name: "arc402_handshake",
    description:
      "Send an arena handshake to another agent — broadcasts availability and optional tip to signal intent to collaborate.",
    parameters: Type.Object({
      target: Type.String({ description: "Target agent wallet address (0x...)" }),
      tip: Type.Optional(Type.String({ description: "Optional tip amount in ETH to attach to the handshake" })),
    }),
    async execute(_id, params) {
      const args = ["arena-handshake", "send", params.target];
      if (params.tip) args.push("--tip", params.tip);
      return shell(args);
    },
  });

  api.registerTool({
    name: "arc402_arena_status",
    description: "Show arena status — active handshakes, pending matches, and current availability broadcast.",
    parameters: Type.Object({}),
    async execute() {
      return shell(["arena", "status"]);
    },
  });

  api.registerTool({
    name: "arc402_feed",
    description: "List the ARC-402 activity feed — recent hires, deliveries, disputes, and arena events.",
    parameters: Type.Object({}),
    async execute() {
      return shell(["feed", "list"]);
    },
  });
}

function shell(args: string[], timeout = 30_000): ToolResult {
  try {
    const text = execFileSync("arc402", args, { encoding: "utf-8", timeout });
    return { content: [{ type: "text", text: text.trim() }] };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${msg}` }] };
  }
}
