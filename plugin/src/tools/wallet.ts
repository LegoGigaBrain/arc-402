/**
 * Wallet tools — arc402_wallet_status, arc402_wallet_deploy
 */
import { Type } from "@sinclair/typebox";
import { ethers } from "ethers";
import type { PluginApi, ToolResult } from "./hire.js";
import type { ResolvedConfig } from "../config.js";

const WALLET_FACTORY_ABI = [
  "function deploy(address owner, bytes32 salt) external returns (address wallet)",
  "function predictAddress(address owner, bytes32 salt) external view returns (address)",
];

const TRUST_REGISTRY_ABI = [
  "function getTrustScore(address wallet) external view returns (uint256 score, uint8 level, uint256 nextLevelAt)",
];

const REGISTRY_V3_ABI = [
  "function getAgent(address wallet) external view returns (tuple(address wallet, string name, string endpoint, bool active, uint256 registeredAt, uint256 trustScore, string[] capabilities))",
];

const WALLET_FACTORY_ADDRESS = "0xcB52B5d746eEc05e141039E92e3dBefeAe496051";
const TRUST_REGISTRY_ADDRESS = "0x22366D6dabb03062Bc0a5E893EfDff15D8E329b1";

export function registerWalletTools(api: PluginApi, getConfig: () => ResolvedConfig) {
  api.registerTool({
    name: "arc402_wallet_status",
    description:
      "Show ARC-402 wallet status — address, ETH balance, trust score, agent registration info.",
    parameters: Type.Object({}),
    async execute(_id, _params) {
      const cfg = getConfig();

      if (!cfg.walletContractAddress && !cfg.resolvedPrivateKey) {
        return ok({
          status: "not_configured",
          message:
            "Configure walletContractAddress (and machineKey or privateKey) in plugin settings to use wallet tools.",
        });
      }

      const rpcProvider = new ethers.JsonRpcProvider(cfg.rpcUrl);

      let address = cfg.walletContractAddress;
      let machineAddress = "";

      if (cfg.resolvedPrivateKey) {
        const wallet = new ethers.Wallet(cfg.resolvedPrivateKey);
        machineAddress = wallet.address;
      }

      const result: Record<string, unknown> = {
        network: cfg.network,
        chainId: cfg.chainId,
        walletAddress: address || null,
        machineAddress: machineAddress || null,
      };

      if (address) {
        const ethBalance = await rpcProvider.getBalance(address);
        result["ethBalance"] = ethers.formatEther(ethBalance) + " ETH";

        // Trust score
        try {
          const trustRegistry = new ethers.Contract(TRUST_REGISTRY_ADDRESS, TRUST_REGISTRY_ABI, rpcProvider);
          const [score, level, nextLevelAt] = await trustRegistry.getTrustScore(address);
          const LEVEL_LABELS = ["probationary", "restricted", "standard", "elevated", "autonomous"];
          result["trustScore"] = {
            score: Number(score),
            level: LEVEL_LABELS[Number(level)] ?? "unknown",
            nextLevelAt: Number(nextLevelAt),
          };
        } catch {
          result["trustScore"] = null;
        }

        // Agent registration
        try {
          const registryV3 = new ethers.Contract(cfg.contracts.registryV3, REGISTRY_V3_ABI, rpcProvider);
          const agent = await registryV3.getAgent(address);
          result["agent"] = {
            name: agent.name,
            endpoint: agent.endpoint,
            active: agent.active,
            capabilities: agent.capabilities,
          };
        } catch {
          result["agent"] = null;
        }
      }

      return ok(result);
    },
  });

  api.registerTool({
    name: "arc402_wallet_deploy",
    description:
      "Deploy a new ARC-402 smart wallet on Base mainnet. Returns the wallet contract address.",
    parameters: Type.Object({
      salt: Type.Optional(Type.String({ description: "Deployment salt (hex, default: random)" })),
    }),
    async execute(_id, params) {
      const cfg = getConfig();
      if (!cfg.resolvedPrivateKey) return err("machineKey or privateKey required to deploy wallet");

      const rpcProvider = new ethers.JsonRpcProvider(cfg.rpcUrl);
      const signer = new ethers.Wallet(cfg.resolvedPrivateKey, rpcProvider);
      const factory = new ethers.Contract(WALLET_FACTORY_ADDRESS, WALLET_FACTORY_ABI, signer);

      const salt = params.salt
        ? (params.salt as `0x${string}`)
        : ethers.hexlify(ethers.randomBytes(32)) as `0x${string}`;

      // Predict address first
      const predicted = await factory.predictAddress(signer.address, salt);

      const tx = await factory.deploy(signer.address, salt);
      const receipt = await tx.wait();

      return ok({
        walletAddress: predicted,
        txHash: receipt.hash,
        owner: signer.address,
        network: cfg.network,
        message: `Wallet deployed at ${predicted}. Add to plugin config as walletContractAddress.`,
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
