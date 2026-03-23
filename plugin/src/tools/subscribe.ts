/**
 * Subscription tools — arc402_subscribe, arc402_subscription_cancel, arc402_top_up,
 *                      arc402_subscription_create, arc402_subscription_status,
 *                      arc402_subscription_discover
 */
import { Type } from "@sinclair/typebox";
import { ethers } from "ethers";
import { execFileSync } from "child_process";
import type { PluginApi, ToolResult } from "./hire.js";
import type { ResolvedConfig } from "../config.js";

const SUBSCRIPTION_ABI = [
  "function subscribe(address provider, string planId, uint256 months, address token) external payable returns (bytes32 subscriptionId)",
  "function cancel(bytes32 subscriptionId) external",
  "function topUp(bytes32 subscriptionId, uint256 months) external payable",
  "function getSubscription(bytes32 subscriptionId) external view returns (tuple(address client, address provider, string planId, uint256 ratePerMonth, address token, uint256 startTime, uint256 endTime, uint8 status))",
];

export function registerSubscribeTools(api: PluginApi, getConfig: () => ResolvedConfig) {
  api.registerTool({
    name: "arc402_subscribe",
    description:
      "Subscribe to an agent service — creates a recurring payment agreement for ongoing access.",
    parameters: Type.Object({
      provider: Type.String({ description: "Provider agent wallet address (0x...)" }),
      planId: Type.String({ description: "Subscription plan identifier (from provider's plan catalog)" }),
      months: Type.Number({ description: "Number of months to pay upfront (min 1)" }),
      token: Type.Optional(Type.String({ description: "ERC-20 payment token (omit for ETH)" })),
      ratePerMonth: Type.Optional(Type.String({ description: "Rate per month in ETH — must match plan" })),
    }),
    async execute(_id, params) {
      const cfg = getConfig();
      if (!cfg.resolvedPrivateKey) return err("ARC-402 plugin not configured");

      const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
      const signer = new ethers.Wallet(cfg.resolvedPrivateKey, provider);
      const contract = new ethers.Contract(cfg.contracts.subscriptionAgreement, SUBSCRIPTION_ABI, signer);

      const token = params.token ?? ethers.ZeroAddress;
      const isEth = token === ethers.ZeroAddress;
      const rateWei = params.ratePerMonth ? ethers.parseEther(params.ratePerMonth) : 0n;
      const totalWei = rateWei * BigInt(params.months);

      const tx = await contract.subscribe(
        params.provider,
        params.planId,
        params.months,
        token,
        { value: isEth && totalWei > 0n ? totalWei : 0n },
      );
      const receipt = await tx.wait();

      return ok({
        subscriptionId: receipt.logs[0]?.topics[1] ?? "pending",
        txHash: receipt.hash,
        provider: params.provider,
        planId: params.planId,
        months: params.months,
        status: "active",
      });
    },
  });

  // Renamed from arc402_cancel to arc402_subscription_cancel to avoid collision
  // with the hiring-domain arc402_cancel tool (PLG-2)
  api.registerTool({
    name: "arc402_subscription_cancel",
    description: "Cancel an active subscription — stops future billing, refunds unused time.",
    parameters: Type.Object({
      subscriptionId: Type.String({ description: "Subscription ID (bytes32 hex)" }),
    }),
    async execute(_id, params) {
      const cfg = getConfig();
      if (!cfg.resolvedPrivateKey) return err("Not configured");

      const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
      const signer = new ethers.Wallet(cfg.resolvedPrivateKey, provider);
      const contract = new ethers.Contract(cfg.contracts.subscriptionAgreement, SUBSCRIPTION_ABI, signer);

      const tx = await contract.cancel(params.subscriptionId);
      const receipt = await tx.wait();

      return ok({ subscriptionId: params.subscriptionId, txHash: receipt.hash, status: "cancelled" });
    },
  });

  api.registerTool({
    name: "arc402_top_up",
    description: "Top up a subscription — extends active subscription by adding more months.",
    parameters: Type.Object({
      subscriptionId: Type.String({ description: "Subscription ID (bytes32 hex)" }),
      months: Type.Number({ description: "Number of months to add" }),
      ratePerMonth: Type.Optional(Type.String({ description: "Rate per month in ETH (required if ETH)" })),
    }),
    async execute(_id, params) {
      const cfg = getConfig();
      if (!cfg.resolvedPrivateKey) return err("Not configured");

      const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
      const signer = new ethers.Wallet(cfg.resolvedPrivateKey, provider);
      const contract = new ethers.Contract(cfg.contracts.subscriptionAgreement, SUBSCRIPTION_ABI, signer);

      const rateWei = params.ratePerMonth ? ethers.parseEther(params.ratePerMonth) : 0n;
      const totalWei = rateWei * BigInt(params.months);

      const tx = await contract.topUp(params.subscriptionId, params.months, { value: totalWei });
      const receipt = await tx.wait();

      return ok({
        subscriptionId: params.subscriptionId,
        txHash: receipt.hash,
        addedMonths: params.months,
        status: "topped-up",
      });
    },
  });

  // PLG-2: missing tools

  api.registerTool({
    name: "arc402_subscription_create",
    description:
      "Create a subscription plan (provider-side) — publishes a recurring payment plan to the registry.",
    parameters: Type.Object({
      planId: Type.String({ description: "Plan identifier (unique per provider)" }),
      ratePerMonth: Type.String({ description: "Rate per month in ETH (e.g. '0.1')" }),
      description: Type.Optional(Type.String({ description: "Plan description for subscribers" })),
    }),
    async execute(_id, params) {
      const args = ["subscription", "create-plan", "--plan-id", params.planId, "--rate", params.ratePerMonth];
      if (params.description) args.push("--description", params.description);
      return shell(args);
    },
  });

  api.registerTool({
    name: "arc402_subscription_status",
    description: "Check the current state of a subscription — expiry, rate, and billing history.",
    parameters: Type.Object({
      subscriptionId: Type.String({ description: "Subscription ID (bytes32 hex)" }),
    }),
    async execute(_id, params) {
      const cfg = getConfig();
      const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
      const contract = new ethers.Contract(cfg.contracts.subscriptionAgreement, SUBSCRIPTION_ABI, provider);

      const sub = await contract.getSubscription(params.subscriptionId);
      const STATUS_LABELS = ["inactive", "active", "cancelled", "expired"];

      return ok({
        subscriptionId: params.subscriptionId,
        client: sub.client,
        provider: sub.provider,
        planId: sub.planId,
        ratePerMonth: ethers.formatEther(sub.ratePerMonth) + " ETH",
        token: sub.token,
        startTime: sub.startTime > 0n ? new Date(Number(sub.startTime) * 1000).toISOString() : null,
        endTime: sub.endTime > 0n ? new Date(Number(sub.endTime) * 1000).toISOString() : null,
        status: STATUS_LABELS[Number(sub.status)] ?? "unknown",
      });
    },
  });

  api.registerTool({
    name: "arc402_subscription_discover",
    description: "Find active subscriptions — lists your subscriptions as client or provider.",
    parameters: Type.Object({
      role: Type.Optional(
        Type.Union([Type.Literal("client"), Type.Literal("provider")], {
          description: "Filter by role: 'client' (subscriptions you pay) or 'provider' (subscriptions you receive)",
        }),
      ),
    }),
    async execute(_id, params) {
      const args = ["subscription", "list"];
      if (params.role) args.push("--role", params.role);
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
