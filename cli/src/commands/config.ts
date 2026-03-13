import { Command } from "commander";
import prompts from "prompts";
import chalk from "chalk";
import { Arc402Config, NETWORK_DEFAULTS, configExists, loadConfig, saveConfig } from "../config";

export function registerConfigCommands(program: Command): void {
  const config = program.command("config").description("Manage ARC-402 CLI configuration");
  config.command("init").description("Interactive setup for ~/.arc402/config.json").action(async () => {
    const existing: Partial<Arc402Config> = configExists() ? loadConfig() : {};
    const answers = await prompts([
      { type: "select", name: "network", message: "Network", choices: [{ title: "Base Sepolia", value: "base-sepolia" }, { title: "Base Mainnet", value: "base-mainnet" }], initial: existing.network === "base-mainnet" ? 1 : 0 },
      { type: "text", name: "rpcUrl", message: "RPC URL", initial: (_: unknown, values: Record<string, string>) => existing.rpcUrl ?? NETWORK_DEFAULTS[values.network]?.rpcUrl ?? "" },
      { type: "text", name: "agentRegistryAddress", message: "AgentRegistry address (optional)", initial: existing.agentRegistryAddress ?? "" },
      { type: "text", name: "serviceAgreementAddress", message: "ServiceAgreement address (optional)", initial: existing.serviceAgreementAddress ?? "" },
      { type: "text", name: "trustRegistryAddress", message: "TrustRegistry / TrustRegistryV2 address", initial: (_: unknown, values: Record<string, string>) => existing.trustRegistryAddress ?? NETWORK_DEFAULTS[values.network]?.trustRegistryAddress ?? "" },
      { type: "text", name: "reputationOracleAddress", message: "ReputationOracle address (optional)", initial: existing.reputationOracleAddress ?? "" },
      { type: "text", name: "sponsorshipAttestationAddress", message: "SponsorshipAttestation address (optional)", initial: existing.sponsorshipAttestationAddress ?? "" },
      { type: "text", name: "capabilityRegistryAddress", message: "CapabilityRegistry address (optional)", initial: existing.capabilityRegistryAddress ?? "" },
      { type: "text", name: "governanceAddress", message: "ARC402Governance address (optional)", initial: existing.governanceAddress ?? "" },
      { type: "confirm", name: "storeKey", message: "Store private key in config?", initial: false },
      { type: (prev: boolean) => prev ? "password" : null, name: "privateKey", message: "Private key (0x...)" },
    ]);
    const cfg: Arc402Config = { network: answers.network, rpcUrl: answers.rpcUrl, trustRegistryAddress: answers.trustRegistryAddress, agentRegistryAddress: answers.agentRegistryAddress || undefined, serviceAgreementAddress: answers.serviceAgreementAddress || undefined, reputationOracleAddress: answers.reputationOracleAddress || undefined, sponsorshipAttestationAddress: answers.sponsorshipAttestationAddress || undefined, capabilityRegistryAddress: answers.capabilityRegistryAddress || undefined, governanceAddress: answers.governanceAddress || undefined, ...(answers.storeKey && answers.privateKey ? { privateKey: answers.privateKey } : {}) };
    saveConfig(cfg);
    console.log(chalk.green("✓ Config saved"));
  });
  config.command("show").description("Print current config").action(() => {
    const cfg = loadConfig();
    console.log(JSON.stringify({ ...cfg, privateKey: cfg.privateKey ? "***" : undefined }, null, 2));
  });
}
