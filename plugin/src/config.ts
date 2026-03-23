/**
 * Plugin configuration — reads from api.getConfig() (openclaw.plugin.json configSchema).
 * Replaces ~/.arc402/daemon.toml for plugin users.
 */
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface PluginConfig {
  network: "base-mainnet" | "base-sepolia";
  walletContractAddress: string;
  // Keys must use env: prefix (e.g. env:ARC402_PRIVATE_KEY).
  // Raw hex private keys are rejected at resolution time to prevent
  // accidental key exposure via synced config files (PLG-3).
  privateKey?: string;
  machineKey?: string;
  computeAgreementAddress?: string;
  subscriptionAgreementAddress?: string;
  registryV3Address?: string;
  endpointHostname?: string;
  workroom?: {
    enabled?: boolean;
    compute?: boolean;
    policyFile?: string;
  };
  daemon?: {
    autoAcceptHire?: boolean;
    autoAcceptCompute?: boolean;
    maxConcurrentJobs?: number;
  };
}

// Mainnet contract addresses (overridable via config)
export const MAINNET_CONTRACTS = {
  serviceAgreement: "0xC98B402CAB9156da68A87a69E3B4bf167A3CCcF6",
  computeAgreement: "0x0e06afE90aAD3e0D91e217C46d98F049C2528AF7",
  subscriptionAgreement: "0xe1b6D3d0890E09582166EB450a78F6bff038CE5A",
  registryV3: "0x6EafeD4FA103D2De04DDee157e35A8e8df91B6A6",
  agentRegistry: "0xD5c2851B00090c92Ba7F4723FB548bb30C9B6865",
};

// PLG-13: Sepolia contracts not yet deployed.
// Any contract call on base-sepolia will fail with a clear error.
export const SEPOLIA_CONTRACTS = {
  serviceAgreement: "",
  computeAgreement: "",
  subscriptionAgreement: "",
  registryV3: "",
  agentRegistry: "",
};

export interface ResolvedConfig extends PluginConfig {
  rpcUrl: string;
  chainId: number;
  contracts: typeof MAINNET_CONTRACTS;
  resolvedPrivateKey: string;
}

/** PLG-3: Reject raw hex private keys in config. Keys must use env: prefix. */
function validateKeyField(value: string, field: string): void {
  // Match bare hex private keys (with or without 0x prefix)
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(value.trim())) {
    throw new Error(
      `ARC-402: ${field} must not be a raw private key. ` +
      `Use env: prefix instead (e.g. env:ARC402_PRIVATE_KEY). ` +
      `Raw keys in config files risk exposure via synced dotfiles.`,
    );
  }
}

export function resolveConfig(raw: PluginConfig): ResolvedConfig {
  const isMainnet = (raw.network ?? "base-mainnet") !== "base-sepolia";
  const contracts = isMainnet ? MAINNET_CONTRACTS : SEPOLIA_CONTRACTS;

  // PLG-13: warn when sepolia is selected (no contracts deployed yet)
  if (!isMainnet) {
    process.stderr.write(
      "[arc402] WARNING: base-sepolia selected but contracts are not yet deployed. " +
      "Contract operations will fail. Set network to 'base-mainnet' for production use.\n",
    );
  }

  // PLG-3: validate key fields before resolving
  if (raw.machineKey) validateKeyField(raw.machineKey, "machineKey");
  if (raw.privateKey) validateKeyField(raw.privateKey, "privateKey");

  const resolvedPrivateKey =
    raw.machineKey
      ? resolveEnvRef(raw.machineKey, "machineKey")
      : raw.privateKey
        ? resolveEnvRef(raw.privateKey, "privateKey")
        : process.env["ARC402_MACHINE_KEY"] ?? process.env["ARC402_PRIVATE_KEY"] ?? "";

  const resolved: ResolvedConfig = {
    ...raw,
    network: raw.network ?? "base-mainnet",
    rpcUrl: isMainnet ? "https://mainnet.base.org" : "https://sepolia.base.org",
    chainId: isMainnet ? 8453 : 84532,
    contracts: {
      serviceAgreement: contracts.serviceAgreement,
      computeAgreement: raw.computeAgreementAddress ?? contracts.computeAgreement,
      subscriptionAgreement: raw.subscriptionAgreementAddress ?? contracts.subscriptionAgreement,
      registryV3: raw.registryV3Address ?? contracts.registryV3,
      agentRegistry: contracts.agentRegistry,
    },
    resolvedPrivateKey,
  };

  // PLG-7: sync plugin network/rpc config into ~/.arc402/config.json so that
  // shell-delegated CLI tools operate on the same network as direct-contract tools.
  syncCliConfig(resolved, raw);

  return resolved;
}

/**
 * PLG-7: Write the plugin's network/wallet config into ~/.arc402/config.json
 * so shell-delegated tools (which read the CLI config) stay in sync with the
 * plugin config. Non-fatal — sync failure never breaks plugin operation.
 */
function syncCliConfig(cfg: ResolvedConfig, raw: PluginConfig): void {
  try {
    const cliConfigPath = path.join(os.homedir(), ".arc402", "config.json");
    let existing: Record<string, unknown> = {};
    if (fs.existsSync(cliConfigPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(cliConfigPath, "utf-8")) as Record<string, unknown>;
      } catch {
        // ignore parse errors — we'll overwrite the relevant fields
      }
    }
    const merged = {
      ...existing,
      network: cfg.network,
      rpcUrl: cfg.rpcUrl,
      chainId: cfg.chainId,
      ...(raw.walletContractAddress ? { walletAddress: raw.walletContractAddress } : {}),
    };
    fs.mkdirSync(path.dirname(cliConfigPath), { recursive: true });
    fs.writeFileSync(cliConfigPath, JSON.stringify(merged, null, 2));
  } catch {
    // Non-fatal — never break plugin operation due to CLI sync failure
  }
}

function resolveEnvRef(value: string, field: string): string {
  if (value.startsWith("env:")) {
    const varName = value.slice(4);
    const resolved = process.env[varName];
    if (!resolved) {
      throw new Error(`ARC-402: env var ${varName} not set (required for ${field})`);
    }
    return resolved;
  }
  return value;
}
