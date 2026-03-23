/**
 * Negotiate tools — arc402_negotiate, arc402_agreements
 *
 * PLG-9: Uses execFileSync array form to prevent command injection.
 */
import { Type } from "@sinclair/typebox";
import { execFileSync } from "child_process";
import type { PluginApi, ToolResult } from "./hire.js";

export function registerNegotiateTools(api: PluginApi) {
  api.registerTool({
    name: "arc402_negotiate",
    description:
      "Send a negotiation message to a provider — opens or continues a negotiation thread before committing to a hire.",
    parameters: Type.Object({
      provider: Type.String({ description: "Provider agent wallet address or ENS name" }),
      message: Type.String({ description: "Negotiation message content" }),
    }),
    async execute(_id, params) {
      return shell(["negotiate", "send", params.provider, "--message", params.message]);
    },
  });

  api.registerTool({
    name: "arc402_agreements",
    description: "List all active and historical agreements (hire + compute + subscription).",
    parameters: Type.Object({}),
    async execute() {
      return shell(["agreements", "list"]);
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
