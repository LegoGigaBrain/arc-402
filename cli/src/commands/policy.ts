import { Command } from "commander";
import { ethers } from "ethers";
import { loadConfig } from "../config";
import { getClient, requireSigner } from "../client";

const POLICY_ENGINE_EXTENDED_ABI = [
  "function addToBlocklist(address wallet, address provider) external",
  "function removeFromBlocklist(address wallet, address provider) external",
  "function isBlocked(address wallet, address provider) external view returns (bool)",
  "function addPreferred(address wallet, string capability, address provider) external",
  "function removePreferred(address wallet, string capability, address provider) external",
  "function getPreferred(address wallet, string capability) external view returns (address[])",
  "function isPreferred(address wallet, string capability, address provider) external view returns (bool)",
  "event ProviderBlocked(address indexed wallet, address indexed provider)",
  "event ProviderUnblocked(address indexed wallet, address indexed provider)",
  "event ProviderPreferred(address indexed wallet, address indexed provider, string capability)",
  "event ProviderUnpreferred(address indexed wallet, address indexed provider, string capability)",
] as const;

function getPolicyEngine(address: string, runner: ethers.ContractRunner) {
  return new ethers.Contract(address, POLICY_ENGINE_EXTENDED_ABI, runner);
}

const policy = new Command("policy").description("Personal policy enforcement: blocklist and shortlist");

// ─── blocklist ────────────────────────────────────────────────────────────────

const blocklist = policy.command("blocklist").description("Hard-stop blocklist: addresses your agent will never accept work from");

blocklist
  .command("add <address>")
  .description("Block a provider address")
  .option("--json")
  .action(async (address, opts) => {
    const config = loadConfig();
    if (!config.policyEngineAddress) {
      console.error("policyEngineAddress not configured. Run `arc402 config set policyEngineAddress <address>`.");
      process.exit(1);
    }
    const { signer, address: wallet } = await requireSigner(config);
    const contract = getPolicyEngine(config.policyEngineAddress, signer);
    const already = await contract.isBlocked(wallet, address);
    if (already) {
      if (opts.json) return console.log(JSON.stringify({ address, blocked: true, alreadyBlocked: true }));
      return console.log(`${address} is already blocked`);
    }
    await (await contract.addToBlocklist(wallet, address)).wait();
    if (opts.json) return console.log(JSON.stringify({ address, blocked: true }));
    console.log(`Added ${address} to blocklist`);
  });

blocklist
  .command("remove <address>")
  .description("Remove a provider from your blocklist")
  .option("--json")
  .action(async (address, opts) => {
    const config = loadConfig();
    if (!config.policyEngineAddress) {
      console.error("policyEngineAddress not configured. Run `arc402 config set policyEngineAddress <address>`.");
      process.exit(1);
    }
    const { signer, address: wallet } = await requireSigner(config);
    const contract = getPolicyEngine(config.policyEngineAddress, signer);
    const isBlockedNow = await contract.isBlocked(wallet, address);
    if (!isBlockedNow) {
      if (opts.json) return console.log(JSON.stringify({ address, blocked: false, notBlocked: true }));
      return console.log(`${address} is not on your blocklist`);
    }
    await (await contract.removeFromBlocklist(wallet, address)).wait();
    if (opts.json) return console.log(JSON.stringify({ address, blocked: false }));
    console.log(`Removed ${address} from blocklist`);
  });

blocklist
  .command("check <address>")
  .description("Check if an address is on your blocklist")
  .option("--json")
  .action(async (address, opts) => {
    const config = loadConfig();
    if (!config.policyEngineAddress) {
      console.error("policyEngineAddress not configured.");
      process.exit(1);
    }
    const { provider } = await getClient(config);
    const { address: wallet } = await requireSigner(config);
    const contract = getPolicyEngine(config.policyEngineAddress, provider);
    const blocked = await contract.isBlocked(wallet, address);
    if (opts.json) return console.log(JSON.stringify({ address, blocked }));
    console.log(blocked ? `${address} is BLOCKED` : `${address} is not blocked`);
  });

blocklist
  .command("list")
  .description("List all addresses on your blocklist (scans on-chain events)")
  .option("--from-block <n>", "Start block for event log query (default: latest-9000 to stay within public RPC limits)")
  .option("--json")
  .action(async (opts) => {
    const config = loadConfig();
    if (!config.policyEngineAddress) {
      console.error("policyEngineAddress not configured.");
      process.exit(1);
    }
    const { provider } = await getClient(config);
    const { address: wallet } = await requireSigner(config);
    const contract = getPolicyEngine(config.policyEngineAddress, provider);

    const latestBlock = await provider.getBlockNumber();
    const fromBlock = opts.fromBlock !== undefined ? parseInt(opts.fromBlock, 10) : Math.max(0, latestBlock - 9000);

    const [blockedEvents, unblockedEvents] = await Promise.all([
      contract.queryFilter(contract.filters.ProviderBlocked(wallet), fromBlock),
      contract.queryFilter(contract.filters.ProviderUnblocked(wallet), fromBlock),
    ]);
    const unblocked = new Set(
      unblockedEvents.map((e) => (e as ethers.EventLog).args.provider.toLowerCase())
    );
    const addresses = blockedEvents
      .map((e) => (e as ethers.EventLog).args.provider as string)
      .filter((p) => !unblocked.has(p.toLowerCase()));

    if (opts.json) return console.log(JSON.stringify({ wallet, blocked: addresses }, null, 2));
    if (addresses.length === 0) return console.log("No addresses on your blocklist");
    addresses.forEach((a) => console.log(a));
  });

// ─── shortlist ────────────────────────────────────────────────────────────────

const shortlist = policy.command("shortlist").description("Preferred providers per capability (preferred or exclusive)");

shortlist
  .command("add <address>")
  .description("Add a provider to your shortlist for a capability")
  .requiredOption("--capability <name>", "Capability name (e.g. code.review)")
  .option("--note <text>", "Optional note (stored off-chain only)")
  .option("--json")
  .action(async (address, opts) => {
    const config = loadConfig();
    if (!config.policyEngineAddress) {
      console.error("policyEngineAddress not configured. Run `arc402 config set policyEngineAddress <address>`.");
      process.exit(1);
    }
    const { signer, address: wallet } = await requireSigner(config);
    const contract = getPolicyEngine(config.policyEngineAddress, signer);
    const alreadyPreferred = await contract.isPreferred(wallet, opts.capability, address);
    if (alreadyPreferred) {
      if (opts.json) return console.log(JSON.stringify({ address, capability: opts.capability, preferred: true, alreadyPreferred: true }));
      return console.log(`${address} is already shortlisted for ${opts.capability}`);
    }
    await (await contract.addPreferred(wallet, opts.capability, address)).wait();
    if (opts.json) return console.log(JSON.stringify({ address, capability: opts.capability, preferred: true }));
    console.log(`Added ${address} to shortlist for ${opts.capability}`);
  });

shortlist
  .command("remove <address>")
  .description("Remove a provider from your shortlist for a capability")
  .requiredOption("--capability <name>", "Capability name")
  .option("--json")
  .action(async (address, opts) => {
    const config = loadConfig();
    if (!config.policyEngineAddress) {
      console.error("policyEngineAddress not configured. Run `arc402 config set policyEngineAddress <address>`.");
      process.exit(1);
    }
    const { signer, address: wallet } = await requireSigner(config);
    const contract = getPolicyEngine(config.policyEngineAddress, signer);
    const isPreferredNow = await contract.isPreferred(wallet, opts.capability, address);
    if (!isPreferredNow) {
      if (opts.json) return console.log(JSON.stringify({ address, capability: opts.capability, preferred: false, notPreferred: true }));
      return console.log(`${address} is not shortlisted for ${opts.capability}`);
    }
    await (await contract.removePreferred(wallet, opts.capability, address)).wait();
    if (opts.json) return console.log(JSON.stringify({ address, capability: opts.capability, preferred: false }));
    console.log(`Removed ${address} from shortlist for ${opts.capability}`);
  });

shortlist
  .command("check <address>")
  .description("Check if an address is shortlisted for a capability")
  .requiredOption("--capability <name>", "Capability name")
  .option("--json")
  .action(async (address, opts) => {
    const config = loadConfig();
    if (!config.policyEngineAddress) {
      console.error("policyEngineAddress not configured.");
      process.exit(1);
    }
    const { provider } = await getClient(config);
    const { address: wallet } = await requireSigner(config);
    const contract = getPolicyEngine(config.policyEngineAddress, provider);
    const preferred = await contract.isPreferred(wallet, opts.capability, address);
    if (opts.json) return console.log(JSON.stringify({ address, capability: opts.capability, preferred }));
    console.log(preferred ? `${address} is shortlisted for ${opts.capability}` : `${address} is NOT shortlisted for ${opts.capability}`);
  });

shortlist
  .command("list")
  .description("List shortlisted providers, optionally filtered by capability")
  .option("--capability <name>", "Filter by capability name")
  .option("--from-block <n>", "Start block for event log query (default: latest-9000 to stay within public RPC limits)")
  .option("--json")
  .action(async (opts) => {
    const config = loadConfig();
    if (!config.policyEngineAddress) {
      console.error("policyEngineAddress not configured.");
      process.exit(1);
    }
    const { provider } = await getClient(config);
    const { address: wallet } = await requireSigner(config);
    const contract = getPolicyEngine(config.policyEngineAddress, provider);

    if (opts.capability) {
      const addresses = await contract.getPreferred(wallet, opts.capability) as string[];
      if (opts.json) return console.log(JSON.stringify({ wallet, capability: opts.capability, preferred: addresses }, null, 2));
      if (addresses.length === 0) return console.log(`No providers shortlisted for ${opts.capability}`);
      addresses.forEach((a) => console.log(a));
      return;
    }

    // No capability filter — reconstruct from events
    const latestBlock = await provider.getBlockNumber();
    const fromBlock = opts.fromBlock !== undefined ? parseInt(opts.fromBlock, 10) : Math.max(0, latestBlock - 9000);
    const [preferredEvents, unpreferredEvents] = await Promise.all([
      contract.queryFilter(contract.filters.ProviderPreferred(wallet), fromBlock),
      contract.queryFilter(contract.filters.ProviderUnpreferred(wallet), fromBlock),
    ]);
    const removed = new Set(
      unpreferredEvents.map((e) => {
        const args = (e as ethers.EventLog).args;
        return `${(args.provider as string).toLowerCase()}::${args.capability as string}`;
      })
    );
    const byCapability: Record<string, string[]> = {};
    for (const e of preferredEvents) {
      const args = (e as ethers.EventLog).args;
      const addr = args.provider as string;
      const cap = args.capability as string;
      if (removed.has(`${addr.toLowerCase()}::${cap}`)) continue;
      if (!byCapability[cap]) byCapability[cap] = [];
      if (!byCapability[cap].includes(addr)) byCapability[cap].push(addr);
    }

    if (opts.json) return console.log(JSON.stringify({ wallet, shortlist: byCapability }, null, 2));
    const caps = Object.keys(byCapability);
    if (caps.length === 0) return console.log("No providers on your shortlist");
    for (const cap of caps) {
      console.log(`${cap}:`);
      byCapability[cap].forEach((a) => console.log(`  ${a}`));
    }
  });

export default policy;
