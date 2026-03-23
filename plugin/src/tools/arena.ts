/**
 * Arena tools — arc402_handshake, arc402_arena_status, arc402_feed
 */
import { Type } from "@sinclair/typebox";
import { execSync } from "child_process";
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
      const tipFlag = params.tip ? ` --tip ${q(params.tip)}` : "";
      return shell(`arc402 arena-handshake send ${q(params.target)}${tipFlag}`);
    },
  });

  api.registerTool({
    name: "arc402_arena_status",
    description: "Show arena status — active handshakes, pending matches, and current availability broadcast.",
    parameters: Type.Object({}),
    async execute() {
      return shell(`arc402 arena status`);
    },
  });

  api.registerTool({
    name: "arc402_feed",
    description: "List the ARC-402 activity feed — recent hires, deliveries, disputes, and arena events.",
    parameters: Type.Object({}),
    async execute() {
      return shell(`arc402 feed list`);
    },
  });
}

function q(s: string): string {
  return `"${s.replace(/"/g, '\\"')}"`;
}

function shell(cmd: string, timeout = 30_000): ToolResult {
  try {
    const text = execSync(cmd, { encoding: "utf-8", timeout });
    return { content: [{ type: "text", text: text.trim() }] };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Error: ${msg}` }] };
  }
}
