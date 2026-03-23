/**
 * Subscription tools — arc402_subscribe, arc402_cancel, arc402_top_up
 */
import { Type } from "@sinclair/typebox";
import { ethers } from "ethers";
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

  api.registerTool({
    name: "arc402_cancel",
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
}

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function err(message: string): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify({ error: message }) }] };
}
