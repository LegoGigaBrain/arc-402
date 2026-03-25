/**
 * Wallet tools — arc402_wallet_status, arc402_wallet_deploy,
 *                arc402_whitelist_contract, arc402_upgrade_registry,
 *                arc402_wallet_onboard
 */
import { Type } from "@sinclair/typebox";
import { ethers } from "ethers";
import { execFileSync } from "child_process";
import type { PluginApi, ToolResult } from "./hire.js";
import type { ResolvedConfig } from "../config.js";
import { runWithWalletApproval, approvalOk, approvalErr } from "./wallet-approval.js";

function shell(args: string[], timeout = 30_000): ToolResult {
  try {
    const text = execFileSync("arc402", args, { encoding: "utf-8", timeout });
    return { content: [{ type: "text", text }] };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const out = (err.stdout ?? "") + (err.stderr ?? "") || (err.message ?? String(e));
    return { content: [{ type: "text", text: out }] };
  }
}

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

const POLICY_ENGINE_ABI = [
  "function whitelistContract(address wallet, address target) external",
  "function isContractWhitelisted(address wallet, address target) external view returns (bool)",
  "function freezeWallet(address wallet) external",
  "function unfreezeWallet(address wallet) external",
];

const ARC402_WALLET_GUARDIAN_ABI = [
  "function setGuardian(address _guardian) external",
];

const ARC402_WALLET_MACHINE_KEY_ABI = [
  "function authorizeMachineKey(address key) external",
  "function revokeMachineKey(address key) external",
  "function authorizedMachineKeys(address key) external view returns (bool)",
];

const ARC402_WALLET_OWNABLE_ABI = [
  "function transferOwnership(address newOwner) external",
];

const WALLET_REGISTRY_ABI = [
  "function proposeRegistryUpdate(address newRegistry) external",
  "function registry() external view returns (address)",
];

const WALLET_FACTORY_ADDRESS = "0xcB52B5d746eEc05e141039E92e3dBefeAe496051";
const TRUST_REGISTRY_ADDRESS = "0x22366D6dabb03062Bc0a5E893EfDff15D8E329b1";
const POLICY_ENGINE_ADDRESS = "0x44102e70c2A366632d98Fe40d892a2501fC7fFF2";

export function registerWalletTools(api: PluginApi, getConfig: () => ResolvedConfig) {
  api.registerTool({
    name: "arc402_wallet_status",
    description:
      "Show ARC-402 wallet status — address, ETH balance, trust score, agent registration info.",
    parameters: Type.Object({
      showMachineAddress: Type.Optional(
        Type.Boolean({ description: "Include the machine (signing) address in output (default: false)" }),
      ),
    }),
    async execute(_id, params) {
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

      // PLG-8: redact machineAddress unless explicitly requested
      const result: Record<string, unknown> = {
        network: cfg.network,
        chainId: cfg.chainId,
        walletAddress: address || null,
        machineAddress: params.showMachineAddress ? (machineAddress || null) : "[redacted — pass showMachineAddress:true to reveal]",
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
      "Deploy a new ARC-402 smart wallet on Base — your phone wallet approves via WalletConnect and becomes the owner. Returns the predicted wallet address. After deployment, run arc402_wallet_onboard to complete the post-deploy ceremony (PolicyEngine registration, velocity limit, category limits, and contract whitelisting).",
    parameters: Type.Object({
      salt: Type.Optional(Type.String({ description: "Deployment salt (hex, default: random)" })),
    }),
    async execute(_id, params) {
      const cfg = getConfig();

      const salt = params.salt
        ? (params.salt as `0x${string}`)
        : ethers.hexlify(ethers.randomBytes(32)) as `0x${string}`;

      const rpcProvider = new ethers.JsonRpcProvider(cfg.rpcUrl);
      const factory = new ethers.Contract(WALLET_FACTORY_ADDRESS, WALLET_FACTORY_ABI, rpcProvider);
      const factoryIface = new ethers.Interface(WALLET_FACTORY_ABI);

      let predictedAddress = "";

      try {
        const { txHash, account, deepLinksText } = await runWithWalletApproval(
          cfg.chainId,
          async (ownerAddress) => {
            predictedAddress = await factory.predictAddress(ownerAddress, salt) as string;
            return {
              to: WALLET_FACTORY_ADDRESS,
              data: factoryIface.encodeFunctionData("deploy", [ownerAddress, salt]),
              value: "0x0",
            };
          },
          "Deploy ARC-402 smart wallet",
        );

        return approvalOk(deepLinksText, {
          walletAddress: predictedAddress,
          txHash,
          owner: account,
          network: cfg.network,
          message: `Wallet deployed at ${predictedAddress}. Add to plugin config as walletContractAddress.`,
        });
      } catch (e: unknown) {
        return approvalErr(e instanceof Error ? e.message : String(e));
      }
    },
  });

  api.registerTool({
    name: "arc402_whitelist_contract",
    description:
      "Whitelist a contract address on PolicyEngine so this wallet can call it via executeContractCall. Your phone wallet approves via WalletConnect.",
    parameters: Type.Object({
      target: Type.String({ description: "Contract address to whitelist (0x...)" }),
    }),
    async execute(_id, params) {
      const cfg = getConfig();
      if (!cfg.walletContractAddress) {
        return approvalErr("walletContractAddress not configured. Run arc402_wallet_deploy first.");
      }

      let checksumTarget: string;
      try {
        checksumTarget = ethers.getAddress(params.target);
      } catch {
        return approvalErr(`Invalid address: ${params.target}`);
      }

      const rpcProvider = new ethers.JsonRpcProvider(cfg.rpcUrl);
      const pe = new ethers.Contract(POLICY_ENGINE_ADDRESS, POLICY_ENGINE_ABI, rpcProvider);
      const peIface = new ethers.Interface(POLICY_ENGINE_ABI);

      // Check if already whitelisted
      try {
        const already = await pe.isContractWhitelisted(cfg.walletContractAddress, checksumTarget) as boolean;
        if (already) {
          return ok({ alreadyWhitelisted: true, target: checksumTarget, wallet: cfg.walletContractAddress });
        }
      } catch { /* ignore — proceed with whitelisting */ }

      try {
        const { txHash, deepLinksText } = await runWithWalletApproval(
          cfg.chainId,
          () => ({
            to: POLICY_ENGINE_ADDRESS,
            data: peIface.encodeFunctionData("whitelistContract", [cfg.walletContractAddress, checksumTarget]),
            value: "0x0",
          }),
          `Approve: whitelist ${checksumTarget} on PolicyEngine`,
        );

        await rpcProvider.waitForTransaction(txHash);

        return approvalOk(deepLinksText, {
          ok: true,
          txHash,
          wallet: cfg.walletContractAddress,
          target: checksumTarget,
        });
      } catch (e: unknown) {
        return approvalErr(e instanceof Error ? e.message : String(e));
      }
    },
  });

  api.registerTool({
    name: "arc402_upgrade_registry",
    description:
      "Propose a registry upgrade on the ARC402Wallet (2-day timelock). Your phone wallet approves via WalletConnect.",
    parameters: Type.Object({
      newRegistryAddress: Type.String({ description: "New ARC402RegistryV3 address (0x...)" }),
    }),
    async execute(_id, params) {
      const cfg = getConfig();
      if (!cfg.walletContractAddress) {
        return approvalErr("walletContractAddress not configured. Run arc402_wallet_deploy first.");
      }

      let checksumAddress: string;
      try {
        checksumAddress = ethers.getAddress(params.newRegistryAddress);
      } catch {
        return approvalErr(`Invalid address: ${params.newRegistryAddress}`);
      }

      const rpcProvider = new ethers.JsonRpcProvider(cfg.rpcUrl);
      const walletIface = new ethers.Interface(WALLET_REGISTRY_ABI);

      try {
        const { txHash, deepLinksText } = await runWithWalletApproval(
          cfg.chainId,
          () => ({
            to: cfg.walletContractAddress!,
            data: walletIface.encodeFunctionData("proposeRegistryUpdate", [checksumAddress]),
            value: "0x0",
          }),
          "Approve: propose registry upgrade on ARC402Wallet",
        );

        return approvalOk(deepLinksText, {
          ok: true,
          txHash,
          wallet: cfg.walletContractAddress,
          newRegistry: checksumAddress,
          note: "Registry update proposed with 2-day timelock. Run arc402_upgrade_registry_execute after the timelock to apply.",
        });
      } catch (e: unknown) {
        return approvalErr(e instanceof Error ? e.message : String(e));
      }
    },
  });

  api.registerTool({
    name: "arc402_wallet_freeze",
    description:
      "Freeze this ARC-402 wallet on PolicyEngine — blocks all outbound spend. Your phone wallet approves via WalletConnect.",
    parameters: Type.Object({}),
    async execute(_id, _params) {
      const cfg = getConfig();
      if (!cfg.walletContractAddress) {
        return approvalErr("walletContractAddress not configured. Run arc402_wallet_deploy first.");
      }

      const peIface = new ethers.Interface(POLICY_ENGINE_ABI);

      try {
        const { txHash, deepLinksText } = await runWithWalletApproval(
          cfg.chainId,
          () => ({
            to: POLICY_ENGINE_ADDRESS,
            data: peIface.encodeFunctionData("freezeWallet", [cfg.walletContractAddress]),
            value: "0x0",
          }),
          `Approve: freeze wallet ${cfg.walletContractAddress}`,
        );

        return approvalOk(deepLinksText, {
          ok: true,
          txHash,
          wallet: cfg.walletContractAddress,
          frozen: true,
        });
      } catch (e: unknown) {
        return approvalErr(e instanceof Error ? e.message : String(e));
      }
    },
  });

  api.registerTool({
    name: "arc402_wallet_unfreeze",
    description:
      "Unfreeze this ARC-402 wallet on PolicyEngine — re-enables outbound spend. Your phone wallet approves via WalletConnect.",
    parameters: Type.Object({}),
    async execute(_id, _params) {
      const cfg = getConfig();
      if (!cfg.walletContractAddress) {
        return approvalErr("walletContractAddress not configured. Run arc402_wallet_deploy first.");
      }

      const peIface = new ethers.Interface(POLICY_ENGINE_ABI);

      try {
        const { txHash, deepLinksText } = await runWithWalletApproval(
          cfg.chainId,
          () => ({
            to: POLICY_ENGINE_ADDRESS,
            data: peIface.encodeFunctionData("unfreezeWallet", [cfg.walletContractAddress]),
            value: "0x0",
          }),
          `Approve: unfreeze wallet ${cfg.walletContractAddress}`,
        );

        return approvalOk(deepLinksText, {
          ok: true,
          txHash,
          wallet: cfg.walletContractAddress,
          frozen: false,
        });
      } catch (e: unknown) {
        return approvalErr(e instanceof Error ? e.message : String(e));
      }
    },
  });

  api.registerTool({
    name: "arc402_wallet_set_guardian",
    description:
      "Set the guardian address on this ARC-402 wallet (owner-only). Your phone wallet approves via WalletConnect.",
    parameters: Type.Object({
      guardianAddress: Type.String({ description: "Guardian address to set (0x...)" }),
    }),
    async execute(_id, params) {
      const cfg = getConfig();
      if (!cfg.walletContractAddress) {
        return approvalErr("walletContractAddress not configured. Run arc402_wallet_deploy first.");
      }

      let checksumGuardian: string;
      try {
        checksumGuardian = ethers.getAddress(params.guardianAddress);
      } catch {
        return approvalErr(`Invalid address: ${params.guardianAddress}`);
      }

      const iface = new ethers.Interface(ARC402_WALLET_GUARDIAN_ABI);

      try {
        const { txHash, deepLinksText } = await runWithWalletApproval(
          cfg.chainId,
          () => ({
            to: cfg.walletContractAddress!,
            data: iface.encodeFunctionData("setGuardian", [checksumGuardian]),
            value: "0x0",
          }),
          `Approve: setGuardian(${checksumGuardian}) on ARC402Wallet`,
        );

        return approvalOk(deepLinksText, {
          ok: true,
          txHash,
          wallet: cfg.walletContractAddress,
          guardian: checksumGuardian,
        });
      } catch (e: unknown) {
        return approvalErr(e instanceof Error ? e.message : String(e));
      }
    },
  });

  api.registerTool({
    name: "arc402_wallet_authorize_machine_key",
    description:
      "Authorize a machine key on this ARC-402 wallet — grants autonomous protocol operations. Your phone wallet approves via WalletConnect.",
    parameters: Type.Object({
      machineKeyAddress: Type.String({ description: "Machine key address to authorize (0x...)" }),
    }),
    async execute(_id, params) {
      const cfg = getConfig();
      if (!cfg.walletContractAddress) {
        return approvalErr("walletContractAddress not configured. Run arc402_wallet_deploy first.");
      }

      let checksumKey: string;
      try {
        checksumKey = ethers.getAddress(params.machineKeyAddress);
      } catch {
        return approvalErr(`Invalid address: ${params.machineKeyAddress}`);
      }

      const iface = new ethers.Interface(ARC402_WALLET_MACHINE_KEY_ABI);

      try {
        const { txHash, deepLinksText } = await runWithWalletApproval(
          cfg.chainId,
          () => ({
            to: cfg.walletContractAddress!,
            data: iface.encodeFunctionData("authorizeMachineKey", [checksumKey]),
            value: "0x0",
          }),
          `Approve: authorizeMachineKey(${checksumKey}) on ARC402Wallet`,
        );

        return approvalOk(deepLinksText, {
          ok: true,
          txHash,
          wallet: cfg.walletContractAddress,
          machineKey: checksumKey,
          authorized: true,
        });
      } catch (e: unknown) {
        return approvalErr(e instanceof Error ? e.message : String(e));
      }
    },
  });

  api.registerTool({
    name: "arc402_wallet_revoke_machine_key",
    description:
      "Revoke a machine key on this ARC-402 wallet. Your phone wallet approves via WalletConnect.",
    parameters: Type.Object({
      machineKeyAddress: Type.String({ description: "Machine key address to revoke (0x...)" }),
    }),
    async execute(_id, params) {
      const cfg = getConfig();
      if (!cfg.walletContractAddress) {
        return approvalErr("walletContractAddress not configured. Run arc402_wallet_deploy first.");
      }

      let checksumKey: string;
      try {
        checksumKey = ethers.getAddress(params.machineKeyAddress);
      } catch {
        return approvalErr(`Invalid address: ${params.machineKeyAddress}`);
      }

      const iface = new ethers.Interface(ARC402_WALLET_MACHINE_KEY_ABI);

      try {
        const { txHash, deepLinksText } = await runWithWalletApproval(
          cfg.chainId,
          () => ({
            to: cfg.walletContractAddress!,
            data: iface.encodeFunctionData("revokeMachineKey", [checksumKey]),
            value: "0x0",
          }),
          `Approve: revokeMachineKey(${checksumKey}) on ARC402Wallet`,
        );

        return approvalOk(deepLinksText, {
          ok: true,
          txHash,
          wallet: cfg.walletContractAddress,
          machineKey: checksumKey,
          authorized: false,
        });
      } catch (e: unknown) {
        return approvalErr(e instanceof Error ? e.message : String(e));
      }
    },
  });

  api.registerTool({
    name: "arc402_wallet_transfer_ownership",
    description:
      "Transfer ownership of this ARC-402 wallet to a new address (initiates 2-step transfer). Your phone wallet approves via WalletConnect.",
    parameters: Type.Object({
      newOwner: Type.String({ description: "New owner address (0x...)" }),
    }),
    async execute(_id, params) {
      const cfg = getConfig();
      if (!cfg.walletContractAddress) {
        return approvalErr("walletContractAddress not configured. Run arc402_wallet_deploy first.");
      }

      let checksumOwner: string;
      try {
        checksumOwner = ethers.getAddress(params.newOwner);
      } catch {
        return approvalErr(`Invalid address: ${params.newOwner}`);
      }

      const iface = new ethers.Interface(ARC402_WALLET_OWNABLE_ABI);

      try {
        const { txHash, deepLinksText } = await runWithWalletApproval(
          cfg.chainId,
          () => ({
            to: cfg.walletContractAddress!,
            data: iface.encodeFunctionData("transferOwnership", [checksumOwner]),
            value: "0x0",
          }),
          `Approve: transferOwnership(${checksumOwner}) on ARC402Wallet`,
        );

        return approvalOk(deepLinksText, {
          ok: true,
          txHash,
          wallet: cfg.walletContractAddress,
          pendingOwner: checksumOwner,
          note: "Ownership transfer initiated. New owner must call acceptOwnership() to complete.",
        });
      } catch (e: unknown) {
        return approvalErr(e instanceof Error ? e.message : String(e));
      }
    },
  });

  api.registerTool({
    name: "arc402_wallet_onboard",
    description:
      "Run post-deploy wallet onboarding — sets velocity limit, 5 category spend limits (general, hire, compute, research, protocol), and whitelists ServiceAgreement, ComputeAgreement, SubscriptionAgreement, Handshake in one WalletConnect session. Idempotent — skips steps already done. Run after arc402_wallet_deploy.",
    parameters: Type.Object({}),
    async execute(_id, _params) {
      return shell(["wallet", "onboard"], 300_000);
    },
  });
}

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
