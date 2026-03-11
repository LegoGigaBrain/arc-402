import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { ethers } from "ethers";
import { loadConfig } from "../config";
import { requireSigner, getClient } from "../client";
import { AGENT_REGISTRY_ABI } from "../abis";
import { getTrustTier, truncateAddress, formatDate } from "../utils/format";

function getRegistry(
  address: string,
  signerOrProvider: ethers.Signer | ethers.Provider
) {
  return new ethers.Contract(address, AGENT_REGISTRY_ABI, signerOrProvider);
}

export function registerAgentCommands(program: Command): void {
  const agent = program
    .command("agent")
    .description("Manage agent registrations");

  // ─── register ────────────────────────────────────────────────────────────

  agent
    .command("register")
    .description("Register your agent on-chain")
    .option("--name <name>", "Agent name")
    .option(
      "--capability <caps>",
      "Comma-separated capability list (e.g. text-generation,code-review)"
    )
    .option("--service-type <type>", "Service type (e.g. LLM, oracle)")
    .option("--endpoint <url>", "Discovery endpoint URL or IPFS CID", "")
    .option("--metadata-uri <uri>", "Metadata URI", "")
    .action(async (opts) => {
      if (!opts.name || !opts.serviceType) {
        console.error(
          chalk.red("--name and --service-type are required")
        );
        process.exit(1);
      }
      const capabilities = opts.capability
        ? opts.capability.split(",").map((s: string) => s.trim())
        : [];

      const config = loadConfig();
      const { signer, address } = await requireSigner(config);
      const registry = getRegistry(config.agentRegistryAddress, signer);

      const spinner = ora("Registering agent on-chain…").start();
      try {
        const tx = await registry.register(
          opts.name,
          capabilities,
          opts.serviceType,
          opts.endpoint,
          opts.metadataUri ?? ""
        );
        spinner.text = `Waiting for tx ${truncateAddress(tx.hash)}…`;
        await tx.wait();
        spinner.succeed(
          chalk.green(
            `✓ Agent registered: ${address}\n  tx: ${tx.hash}`
          )
        );
      } catch (err: unknown) {
        spinner.fail(chalk.red("Registration failed"));
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ─── update ──────────────────────────────────────────────────────────────

  agent
    .command("update")
    .description("Update your agent registration")
    .option("--name <name>", "Agent name")
    .option("--capability <caps>", "Comma-separated capabilities")
    .option("--service-type <type>", "Service type")
    .option("--endpoint <url>", "Discovery endpoint", "")
    .option("--metadata-uri <uri>", "Metadata URI", "")
    .action(async (opts) => {
      if (!opts.name || !opts.serviceType) {
        console.error(chalk.red("--name and --service-type are required"));
        process.exit(1);
      }
      const capabilities = opts.capability
        ? opts.capability.split(",").map((s: string) => s.trim())
        : [];

      const config = loadConfig();
      const { signer } = await requireSigner(config);
      const registry = getRegistry(config.agentRegistryAddress, signer);

      const spinner = ora("Updating agent…").start();
      try {
        const tx = await registry.update(
          opts.name,
          capabilities,
          opts.serviceType,
          opts.endpoint,
          opts.metadataUri ?? ""
        );
        await tx.wait();
        spinner.succeed(chalk.green(`✓ Agent updated  tx: ${tx.hash}`));
      } catch (err: unknown) {
        spinner.fail(chalk.red("Update failed"));
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ─── deactivate ──────────────────────────────────────────────────────────

  agent
    .command("deactivate")
    .description("Deactivate your agent registration")
    .action(async () => {
      const config = loadConfig();
      const { signer } = await requireSigner(config);
      const registry = getRegistry(config.agentRegistryAddress, signer);

      const spinner = ora("Deactivating agent…").start();
      try {
        const tx = await registry.deactivate();
        await tx.wait();
        spinner.succeed(chalk.green(`✓ Agent deactivated  tx: ${tx.hash}`));
      } catch (err: unknown) {
        spinner.fail(chalk.red("Deactivate failed"));
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  // ─── info ─────────────────────────────────────────────────────────────────

  agent
    .command("info <address>")
    .description("Show agent info for an address")
    .option("--json", "Output raw JSON")
    .action(async (address: string, opts) => {
      const config = loadConfig();
      const { provider } = await getClient(config);
      const registry = getRegistry(config.agentRegistryAddress, provider);

      try {
        const [info, score] = await Promise.all([
          registry.getAgent(address),
          registry.getTrustScore(address),
        ]);

        if (opts.json) {
          console.log(
            JSON.stringify(
              {
                wallet: info.wallet,
                name: info.name,
                capabilities: [...info.capabilities],
                serviceType: info.serviceType,
                endpoint: info.endpoint,
                metadataURI: info.metadataURI,
                active: info.active,
                registeredAt: Number(info.registeredAt),
                trustScore: Number(score),
                trustTier: getTrustTier(Number(score)),
              },
              null,
              2
            )
          );
          return;
        }

        console.log(chalk.cyan("\n─── Agent Info ─────────────────────────────"));
        console.log(`  Address:     ${info.wallet}`);
        console.log(`  Name:        ${info.name}`);
        console.log(`  Service:     ${info.serviceType}`);
        console.log(`  Endpoint:    ${info.endpoint || "(none)"}`);
        console.log(`  Metadata:    ${info.metadataURI || "(none)"}`);
        console.log(`  Capabilities:`);
        for (const cap of info.capabilities) {
          console.log(`    • ${cap}`);
        }
        console.log(
          `  Trust Score: ${chalk.bold(String(Number(score)))} / 1000 — ${getTrustTier(Number(score))}`
        );
        console.log(
          `  Status:      ${
            info.active ? chalk.green("✓ Active") : chalk.gray("✗ Inactive")
          }`
        );
        console.log(
          `  Registered:  ${formatDate(Number(info.registeredAt))}`
        );
        console.log();
      } catch (err: unknown) {
        console.error(
          chalk.red("Failed to fetch agent info:"),
          err instanceof Error ? err.message : String(err)
        );
        process.exit(1);
      }
    });

  // ─── me ──────────────────────────────────────────────────────────────────

  agent
    .command("me")
    .description("Show your own agent info (uses wallet from config)")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const config = loadConfig();
      const { provider, address } = await getClient(config);
      if (!address) {
        console.error(
          chalk.red("No private key configured — cannot derive wallet address.")
        );
        process.exit(1);
      }
      const registry = getRegistry(config.agentRegistryAddress, provider);

      try {
        const [info, score] = await Promise.all([
          registry.getAgent(address),
          registry.getTrustScore(address),
        ]);

        if (opts.json) {
          console.log(
            JSON.stringify(
              {
                wallet: info.wallet,
                name: info.name,
                capabilities: [...info.capabilities],
                serviceType: info.serviceType,
                endpoint: info.endpoint,
                metadataURI: info.metadataURI,
                active: info.active,
                registeredAt: Number(info.registeredAt),
                trustScore: Number(score),
                trustTier: getTrustTier(Number(score)),
              },
              null,
              2
            )
          );
          return;
        }

        console.log(chalk.cyan("\n─── My Agent Info ──────────────────────────"));
        console.log(`  Address:     ${info.wallet}`);
        console.log(`  Name:        ${info.name}`);
        console.log(`  Service:     ${info.serviceType}`);
        console.log(`  Endpoint:    ${info.endpoint || "(none)"}`);
        console.log(`  Capabilities:`);
        for (const cap of info.capabilities) {
          console.log(`    • ${cap}`);
        }
        console.log(
          `  Trust Score: ${chalk.bold(String(Number(score)))} / 1000 — ${getTrustTier(Number(score))}`
        );
        console.log(
          `  Status:      ${
            info.active ? chalk.green("✓ Active") : chalk.gray("✗ Inactive")
          }`
        );
        console.log(
          `  Registered:  ${formatDate(Number(info.registeredAt))}`
        );
        console.log();
      } catch (err: unknown) {
        console.error(
          chalk.red("Failed:"),
          err instanceof Error ? err.message : String(err)
        );
        process.exit(1);
      }
    });
}
