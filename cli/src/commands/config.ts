import { Command } from "commander";
import prompts from "prompts";
import chalk from "chalk";
import {
  Arc402Config,
  loadConfig,
  saveConfig,
  configExists,
  NETWORK_DEFAULTS,
} from "../config";

export function registerConfigCommands(program: Command): void {
  const config = program.command("config").description("Manage arc402 CLI configuration");

  config
    .command("init")
    .description("Interactive configuration wizard — writes ~/.arc402/config.json")
    .action(async () => {
      console.log(chalk.cyan("\n⚡ ARC-402 CLI Configuration Wizard\n"));

      if (configExists()) {
        const { overwrite } = await prompts({
          type: "confirm",
          name: "overwrite",
          message: "Config already exists. Overwrite?",
          initial: false,
        });
        if (!overwrite) {
          console.log("Aborted.");
          return;
        }
      }

      const existing: Partial<Arc402Config> = configExists() ? loadConfig() : {};

      const answers = await prompts(
        [
          {
            type: "select",
            name: "network",
            message: "Network",
            choices: [
              { title: "Base Sepolia (testnet)", value: "base-sepolia" },
              { title: "Base Mainnet", value: "base-mainnet" },
            ],
            initial: existing.network === "base-mainnet" ? 1 : 0,
          },
          {
            type: "text",
            name: "rpcUrl",
            message: "RPC URL",
            initial: (prev: string) =>
              existing.rpcUrl ?? NETWORK_DEFAULTS[prev]?.rpcUrl ?? "",
          },
          {
            type: "text",
            name: "agentRegistryAddress",
            message: "AgentRegistry contract address",
            initial: (prev: unknown, values: Record<string, string>) =>
              existing.agentRegistryAddress ??
              NETWORK_DEFAULTS[values.network]?.agentRegistryAddress ??
              "",
          },
          {
            type: "text",
            name: "serviceAgreementAddress",
            message: "ServiceAgreement contract address",
            initial: (prev: unknown, values: Record<string, string>) =>
              existing.serviceAgreementAddress ??
              NETWORK_DEFAULTS[values.network]?.serviceAgreementAddress ??
              "",
          },
          {
            type: "text",
            name: "trustRegistryAddress",
            message: "TrustRegistry contract address",
            initial: (prev: unknown, values: Record<string, string>) =>
              existing.trustRegistryAddress ??
              NETWORK_DEFAULTS[values.network]?.trustRegistryAddress ??
              "",
          },
          {
            type: "confirm",
            name: "storeKey",
            message: "Store private key in config? (WARNING: stored as plaintext)",
            initial: false,
          },
          {
            type: (prev: boolean) => (prev ? "password" : null),
            name: "privateKey",
            message: "Private key (0x...)",
          },
        ],
        {
          onCancel: () => {
            console.log(chalk.yellow("\nAborted."));
            process.exit(0);
          },
        }
      );

      const cfg: Arc402Config = {
        network: answers.network,
        rpcUrl: answers.rpcUrl,
        agentRegistryAddress: answers.agentRegistryAddress,
        serviceAgreementAddress: answers.serviceAgreementAddress,
        trustRegistryAddress: answers.trustRegistryAddress,
      };

      if (answers.storeKey && answers.privateKey) {
        cfg.privateKey = answers.privateKey;
        console.log(
          chalk.yellow(
            "\n⚠️  Private key stored in ~/.arc402/config.json (mode 0600). Keep this file secure."
          )
        );
      }

      saveConfig(cfg);
      console.log(chalk.green("\n✓ Config saved to ~/.arc402/config.json\n"));
    });

  config
    .command("show")
    .description("Print current config (private key masked)")
    .action(() => {
      if (!configExists()) {
        console.error(
          chalk.red("No config found. Run `arc402 config init` first.")
        );
        process.exit(1);
      }
      const cfg = loadConfig();
      const display = { ...cfg, privateKey: cfg.privateKey ? "***" : "(not set)" };
      console.log(chalk.cyan("\n~/.arc402/config.json\n"));
      console.log(JSON.stringify(display, null, 2));
      console.log();
    });
}
