/**
 * Trust tools — arc402_trust, arc402_reputation
 *
 * PLG-9: Uses execFileSync array form to prevent command injection.
 */
import { Type } from "@sinclair/typebox";
import { execFileSync } from "child_process";
import type { PluginApi, ToolResult } from "./hire.js";

export function registerTrustTools(api: PluginApi) {
  api.registerTool({
    name: "arc402_trust",
    description:
      "Grant trust to an agent address — marks the address as trusted in your local policy for auto-accepting proposals.",
    parameters: Type.Object({
      address: Type.String({ description: "Agent wallet address to trust (0x...)" }),
    }),
    async execute(_id, params) {
      return shell(["trust", params.address]);
    },
  });

  api.registerTool({
    name: "arc402_reputation",
    description:
      "Look up the on-chain reputation score and agreement history for an agent address.",
    parameters: Type.Object({
      address: Type.String({ description: "Agent wallet address to look up (0x...)" }),
    }),
    async execute(_id, params) {
      return shell(["reputation", params.address]);
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
