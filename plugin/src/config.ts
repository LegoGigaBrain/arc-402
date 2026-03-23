/**
 * Plugin configuration — reads from api.getConfig() (openclaw.plugin.json configSchema).
 * Replaces ~/.arc402/daemon.toml for plugin users.
 */

export interface PluginConfig {
  network: "base-mainnet" | "base-sepolia";
  walletContractAddress: string;
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

export function resolveConfig(raw: PluginConfig): ResolvedConfig {
  const isMainnet = (raw.network ?? "base-mainnet") !== "base-sepolia";
  const contracts = isMainnet ? MAINNET_CONTRACTS : SEPOLIA_CONTRACTS;

  const resolvedPrivateKey =
    raw.machineKey
      ? resolveEnvRef(raw.machineKey, "machineKey")
      : raw.privateKey
        ? resolveEnvRef(raw.privateKey, "privateKey")
        : process.env["ARC402_MACHINE_KEY"] ?? process.env["ARC402_PRIVATE_KEY"] ?? "";

  return {
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
