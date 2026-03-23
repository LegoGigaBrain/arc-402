/**
 * Endpoint tools — arc402_endpoint_setup, arc402_endpoint_status, arc402_endpoint_doctor
 *
 * PLG-9: Uses execFileSync array form to prevent command injection.
 */
import { Type } from "@sinclair/typebox";
import { execFileSync } from "child_process";
import type { PluginApi, ToolResult } from "./hire.js";

export function registerEndpointTools(api: PluginApi) {
  api.registerTool({
    name: "arc402_endpoint_setup",
    description:
      "Set up the public ARC-402 endpoint — configures the hostname, TLS, and registers it in the agent profile.",
    parameters: Type.Object({
      hostname: Type.String({ description: "Public hostname for the agent endpoint (e.g. agent.example.com)" }),
    }),
    async execute(_id, params) {
      return shell(["endpoint", "setup", "--hostname", params.hostname]);
    },
  });

  api.registerTool({
    name: "arc402_endpoint_status",
    description: "Show the current endpoint configuration and reachability status.",
    parameters: Type.Object({}),
    async execute() {
      return shell(["endpoint", "status"]);
    },
  });

  api.registerTool({
    name: "arc402_endpoint_doctor",
    description: "Diagnose endpoint connectivity issues — checks DNS, TLS, firewall, and ARC-402 protocol handshake.",
    parameters: Type.Object({}),
    async execute() {
      return shell(["endpoint", "doctor"], 60_000);
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
