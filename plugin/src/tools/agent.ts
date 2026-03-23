/**
 * Agent registry tools — arc402_agent_register, arc402_agent_update, arc402_agent_status
 *
 * PLG-9: Uses execFileSync array form to prevent command injection.
 */
import { Type } from "@sinclair/typebox";
import { execFileSync } from "child_process";
import type { PluginApi, ToolResult } from "./hire.js";

export function registerAgentTools(api: PluginApi) {
  api.registerTool({
    name: "arc402_agent_register",
    description:
      "Register this agent in the ARC-402 registry — publishes name and capabilities on-chain.",
    parameters: Type.Object({
      name: Type.String({ description: "Agent display name" }),
      capabilities: Type.String({ description: "Comma-separated capability identifiers (e.g. ai.code,ai.research)" }),
    }),
    async execute(_id, params) {
      return shell(["agent", "register", "--name", params.name, "--capabilities", params.capabilities]);
    },
  });

  api.registerTool({
    name: "arc402_agent_update",
    description: "Update the registered capabilities of this agent in the registry.",
    parameters: Type.Object({
      capabilities: Type.String({ description: "Comma-separated capability identifiers" }),
    }),
    async execute(_id, params) {
      return shell(["agent", "update", "--capabilities", params.capabilities]);
    },
  });

  api.registerTool({
    name: "arc402_agent_status",
    description: "Show the current on-chain registration status of this agent.",
    parameters: Type.Object({}),
    async execute() {
      return shell(["agent", "status"]);
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
