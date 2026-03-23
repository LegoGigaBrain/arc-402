/**
 * System tools — arc402_config, arc402_setup, arc402_doctor
 */
import { Type } from "@sinclair/typebox";
import { execSync } from "child_process";
import type { PluginApi, ToolResult } from "./hire.js";

export function registerSystemTools(api: PluginApi) {
  api.registerTool({
    name: "arc402_config",
    description:
      "Get or set ARC-402 CLI configuration values. Omit key/value to list all config.",
    parameters: Type.Object({
      key: Type.Optional(Type.String({ description: "Config key to get or set (e.g. rpcUrl, walletAddress)" })),
      value: Type.Optional(Type.String({ description: "Value to set (omit to get the current value)" })),
    }),
    async execute(_id, params) {
      if (params.key && params.value) {
        return shell(`arc402 config set ${q(params.key)} ${q(params.value)}`);
      } else if (params.key) {
        return shell(`arc402 config get ${q(params.key)}`);
      }
      return shell(`arc402 config get`);
    },
  });

  api.registerTool({
    name: "arc402_setup",
    description:
      "Run the ARC-402 interactive setup wizard — configures wallet, RPC endpoint, and on-chain registration.",
    parameters: Type.Object({}),
    async execute() {
      return shell(`arc402 setup`, 120_000);
    },
  });

  api.registerTool({
    name: "arc402_doctor",
    description:
      "Run the ARC-402 system health check — verifies wallet, RPC connectivity, contract addresses, and on-chain state.",
    parameters: Type.Object({}),
    async execute() {
      return shell(`arc402 doctor`, 60_000);
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
