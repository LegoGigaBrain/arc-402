/**
 * Negotiate tools — arc402_negotiate, arc402_agreements
 */
import { Type } from "@sinclair/typebox";
import { execSync } from "child_process";
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
      return shell(`arc402 negotiate send ${q(params.provider)} --message ${q(params.message)}`);
    },
  });

  api.registerTool({
    name: "arc402_agreements",
    description: "List all active and historical agreements (hire + compute + subscription).",
    parameters: Type.Object({}),
    async execute() {
      return shell(`arc402 agreements list`);
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
