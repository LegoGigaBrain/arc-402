/**
 * Workroom tools — full workroom lifecycle (10 tools)
 *
 * arc402_workroom_init, arc402_workroom_start, arc402_workroom_stop,
 * arc402_workroom_status, arc402_workroom_doctor,
 * arc402_workroom_worker_init, arc402_workroom_worker_status,
 * arc402_workroom_earnings, arc402_workroom_receipts,
 * arc402_workroom_policy_reload
 *
 * PLG-9: Uses execFileSync array form to prevent command injection.
 */
import { Type } from "@sinclair/typebox";
import { execFileSync } from "child_process";
import type { PluginApi, ToolResult } from "./hire.js";

export function registerWorkroomTools(api: PluginApi) {
  api.registerTool({
    name: "arc402_workroom_init",
    description:
      "Initialize the workroom environment — creates config, Docker networks, and on-chain registration. Pass compute:true for GPU workrooms.",
    parameters: Type.Object({
      compute: Type.Optional(Type.Boolean({ description: "Initialize as a compute (GPU) workroom" })),
    }),
    async execute(_id, params) {
      const args = ["workroom", "init"];
      if (params.compute) args.push("--compute");
      return shell(args, 120_000);
    },
  });

  api.registerTool({
    name: "arc402_workroom_start",
    description:
      "Start the workroom — brings up Docker services and begins accepting work. Pass compute:true for GPU mode.",
    parameters: Type.Object({
      compute: Type.Optional(Type.Boolean({ description: "Start in compute (GPU) mode" })),
    }),
    async execute(_id, params) {
      const args = ["workroom", "start"];
      if (params.compute) args.push("--compute");
      return shell(args, 60_000);
    },
  });

  api.registerTool({
    name: "arc402_workroom_stop",
    description: "Gracefully stop the workroom — drains active jobs, settles payments, and shuts down Docker services.",
    parameters: Type.Object({}),
    async execute() {
      return shell(["workroom", "stop"], 60_000);
    },
  });

  api.registerTool({
    name: "arc402_workroom_status",
    description: "Show the current workroom status — running containers, active jobs, and payment queue.",
    parameters: Type.Object({}),
    async execute() {
      return shell(["workroom", "status"]);
    },
  });

  api.registerTool({
    name: "arc402_workroom_doctor",
    description:
      "Diagnose workroom health — checks Docker, network, on-chain state, and policy configuration.",
    parameters: Type.Object({}),
    async execute() {
      return shell(["workroom", "doctor"], 60_000);
    },
  });

  api.registerTool({
    name: "arc402_workroom_worker_init",
    description: "Initialize a named worker process inside the workroom.",
    parameters: Type.Object({
      name: Type.String({ description: "Worker name (alphanumeric, used as Docker service label)" }),
    }),
    async execute(_id, params) {
      return shell(["workroom", "worker", "init", "--name", params.name]);
    },
  });

  api.registerTool({
    name: "arc402_workroom_worker_status",
    description: "Show the status of all workers running in the workroom.",
    parameters: Type.Object({}),
    async execute() {
      return shell(["workroom", "worker", "status"]);
    },
  });

  api.registerTool({
    name: "arc402_workroom_earnings",
    description: "Show cumulative earnings for this workroom — settled and pending amounts by token.",
    parameters: Type.Object({}),
    async execute() {
      return shell(["workroom", "earnings"]);
    },
  });

  api.registerTool({
    name: "arc402_workroom_receipts",
    description: "List payment receipts for all completed jobs processed by this workroom.",
    parameters: Type.Object({}),
    async execute() {
      return shell(["workroom", "receipts"]);
    },
  });

  api.registerTool({
    name: "arc402_workroom_policy_reload",
    description: "Hot-reload the workroom policy file without restarting — picks up new accept/reject rules immediately.",
    parameters: Type.Object({}),
    async execute() {
      return shell(["workroom", "policy-reload"]);
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
