import { Command } from "commander";
import { AgentRegistryClient } from "@arc402/sdk";
import { buildMetadata, uploadMetadata, decodeMetadata } from "@arc402/sdk";
import { ethers } from "ethers";
import { loadConfig, NETWORK_DEFAULTS } from "../config";
import { requireSigner } from "../client";
import { formatDate, getTrustTier } from "../utils/format";
import { AGENT_REGISTRY_ABI } from "../abis";
import { executeContractWriteViaWallet } from "../wallet-router";
import { getClient } from "../client";
import prompts from "prompts";
import chalk from "chalk";

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Resolve the real AgentRegistry address (agentRegistryV2Address > NETWORK_DEFAULTS fallback). */
function getAgentRegistryAddress(config: ReturnType<typeof loadConfig>): string {
  const addr =
    config.agentRegistryV2Address ??
    NETWORK_DEFAULTS[config.network]?.agentRegistryV2Address;
  if (!addr) throw new Error("agentRegistryV2Address missing in config — run `arc402 config set agentRegistryV2Address <address>`");
  return addr;
}

// ─── commands ─────────────────────────────────────────────────────────────────

export function registerAgentCommands(program: Command): void {
  const agent = program
    .command("agent")
    .description("Agent registry operations");

  // ─── register ───────────────────────────────────────────────────────────────

  agent
    .command("register")
    .requiredOption("--name <name>", "Agent name (e.g. GigaBrain)")
    .requiredOption("--service-type <type>", "Service type (e.g. ai.assistant)")
    .option("--capability <caps>", "Comma-separated capability list")
    .option("--endpoint <url>", "Public endpoint URL", "")
    .option("--metadata-uri <uri>", "Metadata URI (IPFS or data:)", "")
    .option("--set-metadata", "Interactively build and upload metadata during registration")
    .option("--claim-subdomain <subdomain>", "Claim a <subdomain>.arc402.xyz after registration")
    .option("--tunnel-target <url>", "Tunnel target URL for the subdomain (required with --claim-subdomain)")
    .action(async (opts) => {
      const config = loadConfig();
      const registryAddress = getAgentRegistryAddress(config);

      let metadataUri = opts.metadataUri ?? "";
      if (opts.setMetadata) {
        metadataUri = await runSetMetadataWizard(
          opts.name,
          opts.capability ? opts.capability.split(",").map((v: string) => v.trim()) : [],
        );
      }

      const capabilities: string[] = opts.capability
        ? opts.capability.split(",").map((v: string) => v.trim())
        : [];

      if (config.walletContractAddress) {
        // ── wallet contract path (machine key signs, wallet is msg.sender) ──
        // Pre-flight: check machine key is authorized (J5-03)
        if (config.privateKey) {
          const machineKeyAddr = new ethers.Wallet(config.privateKey).address;
          const { provider: agentProvider } = await getClient(config);
          const mkCheck = new ethers.Contract(
            config.walletContractAddress,
            ["function authorizedMachineKeys(address) external view returns (bool)"],
            agentProvider,
          );
          let isAuthorized = true;
          try {
            isAuthorized = await mkCheck.authorizedMachineKeys(machineKeyAddr);
          } catch { /* older wallet — assume authorized */ }
          if (!isAuthorized) {
            console.error(`Machine key ${machineKeyAddr} is not authorized on wallet ${config.walletContractAddress}.`);
            console.error(`Run \`arc402 wallet authorize-machine-key ${machineKeyAddr}\` first.`);
            process.exit(1);
          }
        }

        console.log(`Registering via ARC402Wallet: ${config.walletContractAddress}`);
        const { signer, provider: regProvider } = await requireSigner(config);
        {
          const walletBalance = await regProvider.getBalance(config.walletContractAddress);
          if (walletBalance < ethers.parseEther("0.0001")) {
            console.warn(chalk.yellow(`⚠️  Low wallet balance: ${ethers.formatEther(walletBalance)} ETH. Registration may fail due to insufficient gas. Fund your wallet with at least 0.0001 ETH first.`));
          }
        }
        const tx = await executeContractWriteViaWallet(
          config.walletContractAddress,
          signer,
          registryAddress,
          AGENT_REGISTRY_ABI,
          "register",
          [opts.name, capabilities, opts.serviceType, opts.endpoint ?? "", metadataUri],
        );
        const receipt = await tx.wait();
        console.log(chalk.green(`✓ Registered in AgentRegistry`));
        console.log(`  Wallet:  ${config.walletContractAddress}`);
        console.log(`  Tx:      ${receipt?.hash}`);
        if (metadataUri) console.log(`  Metadata URI: ${metadataUri}`);
      } else {
        // ── EOA fallback ──
        console.warn(chalk.yellow("⚠ No walletContractAddress in config — registering from EOA key (msg.sender = hot key)."));
        const { signer, address: regAddress, provider: regProvider } = await requireSigner(config);
        {
          const walletBalance = await regProvider.getBalance(regAddress);
          if (walletBalance < ethers.parseEther("0.0001")) {
            console.warn(chalk.yellow(`⚠️  Low wallet balance: ${ethers.formatEther(walletBalance)} ETH. Registration may fail due to insufficient gas. Fund your wallet with at least 0.0001 ETH first.`));
          }
        }
        const client = new AgentRegistryClient(registryAddress, signer);
        await client.register({ name: opts.name, serviceType: opts.serviceType, capabilities, endpoint: opts.endpoint ?? "", metadataURI: metadataUri });
        console.log(chalk.green("✓ Registered in AgentRegistry"));
        if (metadataUri) console.log(`  metadata URI: ${metadataUri}`);
      }

      // ── optional subdomain claim ──────────────────────────────────────────
      if (opts.claimSubdomain) {
        if (!opts.tunnelTarget) {
          console.error(chalk.red("--tunnel-target <url> is required with --claim-subdomain"));
          process.exit(1);
        }
        const walletAddress = config.walletContractAddress ?? new ethers.Wallet(config.privateKey!).address;
        await claimSubdomain(opts.claimSubdomain, walletAddress, opts.tunnelTarget);
      }
    });

  // ─── update ─────────────────────────────────────────────────────────────────

  agent
    .command("update")
    .requiredOption("--name <name>")
    .requiredOption("--service-type <type>")
    .option("--capability <caps>")
    .option("--endpoint <url>", "Endpoint", "")
    .option("--metadata-uri <uri>", "Metadata URI", "")
    .action(async (opts) => {
      const config = loadConfig();
      const registryAddress = getAgentRegistryAddress(config);
      const capabilities: string[] = opts.capability
        ? opts.capability.split(",").map((v: string) => v.trim())
        : [];

      if (config.walletContractAddress) {
        const { signer } = await requireSigner(config);
        const tx = await executeContractWriteViaWallet(
          config.walletContractAddress,
          signer,
          registryAddress,
          AGENT_REGISTRY_ABI,
          "update",
          [opts.name, capabilities, opts.serviceType, opts.endpoint ?? "", opts.metadataUri ?? ""],
        );
        const receipt = await tx.wait();
        console.log(chalk.green(`✓ Agent updated`));
        console.log(`  Tx: ${receipt?.hash}`);
      } else {
        const { signer } = await requireSigner(config);
        const client = new AgentRegistryClient(registryAddress, signer);
        await client.update({ name: opts.name, serviceType: opts.serviceType, capabilities, endpoint: opts.endpoint, metadataURI: opts.metadataUri });
        console.log("updated");
      }
    });

  // ─── claim-subdomain ────────────────────────────────────────────────────────

  agent
    .command("claim-subdomain <subdomain>")
    .description("Claim <subdomain>.arc402.xyz for this wallet (wallet must be registered in AgentRegistry)")
    .requiredOption("--tunnel-target <url>", "Tunnel target URL (must start with https://)")
    .action(async (subdomain, opts) => {
      const config = loadConfig();
      const walletAddress = config.walletContractAddress ?? new ethers.Wallet(config.privateKey!).address;
      await claimSubdomain(subdomain, walletAddress, opts.tunnelTarget);
    });

  // ─── set-metadata ───────────────────────────────────────────────────────────

  agent
    .command("set-metadata")
    .description("Interactively build and upload ARC-402 agent metadata, then update the registry")
    .action(async () => {
      const config = loadConfig();
      const registryAddress = getAgentRegistryAddress(config);
      const { signer, address } = await requireSigner(config);
      const client = new AgentRegistryClient(registryAddress, signer);

      // Resolve the on-chain identity (wallet contract or EOA)
      const agentAddress = config.walletContractAddress ?? address;

      let existingName = "";
      let existingCaps: string[] = [];
      try {
        const existing = await client.getAgent(agentAddress);
        existingName = existing.name;
        existingCaps = existing.capabilities;
      } catch { /* not yet registered — fine */ }

      const uri = await runSetMetadataWizard(existingName, existingCaps);
      if (!uri) return;

      let name = existingName; let serviceType = "general"; let endpoint = "";
      try {
        const a = await client.getAgent(agentAddress);
        name = a.name; serviceType = a.serviceType; endpoint = a.endpoint;
      } catch { /* not yet registered */ }

      if (config.walletContractAddress) {
        const tx = await executeContractWriteViaWallet(
          config.walletContractAddress,
          signer,
          registryAddress,
          AGENT_REGISTRY_ABI,
          "update",
          [name, existingCaps, serviceType, endpoint, uri],
        );
        const receipt = await tx.wait();
        console.log(chalk.green("✓ Metadata URI saved to registry"));
        console.log(`  ${uri}`);
        console.log(`  Tx: ${receipt?.hash}`);
      } else {
        await client.update({ name, serviceType, capabilities: existingCaps, endpoint, metadataURI: uri });
        console.log(chalk.green("✓ Metadata URI saved to registry"));
        console.log(`  ${uri}`);
      }
    });

  // ─── show-metadata ──────────────────────────────────────────────────────────

  agent
    .command("show-metadata <address>")
    .description("Fetch and display metadata for any registered agent")
    .action(async (address) => {
      const config = loadConfig();
      const registryAddress = getAgentRegistryAddress(config);
      const { provider } = await getClient(config);
      const client = new AgentRegistryClient(registryAddress, provider);
      const info = await client.getAgent(address);
      if (!info.metadataURI) {
        console.log(chalk.yellow("No metadata URI set for this agent."));
        return;
      }
      console.log(chalk.dim(`Fetching metadata from: ${info.metadataURI}\n`));
      let meta;
      try {
        meta = await decodeMetadata(info.metadataURI);
      } catch (err) {
        console.error(chalk.red(`Failed to fetch or parse metadata: ${err instanceof Error ? err.message : String(err)}`));
        return;
      }
      console.log(chalk.bold("Agent Metadata") + chalk.dim(` (${meta.schema})`));
      if (meta.name)        console.log(`  name:        ${meta.name}`);
      if (meta.description) console.log(`  description: ${meta.description}`);
      if (meta.capabilities?.length) console.log(`  capabilities: ${meta.capabilities.join(", ")}`);
      if (meta.model) {
        console.log(`  model:`);
        if (meta.model.family)        console.log(`    family:        ${meta.model.family}`);
        if (meta.model.version)       console.log(`    version:       ${meta.model.version}`);
        if (meta.model.provider)      console.log(`    provider:      ${meta.model.provider}`);
        if (meta.model.contextWindow) console.log(`    contextWindow: ${meta.model.contextWindow}`);
        if (meta.model.multimodal !== undefined) console.log(`    multimodal:    ${meta.model.multimodal}`);
      }
      if (meta.pricing) {
        console.log(`  pricing: ${meta.pricing.base ?? "?"} ${meta.pricing.currency ?? ""} per ${meta.pricing.per ?? "job"}`);
      }
      if (meta.sla) {
        const parts: string[] = [];
        if (meta.sla.turnaroundHours)   parts.push(`${meta.sla.turnaroundHours}h turnaround`);
        if (meta.sla.availability)      parts.push(meta.sla.availability);
        if (meta.sla.maxConcurrentJobs) parts.push(`max ${meta.sla.maxConcurrentJobs} concurrent jobs`);
        if (parts.length) console.log(`  sla: ${parts.join(", ")}`);
      }
      if (meta.contact) {
        if (meta.contact.endpoint) console.log(`  contact.endpoint: ${meta.contact.endpoint}`);
        if (meta.contact.relay)    console.log(`  contact.relay:    ${meta.contact.relay}`);
      }
      if (meta.security) {
        console.log(`  security: injection=${meta.security.injectionProtection ?? false} envLeak=${meta.security.envLeakProtection ?? false} attested=${meta.security.attestedSecurityPolicy ?? false}`);
      }
    });

  // ─── heartbeat ──────────────────────────────────────────────────────────────

  agent
    .command("heartbeat")
    .description("Submit self-reported heartbeat data")
    .option("--latency-ms <n>", "Observed latency", "0")
    .action(async (opts) => {
      const config = loadConfig();
      const registryAddress = getAgentRegistryAddress(config);
      const { signer } = await requireSigner(config);
      const client = new AgentRegistryClient(registryAddress, signer);
      await client.submitHeartbeat(Number(opts.latencyMs));
      console.log("heartbeat submitted");
    });

  agent
    .command("heartbeat-policy")
    .description("Configure self-reported heartbeat timing metadata")
    .requiredOption("--interval <seconds>")
    .requiredOption("--grace <seconds>")
    .action(async (opts) => {
      const config = loadConfig();
      const registryAddress = getAgentRegistryAddress(config);
      const { signer } = await requireSigner(config);
      const client = new AgentRegistryClient(registryAddress, signer);
      await client.setHeartbeatPolicy(Number(opts.interval), Number(opts.grace));
      console.log("heartbeat policy updated");
    });

  // ─── info ───────────────────────────────────────────────────────────────────

  agent
    .command("info <address>")
    .option("--json")
    .action(async (address, opts) => {
      const config = loadConfig();
      const registryAddress = getAgentRegistryAddress(config);
      const { provider } = await getClient(config);
      const client = new AgentRegistryClient(registryAddress, provider);
      const [info, ops] = await Promise.all([
        client.getAgent(address),
        client.getOperationalMetrics(address),
      ]);
      if (opts.json) {
        return console.log(JSON.stringify({
          ...info,
          registeredAt: Number(info.registeredAt),
          endpointChangedAt: Number(info.endpointChangedAt),
          endpointChangeCount: Number(info.endpointChangeCount),
          trustScore: Number(info.trustScore ?? 0n),
          operational: Object.fromEntries(Object.entries(ops).map(([k, v]) => [k, Number(v)])),
        }, null, 2));
      }
      console.log(`${info.name} ${info.wallet}\nservice=${info.serviceType}\ntrust=${Number(info.trustScore ?? 0n)} (${getTrustTier(Number(info.trustScore ?? 0n))})\nregistered=${formatDate(Number(info.registeredAt))}\nheartbeatCount=${Number(ops.heartbeatCount)} uptimeScore=${Number(ops.uptimeScore)} responseScore=${Number(ops.responseScore)}`);
    });

  agent
    .command("me")
    .action(async () => {
      const config = loadConfig();
      const address = config.walletContractAddress ?? (await getClient(config)).address;
      if (!address) throw new Error("No wallet configured");
      await program.parseAsync([process.argv[0], process.argv[1], "agent", "info", address], { from: "user" });
    });
}

// ─── subdomain claim ──────────────────────────────────────────────────────────

async function claimSubdomain(subdomain: string, walletAddress: string, tunnelTarget: string): Promise<void> {
  const normalized = subdomain.toLowerCase();
  console.log(`\nClaiming subdomain: ${normalized}.arc402.xyz`);
  console.log(`  Wallet:  ${walletAddress}`);
  console.log(`  Target:  ${tunnelTarget}`);

  const res = await fetch("https://api.arc402.xyz/register-subdomain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subdomain: normalized, walletAddress, tunnelTarget }),
  });

  const body = await res.json() as Record<string, unknown>;

  if (!res.ok) {
    console.error(chalk.red(`✗ Subdomain claim failed (${res.status}): ${body["error"] ?? JSON.stringify(body)}`));
    process.exit(1);
  }

  console.log(chalk.green(`✓ Subdomain claimed: ${body["subdomain"]}`));
}

// ─── metadata wizard ──────────────────────────────────────────────────────────

async function runSetMetadataWizard(defaultName: string, defaultCapabilities: string[]): Promise<string> {
  console.log(chalk.bold("\nARC-402 Agent Metadata Wizard\n"));

  const answers = await prompts([
    { type: "text", name: "name", message: "Agent name:", initial: defaultName },
    { type: "text", name: "description", message: "Short description (what does this agent do?):" },
    { type: "text", name: "capabilities", message: "Capabilities (comma-separated, e.g. legal.patent-analysis.us.v1):", initial: defaultCapabilities.join(", ") },
    { type: "text", name: "modelFamily", message: "Model family (e.g. claude, gpt, gemini, llama — leave blank to omit):" },
    { type: "text", name: "modelVersion", message: "Model version (e.g. claude-sonnet-4-6 — leave blank to omit):" },
    { type: "text", name: "modelProvider", message: "Model provider (e.g. anthropic — leave blank to omit):" },
    { type: "text", name: "contactEndpoint", message: "Contact endpoint URL (leave blank to omit):" },
    { type: "confirm", name: "injectionProtection", message: "Does this agent have prompt injection protection?", initial: false },
    { type: "confirm", name: "envLeakProtection", message: "Does this agent have env/key leak protection in its instructions?", initial: false },
  ]);

  if (!answers.name) {
    console.log(chalk.dim("Cancelled."));
    return "";
  }

  const capabilities = answers.capabilities
    ? answers.capabilities.split(",").map((v: string) => v.trim()).filter(Boolean)
    : [];

  const meta = buildMetadata({
    name: answers.name || undefined,
    description: answers.description || undefined,
    capabilities: capabilities.length ? capabilities : undefined,
    model: (answers.modelFamily || answers.modelVersion || answers.modelProvider) ? {
      family:   answers.modelFamily   || undefined,
      version:  answers.modelVersion  || undefined,
      provider: answers.modelProvider || undefined,
    } : undefined,
    contact: answers.contactEndpoint ? { endpoint: answers.contactEndpoint } : undefined,
    security: {
      injectionProtection: answers.injectionProtection,
      envLeakProtection:   answers.envLeakProtection,
    },
  });

  const pinataJwt = process.env["PINATA_JWT"];
  if (!pinataJwt) {
    console.log(chalk.dim("\nNo PINATA_JWT env var found — metadata will be stored as a data URI."));
    console.log(chalk.dim("To pin to IPFS: export PINATA_JWT=<your-jwt> and re-run.\n"));
  } else {
    console.log(chalk.dim("\nUploading to IPFS via Pinata…"));
  }

  const uri = await uploadMetadata(meta, pinataJwt);
  console.log(chalk.green(`✓ Metadata URI: ${uri}`));
  return uri;
}
