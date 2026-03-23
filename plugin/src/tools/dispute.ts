/**
 * Dispute tools — arc402_dispute, arc402_dispute_status
 */
import { Type } from "@sinclair/typebox";
import { execSync } from "child_process";
import type { PluginApi, ToolResult } from "./hire.js";

export function registerDisputeTools(api: PluginApi) {
  api.registerTool({
    name: "arc402_dispute",
    description:
      "Open a dispute on an agreement — triggers the on-chain dispute flow and notifies the provider.",
    parameters: Type.Object({
      id: Type.String({ description: "Agreement ID or session ID (bytes32 hex, 0x...)" }),
      reason: Type.String({ description: "Reason for the dispute" }),
    }),
    async execute(_id, params) {
      return shell(`arc402 dispute open ${q(params.id)} --reason ${q(params.reason)}`);
    },
  });

  api.registerTool({
    name: "arc402_dispute_status",
    description: "Get the current status of a dispute by agreement or session ID.",
    parameters: Type.Object({
      id: Type.String({ description: "Agreement ID or session ID (bytes32 hex, 0x...)" }),
    }),
    async execute(_id, params) {
      return shell(`arc402 dispute status ${q(params.id)}`);
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
