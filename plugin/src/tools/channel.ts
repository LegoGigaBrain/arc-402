/**
 * Payment channel tools — arc402_channel_open, arc402_channel_close, arc402_channel_status
 *
 * PLG-9: Uses execFileSync array form to prevent command injection.
 */
import { Type } from "@sinclair/typebox";
import { execFileSync } from "child_process";
import type { PluginApi, ToolResult } from "./hire.js";

export function registerChannelTools(api: PluginApi) {
  api.registerTool({
    name: "arc402_channel_open",
    description:
      "Open a payment channel with a counterparty — deposits ETH or ERC-20 into a streaming payment channel for micro-billing.",
    parameters: Type.Object({
      counterparty: Type.String({ description: "Counterparty agent wallet address (0x...)" }),
      deposit: Type.String({ description: "Initial deposit amount in ETH (e.g. '0.1')" }),
    }),
    async execute(_id, params) {
      return shell(["channel", "open", params.counterparty, "--deposit", params.deposit]);
    },
  });

  api.registerTool({
    name: "arc402_channel_close",
    description: "Close a payment channel and settle the final balance on-chain.",
    parameters: Type.Object({
      id: Type.String({ description: "Channel ID (bytes32 hex, 0x...)" }),
    }),
    async execute(_id, params) {
      return shell(["channel", "close", params.id]);
    },
  });

  api.registerTool({
    name: "arc402_channel_status",
    description: "Get the current balance and state of a payment channel.",
    parameters: Type.Object({
      id: Type.String({ description: "Channel ID (bytes32 hex, 0x...)" }),
    }),
    async execute(_id, params) {
      return shell(["channel", "status", params.id]);
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
