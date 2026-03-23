/**
 * Dispute tools — arc402_dispute, arc402_dispute_status, arc402_dispute_resolve
 *
 * PLG-9: Uses execFileSync array form to prevent command injection.
 */
import { Type } from "@sinclair/typebox";
import { execFileSync } from "child_process";
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
      return shell(["dispute", "open", params.id, "--reason", params.reason]);
    },
  });

  api.registerTool({
    name: "arc402_dispute_status",
    description: "Get the current status of a dispute by agreement or session ID.",
    parameters: Type.Object({
      id: Type.String({ description: "Agreement ID or session ID (bytes32 hex, 0x...)" }),
    }),
    async execute(_id, params) {
      return shell(["dispute", "status", params.id]);
    },
  });

  // PLG-2: missing tool
  api.registerTool({
    name: "arc402_dispute_resolve",
    description:
      "Accept an arbitration outcome — called by either party to acknowledge and finalize dispute resolution.",
    parameters: Type.Object({
      id: Type.String({ description: "Agreement ID or session ID (bytes32 hex, 0x...)" }),
      outcome: Type.Optional(Type.String({ description: "Accepted outcome (e.g. 'refund', 'release', 'split')" })),
    }),
    async execute(_id, params) {
      const args = ["dispute", "resolve", params.id];
      if (params.outcome) args.push("--outcome", params.outcome);
      return shell(args);
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
