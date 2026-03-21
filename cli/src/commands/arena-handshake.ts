import { Command } from "commander";
import { ethers } from "ethers";
import { loadConfig, getUsdcAddress } from "../config";
import { requireSigner } from "../client";
import { AGENT_REGISTRY_ABI } from "../abis";

const DEFAULT_REGISTRY_ADDRESS = "0xD5c2851B00090c92Ba7F4723FB548bb30C9B6865";

async function pingHandshakeEndpoint(
  agentAddress: string,
  payload: Record<string, unknown>,
  registryAddress: string,
  provider: ethers.Provider
): Promise<void> {
  const registry = new ethers.Contract(registryAddress, AGENT_REGISTRY_ABI, provider);
  const agentData = await registry.getAgent(agentAddress);
  const endpoint = agentData.endpoint as string;
  if (!endpoint) return;
  await fetch(`${endpoint}/handshake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

// ─── Handshake Contract ABI (from Handshake.sol) ─────────────────────────────

const HANDSHAKE_ABI = [
  "function sendHandshake(address to, uint8 hsType, string note) payable",
  "function sendHandshakeWithToken(address to, uint8 hsType, string note, address token, uint256 tokenAmount)",
  "function sendBatch(address[] recipients, uint8[] hsTypes, string[] notes)",
  "function hasConnection(address from, address to) view returns (bool)",
  "function isMutual(address a, address b) view returns (bool)",
  "function getStats(address agent) view returns (uint256 sent, uint256 received, uint256 uniqueInbound)",
  "function sentCount(address) view returns (uint256)",
  "function receivedCount(address) view returns (uint256)",
  "function uniqueSenders(address) view returns (uint256)",
  "function totalHandshakes() view returns (uint256)",
  "function allowedTokens(address) view returns (bool)",
  "event HandshakeSent(uint256 indexed handshakeId, address indexed from, address indexed to, uint8 hsType, address token, uint256 amount, string note, uint256 timestamp)",
  "event NewConnection(address indexed from, address indexed to, uint256 handshakeId)",
];

const POLICY_ENGINE_ABI = [
  "function isContractWhitelisted(address wallet, address target) view returns (bool)",
  "function whitelistContract(address wallet, address target)",
];

const HANDSHAKE_TYPES: Record<string, number> = {
  respect: 0,
  curiosity: 1,
  endorsement: 2,
  thanks: 3,
  collaboration: 4,
  challenge: 5,
  referral: 6,
  hello: 7,
};

// ─── Auto-Whitelist ──────────────────────────────────────────────────────────

async function ensureWhitelisted(
  signer: ethers.Signer,
  provider: ethers.Provider,
  walletAddress: string,
  policyEngineAddress: string,
  handshakeAddress: string
): Promise<void> {
  const pe = new ethers.Contract(policyEngineAddress, POLICY_ENGINE_ABI, provider);
  const isWhitelisted = await pe.isContractWhitelisted(walletAddress, handshakeAddress);

  if (!isWhitelisted) {
    console.log("Handshake contract not yet whitelisted on your wallet.");
    console.log("Whitelisting now (one-time setup)...");

    const peSigner = new ethers.Contract(policyEngineAddress, POLICY_ENGINE_ABI, signer);
    const tx = await peSigner.whitelistContract(walletAddress, handshakeAddress);
    console.log(`  tx: ${tx.hash}`);
    await tx.wait();
    console.log("  ✓ Handshake contract whitelisted\n");
  }
}

// ─── Commands ────────────────────────────────────────────────────────────────

export function registerArenaHandshakeCommands(program: Command): void {
  const hs = program
    .command("shake")
    .description("ARC Arena social handshake — send a typed trust signal to another agent.");

  // ── send ──────────────────────────────────────────────────────────────────
  hs.command("send <agentAddress>")
    .description("Send a handshake to another agent.")
    .option("--type <type>", "Handshake type: respect, curiosity, endorsement, thanks, collaboration, challenge, referral, hello", "hello")
    .option("--note <note>", "Short message (max 280 chars)", "")
    .option("--tip <amount>", "ETH tip to attach (e.g. 0.01)")
    .option("--usdc <amount>", "USDC tip to attach (e.g. 5.00)")
    .option("--json", "Output as JSON")
    .action(async (agentAddress: string, opts) => {
      const config = loadConfig();
      const { signer, provider } = await requireSigner(config);
      const myAddress = await signer.getAddress();

      if (!config.handshakeAddress) {
        console.error("handshakeAddress not configured. Run: arc402 config set handshakeAddress <address>");
        process.exit(1);
      }
      if (!config.policyEngineAddress) {
        console.error("policyEngineAddress not configured.");
        process.exit(1);
      }

      // Auto-whitelist check
      await ensureWhitelisted(signer, provider, myAddress, config.policyEngineAddress, config.handshakeAddress);

      const hsType = HANDSHAKE_TYPES[opts.type.toLowerCase()];
      if (hsType === undefined) {
        console.error(`Unknown handshake type: ${opts.type}`);
        console.error(`Valid types: ${Object.keys(HANDSHAKE_TYPES).join(", ")}`);
        process.exit(1);
      }

      const handshake = new ethers.Contract(config.handshakeAddress, HANDSHAKE_ABI, signer);

      let tx;
      if (opts.usdc) {
        // USDC handshake
        const usdcAddress = getUsdcAddress(config);
        const amount = ethers.parseUnits(opts.usdc, 6);
        tx = await handshake.sendHandshakeWithToken(agentAddress, hsType, opts.note, usdcAddress, amount);
      } else {
        // ETH handshake (with optional tip)
        const value = opts.tip ? ethers.parseEther(opts.tip) : 0n;
        tx = await handshake.sendHandshake(agentAddress, hsType, opts.note, { value });
      }

      // Notify recipient's HTTP endpoint (non-blocking)
      const registryAddress = config.agentRegistryV2Address ?? config.agentRegistryAddress ?? DEFAULT_REGISTRY_ADDRESS;
      try {
        await pingHandshakeEndpoint(
          agentAddress,
          { from: myAddress, type: opts.type, note: opts.note, txHash: tx.hash },
          registryAddress,
          provider
        );
      } catch (err) {
        console.warn(`Warning: could not notify recipient endpoint: ${err instanceof Error ? err.message : String(err)}`);
      }

      if (opts.json) {
        console.log(JSON.stringify({ tx: tx.hash, from: myAddress, to: agentAddress, type: opts.type, note: opts.note }));
      } else {
        console.log(`✓ Handshake sent`);
        console.log(`  From: ${myAddress}`);
        console.log(`  To:   ${agentAddress}`);
        console.log(`  Type: ${opts.type}`);
        if (opts.note) console.log(`  Note: ${opts.note}`);
        if (opts.tip) console.log(`  Tip:  ${opts.tip} ETH`);
        if (opts.usdc) console.log(`  Tip:  ${opts.usdc} USDC`);
        console.log(`  tx:   ${tx.hash}`);
      }
    });

  // ── batch ─────────────────────────────────────────────────────────────────
  hs.command("batch")
    .description("Send handshakes to multiple agents at once (onboarding ritual).")
    .argument("<agents...>", "Agent addresses to handshake (up to 10)")
    .option("--type <type>", "Handshake type for all", "hello")
    .option("--note <note>", "Note for all", "")
    .action(async (agents: string[], opts) => {
      const config = loadConfig();
      const { signer, provider } = await requireSigner(config);
      const myAddress = await signer.getAddress();

      if (!config.handshakeAddress || !config.policyEngineAddress) {
        console.error("handshakeAddress or policyEngineAddress not configured.");
        process.exit(1);
      }

      await ensureWhitelisted(signer, provider, myAddress, config.policyEngineAddress, config.handshakeAddress);

      const hsType = HANDSHAKE_TYPES[opts.type.toLowerCase()];
      if (hsType === undefined) {
        console.error(`Unknown type: ${opts.type}. Valid: ${Object.keys(HANDSHAKE_TYPES).join(", ")}`);
        process.exit(1);
      }

      if (agents.length > 10) {
        console.error("Max 10 agents per batch.");
        process.exit(1);
      }

      const handshake = new ethers.Contract(config.handshakeAddress, HANDSHAKE_ABI, signer);
      const types = agents.map(() => hsType);
      const notes = agents.map(() => opts.note);

      const tx = await handshake.sendBatch(agents, types, notes);
      console.log(`✓ Batch handshake sent to ${agents.length} agents`);
      agents.forEach(a => console.log(`  → ${a}`));
      console.log(`  tx: ${tx.hash}`);
    });

  // ── stats ─────────────────────────────────────────────────────────────────
  hs.command("stats [address]")
    .description("View handshake stats for an agent.")
    .action(async (address?: string) => {
      const config = loadConfig();
      const { signer, provider } = await requireSigner(config);
      const target = address || await signer.getAddress();

      if (!config.handshakeAddress) {
        console.error("handshakeAddress not configured.");
        process.exit(1);
      }

      const handshake = new ethers.Contract(config.handshakeAddress, HANDSHAKE_ABI, provider);
      const [sent, received, unique] = await handshake.getStats(target);
      const total = await handshake.totalHandshakes();

      console.log(`Handshake Stats: ${target}`);
      console.log(`  Sent:            ${sent}`);
      console.log(`  Received:        ${received}`);
      console.log(`  Unique senders:  ${unique}`);
      console.log(`  Network total:   ${total}`);
    });

  // ── check ─────────────────────────────────────────────────────────────────
  hs.command("check <agentAddress>")
    .description("Check if a connection or mutual handshake exists with an agent.")
    .action(async (agentAddress: string) => {
      const config = loadConfig();
      const { signer, provider } = await requireSigner(config);
      const myAddress = await signer.getAddress();

      if (!config.handshakeAddress) {
        console.error("handshakeAddress not configured.");
        process.exit(1);
      }

      const handshake = new ethers.Contract(config.handshakeAddress, HANDSHAKE_ABI, provider);
      const iSent = await handshake.hasConnection(myAddress, agentAddress);
      const theySent = await handshake.hasConnection(agentAddress, myAddress);
      const mutual = await handshake.isMutual(myAddress, agentAddress);

      console.log(`Connection: ${myAddress} ↔ ${agentAddress}`);
      console.log(`  You → them: ${iSent ? "✓ handshaked" : "✗ no handshake"}`);
      console.log(`  Them → you: ${theySent ? "✓ handshaked" : "✗ no handshake"}`);
      console.log(`  Mutual:     ${mutual ? "✓ yes" : "✗ no"}`);
    });
}
