/**
 * Compute tools — arc402_compute_hire, arc402_compute_end, arc402_compute_status,
 *                 arc402_compute_withdraw, arc402_compute_offer, arc402_compute_discover
 */
import { Type } from "@sinclair/typebox";
import { ethers } from "ethers";
import { execFileSync } from "child_process";
import type { PluginApi, ToolResult } from "./hire.js";
import type { ResolvedConfig } from "../config.js";

const COMPUTE_ABI = [
  "function proposeSession(address provider, string gpuSpec, uint256 ratePerHourWei, uint256 maxHours, address token) external payable returns (bytes32 sessionId)",
  "function acceptSession(bytes32 sessionId) external",
  "function startSession(bytes32 sessionId) external",
  "function endSession(bytes32 sessionId) external",
  "function disputeSession(bytes32 sessionId, string reason) external",
  "function cancelSession(bytes32 sessionId) external",
  "function getSession(bytes32 sessionId) external view returns (tuple(address client, address provider, string gpuSpec, uint256 ratePerHourWei, uint256 maxHours, uint256 startTime, uint256 endTime, uint8 status, uint256 totalCost))",
];

export function registerComputeTools(api: PluginApi, getConfig: () => ResolvedConfig) {
  api.registerTool({
    name: "arc402_compute_hire",
    description:
      "Hire a GPU compute provider — proposes a ComputeAgreement session with pay-per-hour billing.",
    parameters: Type.Object({
      provider: Type.String({ description: "Provider agent wallet address (0x...)" }),
      gpuSpec: Type.Optional(Type.String({ description: "GPU spec (e.g. nvidia-h100-80gb, nvidia-a100-40gb)" })),
      ratePerHour: Type.String({ description: "Rate per GPU-hour in ETH (e.g. '0.5')" }),
      maxHours: Type.Number({ description: "Maximum session hours (sets escrow ceiling)" }),
      token: Type.Optional(Type.String({ description: "ERC-20 payment token (omit for ETH)" })),
    }),
    async execute(_id, params) {
      const cfg = getConfig();
      if (!cfg.resolvedPrivateKey) return err("ARC-402 plugin not configured");

      const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
      const signer = new ethers.Wallet(cfg.resolvedPrivateKey, provider);
      const contract = new ethers.Contract(cfg.contracts.computeAgreement, COMPUTE_ABI, signer);

      const rateWei = ethers.parseEther(params.ratePerHour);
      const escrow = rateWei * BigInt(params.maxHours);
      const token = params.token ?? ethers.ZeroAddress;
      const isEth = token === ethers.ZeroAddress;

      const tx = await contract.proposeSession(
        params.provider,
        params.gpuSpec ?? "",
        rateWei,
        params.maxHours,
        token,
        { value: isEth ? escrow : 0n },
      );
      const receipt = await tx.wait();

      return ok({
        sessionId: receipt.logs[0]?.topics[1] ?? "pending",
        txHash: receipt.hash,
        provider: params.provider,
        ratePerHour: params.ratePerHour,
        maxHours: params.maxHours,
        escrow: ethers.formatEther(escrow) + " ETH",
        status: "proposed",
      });
    },
  });

  api.registerTool({
    name: "arc402_compute_end",
    description:
      "End a compute session — triggers final settlement based on actual usage time.",
    parameters: Type.Object({
      sessionId: Type.String({ description: "Session ID (bytes32 hex)" }),
    }),
    async execute(_id, params) {
      const cfg = getConfig();
      if (!cfg.resolvedPrivateKey) return err("Not configured");

      const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
      const signer = new ethers.Wallet(cfg.resolvedPrivateKey, provider);
      const contract = new ethers.Contract(cfg.contracts.computeAgreement, COMPUTE_ABI, signer);

      const tx = await contract.endSession(params.sessionId);
      const receipt = await tx.wait();

      return ok({ sessionId: params.sessionId, txHash: receipt.hash, status: "ended" });
    },
  });

  api.registerTool({
    name: "arc402_compute_status",
    description: "Get the current status and cost of a compute session.",
    parameters: Type.Object({
      sessionId: Type.String({ description: "Session ID (bytes32 hex)" }),
    }),
    async execute(_id, params) {
      const cfg = getConfig();
      const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
      const contract = new ethers.Contract(cfg.contracts.computeAgreement, COMPUTE_ABI, provider);

      const session = await contract.getSession(params.sessionId);
      const STATUS_LABELS = ["proposed", "accepted", "active", "ended", "disputed", "cancelled"];

      return ok({
        sessionId: params.sessionId,
        client: session.client,
        provider: session.provider,
        gpuSpec: session.gpuSpec,
        ratePerHour: ethers.formatEther(session.ratePerHourWei) + " ETH",
        maxHours: Number(session.maxHours),
        startTime: session.startTime > 0n ? new Date(Number(session.startTime) * 1000).toISOString() : null,
        endTime: session.endTime > 0n ? new Date(Number(session.endTime) * 1000).toISOString() : null,
        status: STATUS_LABELS[Number(session.status)] ?? "unknown",
        totalCost: ethers.formatEther(session.totalCost) + " ETH",
      });
    },
  });

  // PLG-2: missing tools

  api.registerTool({
    name: "arc402_compute_withdraw",
    description:
      "Withdraw unused escrow from a cancelled or expired compute session.",
    parameters: Type.Object({
      sessionId: Type.String({ description: "Session ID (bytes32 hex)" }),
    }),
    async execute(_id, params) {
      return shell(["compute", "withdraw", params.sessionId]);
    },
  });

  api.registerTool({
    name: "arc402_compute_offer",
    description:
      "Publish a GPU compute offer to the registry — advertises your GPU capacity for hire.",
    parameters: Type.Object({
      gpuSpec: Type.String({ description: "GPU spec identifier (e.g. nvidia-h100-80gb)" }),
      ratePerHour: Type.String({ description: "Rate per GPU-hour in ETH (e.g. '0.5')" }),
      maxHours: Type.Optional(Type.Number({ description: "Maximum hours per session (default: 24)" })),
    }),
    async execute(_id, params) {
      const args = ["compute", "offer", "--gpu-spec", params.gpuSpec, "--rate-per-hour", params.ratePerHour];
      if (params.maxHours !== undefined) {
        args.push("--max-hours", String(params.maxHours));
      }
      return shell(args);
    },
  });

  api.registerTool({
    name: "arc402_compute_discover",
    description:
      "Find available GPU compute providers — queries the registry for active compute offers.",
    parameters: Type.Object({
      gpuSpec: Type.Optional(Type.String({ description: "GPU spec filter (e.g. nvidia-h100-80gb)" })),
      maxRatePerHour: Type.Optional(Type.String({ description: "Max rate per hour in ETH" })),
      limit: Type.Optional(Type.Number({ description: "Max results (default 20)" })),
    }),
    async execute(_id, params) {
      const args = ["compute", "discover"];
      if (params.gpuSpec) args.push("--gpu-spec", params.gpuSpec);
      if (params.maxRatePerHour) args.push("--max-rate", params.maxRatePerHour);
      if (params.limit !== undefined) args.push("--limit", String(params.limit));
      return shell(args);
    },
  });
}

function shell(args: string[], timeout = 30_000): ToolResult {
  try {
    const text = execFileSync("arc402", args, { encoding: "utf-8", timeout });
    return { content: [{ type: "text", text: text.trim() }] };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { content: [{ type: "text", text: `Error: ${msg}` }] };
  }
}

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function err(message: string): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }] };
}
