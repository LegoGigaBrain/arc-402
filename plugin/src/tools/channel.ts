/**
 * Payment channel tools — arc402_channel_open, arc402_channel_close, arc402_channel_status
 */
import { Type } from "@sinclair/typebox";
import { execSync } from "child_process";
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
      return shell(`arc402 channel open ${q(params.counterparty)} --deposit ${q(params.deposit)}`);
    },
  });

  api.registerTool({
    name: "arc402_channel_close",
    description: "Close a payment channel and settle the final balance on-chain.",
    parameters: Type.Object({
      id: Type.String({ description: "Channel ID (bytes32 hex, 0x...)" }),
    }),
    async execute(_id, params) {
      return shell(`arc402 channel close ${q(params.id)}`);
    },
  });

  api.registerTool({
    name: "arc402_channel_status",
    description: "Get the current balance and state of a payment channel.",
    parameters: Type.Object({
      id: Type.String({ description: "Channel ID (bytes32 hex, 0x...)" }),
    }),
    async execute(_id, params) {
      return shell(`arc402 channel status ${q(params.id)}`);
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
