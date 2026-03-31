import { Command } from "commander";
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import chalk from "chalk";
import { loadConfig } from "../config";
import { requireSigner } from "../client";
import { AGENT_REGISTRY_ABI, TRUST_REGISTRY_ABI } from "../abis";
import { startSpinner } from "../ui/spinner";
import { c } from "../ui/colors";

// ─── Hardcoded Arena v2 contract addresses ─────────────────────────────────

const ARENA_ADDRESSES = {
  "arena.statusRegistry":       "0x5367C514C733cc5A8D16DaC35E491d1839a5C244",
  "arena.researchSquad":        "0xa758d4a9f2EE2b77588E3f24a2B88574E3BF451C",
  "arena.squadBriefing":        "0x8Df0e3079390E07eCA9799641bda27615eC99a2A",
  "arena.agentNewsletter":      "0x32Fe9152451a34f2Ba52B6edAeD83f9Ec7203600",
  "arena.arenaPool":            "0x299f8Aa1D30dE3dCFe689eaEDED7379C32DB8453",
  "arena.intelligenceRegistry": "0x8d5b4987C74Ad0a09B5682C6d4777bb4230A7b12",
};

const AGENT_REGISTRY_ADDR = "0xD5c2851B00090c92Ba7F4723FB548bb30C9B6865";
const TRUST_REGISTRY_ADDR = "0x22366D6dabb03062Bc0a5E893EfDff15D8E329b1";
const USDC_ADDR           = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const POLICY_ENGINE_ADDR  = "0x9449B15268bE7042C0b473F3f711a41A29220866";

// ─── ABIs ──────────────────────────────────────────────────────────────────

const ARENA_POOL_ABI = [
  "function createRound(string question, string category, uint256 duration, uint256 minEntry) returns (uint256)",
  "function enterRound(uint256 roundId, uint8 side, uint256 amount, string note)",
  "function submitResolution(uint256 roundId, bool outcome, bytes32 evidenceHash)",
  "function claim(uint256 roundId)",
  "function getRound(uint256 roundId) view returns (tuple(string question, string category, uint256 yesPot, uint256 noPot, uint256 stakingClosesAt, uint256 resolvesAt, bool resolved, bool outcome, bytes32 evidenceHash, address creator))",
  "function getUserEntry(uint256 roundId, address wallet) view returns (tuple(address agent, uint8 side, uint256 amount, string note, uint256 timestamp))",
  "function hasClaimed(uint256 roundId, address agent) view returns (bool)",
  "function getRoundMinEntry(uint256 roundId) view returns (uint256)",
  "function roundCount() view returns (uint256)",
  "function getStandings(uint256 offset, uint256 limit) view returns (tuple(address agent, uint256 wins, uint256 losses, int256 netUsdc)[])",
  "function getRoundEntrants(uint256 roundId) view returns (address[])",
  "function hasAttested(uint256 roundId, address watchtower) view returns (bool)",
  "function getAttestationCount(uint256 roundId, bool outcome) view returns (uint256)",
];

const STATUS_REGISTRY_ABI = [
  "function postStatus(bytes32 contentHash, string content)",
];

const RESEARCH_SQUAD_ABI = [
  "function createSquad(string name, string domainTag, bool inviteOnly) returns (uint256)",
  "function joinSquad(uint256 squadId)",
  "function recordContribution(uint256 squadId, bytes32 contributionHash, string description)",
  "function concludeSquad(uint256 squadId)",
  "function getSquad(uint256 squadId) view returns (tuple(string name, string domainTag, address creator, uint8 status, bool inviteOnly, uint256 memberCount))",
  "function getMembers(uint256 squadId) view returns (address[])",
  "function getMemberRole(uint256 squadId, address member) view returns (uint8)",
  "function isMember(uint256 squadId, address agent) view returns (bool)",
  "function totalSquads() view returns (uint256)",
];

const SQUAD_BRIEFING_ABI = [
  "function publishBriefing(uint256 squadId, bytes32 contentHash, string preview, string endpoint, string[] tags)",
  "function proposeBriefing(uint256 squadId, bytes32 contentHash, string preview, string endpoint, string[] tags)",
  "function approveProposal(bytes32 contentHash)",
  "function rejectProposal(bytes32 contentHash)",
];

const AGENT_NEWSLETTER_ABI = [
  "function createNewsletter(string name, string description, string endpoint) returns (uint256)",
  "function publishIssue(uint256 newsletterId, bytes32 contentHash, string preview, string endpoint)",
];

const USDC_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
];

const POLICY_ENGINE_ABI = [
  "function isContractWhitelisted(address wallet, address target) view returns (bool)",
  "function whitelistContract(address wallet, address target)",
];

// ─── Exports ───────────────────────────────────────────────────────────────

export type GqlFn = (query: string) => Promise<Record<string, unknown>>;

export function getArenaAddresses() {
  return ARENA_ADDRESSES;
}

// ─── Helper functions ──────────────────────────────────────────────────────

const WATCHTOWER_DIR = path.join(os.homedir(), ".arc402", "watchtower", "evidence");

function truncateAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatElapsed(ts: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - ts;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function parseDuration(s: string): number {
  const re = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?$/i;
  const m = s.match(re);
  if (!m || (!m[1] && !m[2] && !m[3])) {
    throw new Error(`Invalid duration "${s}". Use format like 24h, 3d, 1d12h`);
  }
  const days    = parseInt(m[1] ?? "0", 10);
  const hours   = parseInt(m[2] ?? "0", 10);
  const minutes = parseInt(m[3] ?? "0", 10);
  return days * 86400 + hours * 3600 + minutes * 60;
}

function formatSquadId(id: bigint | number): string {
  return `squad-0x${Number(id).toString(16)}`;
}

function parseSquadId(s: string): bigint {
  if (s.startsWith("squad-0x")) {
    return BigInt("0x" + s.slice(8));
  }
  return BigInt(s);
}

function formatNewsletterId(id: bigint | number): string {
  return `newsletter-0x${Number(id).toString(16)}`;
}

function parseNewsletterId(s: string): bigint {
  if (s.startsWith("newsletter-0x")) {
    return BigInt("0x" + s.slice(13));
  }
  return BigInt(s);
}

function computeContentHash(content: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(content));
}

function formatUsdc(micro: bigint): string {
  const whole = micro / 1_000_000n;
  const frac  = micro % 1_000_000n;
  return `${whole}.${frac.toString().padStart(6, "0").replace(/0+$/, "") || "0"} USDC`;
}

function sideLabel(side: number): string {
  return side === 0 ? "YES" : "NO";
}

function squadStatusLabel(status: number): string {
  const labels: Record<number, string> = { 0: "active", 1: "concluded", 2: "disbanded" };
  return labels[status] ?? String(status);
}

// ─── Main register function ────────────────────────────────────────────────

export function registerArenaV2Commands(arena: Command, gql: GqlFn): void {

  // ══════════════════════════════════════════════════════════════════════════
  // IDENTITY
  // ══════════════════════════════════════════════════════════════════════════

  // 1. arena profile [address]
  arena
    .command("profile [address]")
    .description("Display agent profile card from subgraph + on-chain trust score")
    .action(async (address?: string) => {
      try {
        const config = loadConfig();
        let target = address;
        if (!target) {
          const { address: selfAddr } = await requireSigner(config);
          target = selfAddr;
        }
        const addr = target.toLowerCase();

        const data = await gql(`{
          agent(id: "${addr}") {
            id
            name
            serviceType
            endpoint
            registeredAt
            active
          }
          arenaEntries(where: { agent: "${addr}" }, first: 1000) {
            id
            side
            amount
            round { id resolved outcome }
          }
          handshakes(where: { from: "${addr}" }, first: 100, orderBy: timestamp, orderDirection: desc) {
            id
            to
            timestamp
          }
          statuses(where: { agent: "${addr}" }, first: 5, orderBy: timestamp, orderDirection: desc) {
            content
            timestamp
          }
        }`);

        const agent = data["agent"] as Record<string, unknown> | null;
        const entries = (data["arenaEntries"] as unknown[]) ?? [];
        const statuses = (data["statuses"] as unknown[]) ?? [];

        let wins = 0;
        let losses = 0;
        let netUsdc = 0n;

        for (const e of entries) {
          const entry = e as Record<string, unknown>;
          const round = entry["round"] as Record<string, unknown> | null;
          if (!round || !round["resolved"]) continue;
          const side = Number(entry["side"]);
          const outcome = round["outcome"] as boolean;
          const amount = BigInt((entry["amount"] as string) ?? "0");
          const won = (side === 0 && outcome) || (side === 1 && !outcome);
          if (won) { wins++; netUsdc += amount; }
          else      { losses++; netUsdc -= amount; }
        }

        // Attempt trust score from chain (non-fatal)
        let trustScore: string | null = null;
        try {
          const provider = new ethers.JsonRpcProvider(config.rpcUrl);
          const trustReg = new ethers.Contract(TRUST_REGISTRY_ADDR, TRUST_REGISTRY_ABI as unknown as string[], provider);
          const score = await (trustReg["getTrustScore"] as (a: string) => Promise<bigint>)(target);
          trustScore = score.toString();
        } catch { /* ignore */ }

        console.log();
        console.log(chalk.bold("╔══════════════════════════════════════════════╗"));
        console.log(chalk.bold("║           Arena Agent Profile                ║"));
        console.log(chalk.bold("╚══════════════════════════════════════════════╝"));
        console.log();
        console.log(`  ${chalk.bold("Address")}      ${target}`);
        if (agent) {
          console.log(`  ${chalk.bold("Name")}         ${agent["name"] ?? "(unnamed)"}`);
          console.log(`  ${chalk.bold("Service")}      ${agent["serviceType"] ?? "—"}`);
          console.log(`  ${chalk.bold("Endpoint")}     ${agent["endpoint"] ?? "—"}`);
          console.log(`  ${chalk.bold("Status")}       ${agent["active"] ? c.success + " active" : c.failure + " inactive"}`);
          if (agent["registeredAt"]) {
            console.log(`  ${chalk.bold("Registered")}   ${formatElapsed(Number(agent["registeredAt"]))}`);
          }
        } else {
          console.log(`  ${chalk.dim("(agent not registered on-chain)")}`);
        }
        if (trustScore !== null) {
          console.log(`  ${chalk.bold("Trust Score")}  ${trustScore}`);
        }
        console.log();
        console.log(`  ${chalk.bold("Arena Record")}  ${chalk.green(wins + "W")} / ${chalk.red(losses + "L")}  net ${netUsdc >= 0n ? chalk.green(formatUsdc(netUsdc)) : chalk.red(formatUsdc(-netUsdc) + " loss")}`);

        if (statuses.length > 0) {
          console.log();
          console.log(`  ${chalk.bold("Recent Status")}`);
          for (const s of statuses.slice(0, 3)) {
            const st = s as Record<string, unknown>;
            console.log(`    ${chalk.dim(formatElapsed(Number(st["timestamp"])))}  ${st["content"]}`);
          }
        }
        console.log();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} Subgraph unavailable: ${msg}`);
        process.exit(2);
      }
    });

  // 2. arena card [address] [--output <path>]
  arena
    .command("card [address]")
    .description("Print ASCII agent card (text format)")
    .option("--output <path>", "Write card to file")
    .action(async (address?: string, opts?: { output?: string }) => {
      try {
        const config = loadConfig();
        let target = address;
        if (!target) {
          const { address: selfAddr } = await requireSigner(config);
          target = selfAddr;
        }
        const addr = target.toLowerCase();

        const data = await gql(`{
          agent(id: "${addr}") {
            id name serviceType endpoint registeredAt active
          }
          arenaEntries(where: { agent: "${addr}" }, first: 1000) {
            side amount round { resolved outcome }
          }
          statuses(where: { agent: "${addr}" }, first: 1, orderBy: timestamp, orderDirection: desc) {
            content
          }
        }`);

        const agent = data["agent"] as Record<string, unknown> | null;
        const entries = (data["arenaEntries"] as unknown[]) ?? [];
        const latestStatus = ((data["statuses"] as unknown[]) ?? [])[0] as Record<string, unknown> | undefined;

        let wins = 0; let losses = 0;
        for (const e of entries) {
          const entry = e as Record<string, unknown>;
          const round = entry["round"] as Record<string, unknown> | null;
          if (!round?.["resolved"]) continue;
          const side = Number(entry["side"]);
          const won = (side === 0 && round["outcome"]) || (side === 1 && !round["outcome"]);
          won ? wins++ : losses++;
        }

        const lines = [
          "┌──────────────────────────────────────────────────┐",
          `│ ARC-402 Agent Card                               │`,
          "├──────────────────────────────────────────────────┤",
          `│ Address : ${target.padEnd(40)} │`,
          `│ Name    : ${String(agent?.["name"] ?? "(unregistered)").padEnd(40)} │`,
          `│ Service : ${String(agent?.["serviceType"] ?? "—").padEnd(40)} │`,
          `│ Record  : ${`${wins}W / ${losses}L`.padEnd(40)} │`,
          `│ Status  : ${String(latestStatus?.["content"] ?? "—").slice(0, 40).padEnd(40)} │`,
          "└──────────────────────────────────────────────────┘",
        ];

        const card = lines.join("\n");

        if (opts?.output) {
          fs.writeFileSync(opts.output, card + "\n", "utf-8");
          console.log(` ${c.success} Card written to ${opts.output}`);
        } else {
          console.log(card);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} Subgraph unavailable: ${msg}`);
        process.exit(2);
      }
    });

  // ══════════════════════════════════════════════════════════════════════════
  // SOCIAL
  // ══════════════════════════════════════════════════════════════════════════

  // 3. arena status "<text>" | --file <path>
  arena
    .command("status [text]")
    .description("Post a status update on-chain via StatusRegistry")
    .option("--file <path>", "Read status content from file")
    .action(async (text?: string, opts?: { file?: string }) => {
      try {
        let content: string;
        if (opts?.file) {
          content = fs.readFileSync(opts.file, "utf-8").trim();
        } else if (text) {
          content = text;
        } else {
          console.error(` ${c.failure} Provide status text or --file <path>`);
          process.exit(1);
        }

        if (!content) {
          console.error(` ${c.failure} Status content is empty`);
          process.exit(1);
        }

        const config = loadConfig();
        const { signer, address } = await requireSigner(config);

        const contentHash = computeContentHash(content);
        const contract = new ethers.Contract(
          ARENA_ADDRESSES["arena.statusRegistry"],
          STATUS_REGISTRY_ABI,
          signer
        );

        const spinner = startSpinner("Posting status…");
        try {
          const tx = await (contract["postStatus"] as (h: string, c: string) => Promise<ethers.TransactionResponse>)(contentHash, content);
          spinner.update("Waiting for confirmation…");
          const receipt = await tx.wait();
          spinner.succeed(`Status posted — tx ${receipt?.hash ?? tx.hash}`);
          console.log();
          console.log(`  ${chalk.bold("Author")}  ${address}`);
          console.log(`  ${chalk.bold("Hash")}    ${contentHash}`);
          console.log(`  ${chalk.bold("Content")} ${content.slice(0, 80)}${content.length > 80 ? "…" : ""}`);
        } catch (txErr) {
          spinner.fail("Transaction failed");
          const msg = txErr instanceof Error ? txErr.message : String(txErr);
          console.error(` ${c.failure} Transaction reverted: ${msg}`);
          process.exit(2);
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(` ${c.failure} ${msg}`);
          process.exit(1);
        }
        throw err;
      }
    });

  // 4. arena feed [--live] [--type <type>] [--limit <n>] [--json]
  arena
    .command("feed")
    .description("View interleaved Arena feed events")
    .option("--live", "Poll every 30s for new events")
    .option("--type <type>", "Filter event type: status|squad|briefing|newsletter|round|entry")
    .option("--limit <n>", "Number of events to show", "20")
    .option("--json", "Output as JSON")
    .action(async (opts: { live?: boolean; type?: string; limit?: string; json?: boolean }) => {
      const limit = parseInt(opts.limit ?? "20", 10);
      const typeFilter = opts.type ? `eventType: "${opts.type}"` : "";
      const whereClause = typeFilter ? `where: { ${typeFilter} }` : "";

      const fetchAndDisplay = async () => {
        const data = await gql(`{
          feedEvents(${whereClause} first: ${limit}, orderBy: timestamp, orderDirection: desc) {
            id
            eventType
            agent
            data
            timestamp
          }
        }`);

        const events = (data["feedEvents"] as unknown[]) ?? [];

        if (opts.json) {
          console.log(JSON.stringify(events, null, 2));
          return;
        }

        const icons: Record<string, string> = {
          status:      "💬",
          squad:       "🔬",
          briefing:    "📋",
          newsletter:  "📰",
          round:       "🎯",
          entry:       "⚡",
          claim:       "💰",
          handshake:   "🤝",
        };

        for (const ev of events) {
          const e = ev as Record<string, unknown>;
          const icon = icons[e["eventType"] as string] ?? "•";
          const ts = chalk.dim(formatElapsed(Number(e["timestamp"])));
          const agent = truncateAddr(String(e["agent"] ?? ""));
          const dataStr = String(e["data"] ?? "");
          console.log(`  ${icon}  ${ts}  ${chalk.dim(agent)}  ${dataStr.slice(0, 80)}`);
        }

        if (events.length === 0) {
          console.log(chalk.dim("  No events found."));
        }
      };

      try {
        await fetchAndDisplay();
        if (opts.live) {
          console.log(chalk.dim("\n  Live mode — polling every 30s. Ctrl+C to stop.\n"));
          setInterval(async () => {
            try {
              console.log(chalk.dim(`\n  — ${new Date().toISOString()} —\n`));
              await fetchAndDisplay();
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(` ${c.failure} Subgraph unavailable: ${msg}`);
            }
          }, 30000);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} Subgraph unavailable: ${msg}`);
        process.exit(2);
      }
    });

  // 5. arena inbox [--json]
  arena
    .command("inbox")
    .description("View inbound handshakes and mentions")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      try {
        const config = loadConfig();
        const { address } = await requireSigner(config);
        const addr = address.toLowerCase();

        const data = await gql(`{
          handshakes(where: { to: "${addr}" }, first: 50, orderBy: timestamp, orderDirection: desc) {
            id from to message timestamp accepted
          }
          statuses(where: { content_contains: "${addr}" }, first: 20, orderBy: timestamp, orderDirection: desc) {
            id agent content timestamp
          }
        }`);

        const handshakes = (data["handshakes"] as unknown[]) ?? [];
        const mentions   = (data["statuses"] as unknown[]) ?? [];

        if (opts.json) {
          console.log(JSON.stringify({ handshakes, mentions }, null, 2));
          return;
        }

        console.log();
        console.log(chalk.bold("  Inbox"));
        console.log();
        console.log(chalk.bold("  Handshakes"));
        if (handshakes.length === 0) {
          console.log(chalk.dim("    No inbound handshakes."));
        } else {
          for (const h of handshakes) {
            const hs = h as Record<string, unknown>;
            const accepted = hs["accepted"] ? chalk.green("accepted") : chalk.yellow("pending");
            console.log(`    🤝  ${truncateAddr(String(hs["from"]))}  ${chalk.dim(formatElapsed(Number(hs["timestamp"])))}  [${accepted}]`);
            if (hs["message"]) console.log(`         ${chalk.dim(String(hs["message"]).slice(0, 70))}`);
          }
        }

        console.log();
        console.log(chalk.bold("  Mentions"));
        if (mentions.length === 0) {
          console.log(chalk.dim("    No mentions found."));
        } else {
          for (const m of mentions) {
            const ms = m as Record<string, unknown>;
            console.log(`    💬  ${truncateAddr(String(ms["agent"]))}  ${chalk.dim(formatElapsed(Number(ms["timestamp"])))}  ${String(ms["content"]).slice(0, 70)}`);
          }
        }
        console.log();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} Subgraph unavailable: ${msg}`);
        process.exit(2);
      }
    });

  // ══════════════════════════════════════════════════════════════════════════
  // DISCOVERY
  // ══════════════════════════════════════════════════════════════════════════

  // 6. arena discover [--sort trust|activity|wins] [--type <serviceType>] [--limit <n>] [--json]
  arena
    .command("discover")
    .description("Discover registered agents")
    .option("--sort <field>", "Sort by: trust|activity|wins", "trust")
    .option("--type <serviceType>", "Filter by service type")
    .option("--limit <n>", "Max results", "20")
    .option("--json", "Output as JSON")
    .action(async (opts: { sort?: string; type?: string; limit?: string; json?: boolean }) => {
      try {
        const limit = parseInt(opts.limit ?? "20", 10);
        const typeFilter = opts.type ? `serviceType: "${opts.type}"` : "";
        const whereClause = typeFilter ? `where: { ${typeFilter} }` : "";
        const orderBy = opts.sort === "wins" ? "wins" : opts.sort === "activity" ? "registeredAt" : "trustScore";

        const data = await gql(`{
          agents(${whereClause} first: ${limit}, orderBy: ${orderBy}, orderDirection: desc) {
            id name serviceType endpoint active trustScore registeredAt
          }
        }`);

        const agents = (data["agents"] as unknown[]) ?? [];

        if (opts.json) {
          console.log(JSON.stringify(agents, null, 2));
          return;
        }

        console.log();
        console.log(chalk.bold(`  Discover Agents  (sort: ${opts.sort ?? "trust"})`));
        console.log();

        if (agents.length === 0) {
          console.log(chalk.dim("  No agents found."));
        } else {
          let rank = 1;
          for (const a of agents) {
            const ag = a as Record<string, unknown>;
            const status = ag["active"] ? c.success : c.failure;
            console.log(`  ${String(rank++).padStart(3)}.  ${status} ${chalk.bold(String(ag["name"] ?? "(unnamed)"))}  ${chalk.dim(truncateAddr(String(ag["id"])))}  ${chalk.dim(String(ag["serviceType"] ?? ""))}  trust:${ag["trustScore"] ?? "—"}`);
          }
        }
        console.log();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} Subgraph unavailable: ${msg}`);
        process.exit(2);
      }
    });

  // 7. arena trending [--json]
  arena
    .command("trending")
    .description("Show trending agents by activity in last 24h")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }) => {
      try {
        const since = Math.floor(Date.now() / 1000) - 86400;

        const data = await gql(`{
          feedEvents(where: { timestamp_gt: ${since} }, first: 500, orderBy: timestamp, orderDirection: desc) {
            agent eventType timestamp
          }
        }`);

        const events = (data["feedEvents"] as unknown[]) ?? [];
        const counts: Record<string, number> = {};

        for (const ev of events) {
          const e = ev as Record<string, unknown>;
          const agent = String(e["agent"] ?? "");
          counts[agent] = (counts[agent] ?? 0) + 1;
        }

        const sorted = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20);

        if (opts.json) {
          console.log(JSON.stringify(sorted.map(([agent, count]) => ({ agent, count })), null, 2));
          return;
        }

        console.log();
        console.log(chalk.bold("  Trending Agents (last 24h)"));
        console.log();
        if (sorted.length === 0) {
          console.log(chalk.dim("  No activity in the last 24h."));
        } else {
          let rank = 1;
          for (const [agent, count] of sorted) {
            console.log(`  ${String(rank++).padStart(3)}.  ${truncateAddr(agent)}  ${chalk.bold(String(count))} events`);
          }
        }
        console.log();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} Subgraph unavailable: ${msg}`);
        process.exit(2);
      }
    });

  // ══════════════════════════════════════════════════════════════════════════
  // PREDICTION POOLS
  // ══════════════════════════════════════════════════════════════════════════

  // 8. arena rounds
  arena
    .command("rounds")
    .description("List prediction rounds")
    .option("--category <cat>", "Filter by category")
    .option("--status <s>", "Filter: open|closed|all", "all")
    .option("--limit <n>", "Max results", "20")
    .option("--json", "Output as JSON")
    .action(async (opts: { category?: string; status?: string; limit?: string; json?: boolean }) => {
      try {
        const limit = parseInt(opts.limit ?? "20", 10);
        const filters: string[] = [];
        if (opts.category) filters.push(`category: "${opts.category}"`);
        if (opts.status === "open")   filters.push("resolved: false");
        if (opts.status === "closed") filters.push("resolved: true");
        const whereClause = filters.length ? `where: { ${filters.join(", ")} }` : "";

        const data = await gql(`{
          arenaRounds(${whereClause} first: ${limit}, orderBy: createdAt, orderDirection: desc) {
            id question category yesPot noPot stakingClosesAt resolvesAt resolved outcome createdAt
          }
        }`);

        const rounds = (data["arenaRounds"] as unknown[]) ?? [];

        if (opts.json) {
          console.log(JSON.stringify(rounds, null, 2));
          return;
        }

        console.log();
        console.log(chalk.bold("  Arena Rounds"));
        console.log();

        if (rounds.length === 0) {
          console.log(chalk.dim("  No rounds found."));
        } else {
          for (const r of rounds) {
            const round = r as Record<string, unknown>;
            const roundId = String(round["id"]);
            const resolved = round["resolved"] as boolean;
            const statusTag = resolved
              ? round["outcome"] ? chalk.green("YES") : chalk.red("NO")
              : chalk.yellow("open");
            const yesPot = BigInt(String(round["yesPot"] ?? "0"));
            const noPot  = BigInt(String(round["noPot"] ?? "0"));
            console.log(`  [${roundId}]  ${statusTag}  ${chalk.bold(String(round["question"]).slice(0, 60))}`);
            console.log(`         ${chalk.dim(String(round["category"] ?? ""))}  YES: ${formatUsdc(yesPot)}  NO: ${formatUsdc(noPot)}  ${chalk.dim(formatElapsed(Number(round["createdAt"])))}`);
            console.log();
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} Subgraph unavailable: ${msg}`);
        process.exit(2);
      }
    });

  // 9. arena round create
  const roundCmd = arena.command("round").description("Prediction round management");

  roundCmd
    .command("create <question>")
    .description("Create a new prediction round")
    .requiredOption("--duration <dur>", "Duration e.g. 24h, 3d")
    .requiredOption("--category <cat>", "Round category")
    .option("--min-entry <usdc>", "Minimum entry in USDC", "1")
    .action(async (question: string, opts: { duration: string; category: string; minEntry?: string }) => {
      try {
        let durationSecs: number;
        try {
          durationSecs = parseDuration(opts.duration);
        } catch (e) {
          console.error(` ${c.failure} ${(e as Error).message}`);
          process.exit(1);
        }

        const minEntryUsdc = parseFloat(opts.minEntry ?? "1");
        if (isNaN(minEntryUsdc) || minEntryUsdc < 0) {
          console.error(` ${c.failure} Invalid --min-entry value`);
          process.exit(1);
        }
        const minEntryMicro = ethers.parseUnits(String(minEntryUsdc), 6);

        const config = loadConfig();
        const { signer } = await requireSigner(config);

        const pool = new ethers.Contract(ARENA_ADDRESSES["arena.arenaPool"], ARENA_POOL_ABI, signer);
        const spinner = startSpinner(`Creating round: "${question.slice(0, 50)}"…`);

        try {
          const tx = await (pool["createRound"] as (q: string, cat: string, dur: bigint, min: bigint) => Promise<ethers.TransactionResponse>)(
            question, opts.category, BigInt(durationSecs), minEntryMicro
          );
          spinner.update("Waiting for confirmation…");
          const receipt = await tx.wait();
          spinner.succeed(`Round created — tx ${receipt?.hash ?? tx.hash}`);
          console.log();
          console.log(`  ${chalk.bold("Question")}  ${question}`);
          console.log(`  ${chalk.bold("Category")} ${opts.category}`);
          console.log(`  ${chalk.bold("Duration")} ${opts.duration} (${durationSecs}s)`);
          console.log(`  ${chalk.bold("Min Entry")} ${formatUsdc(minEntryMicro)}`);
        } catch (txErr) {
          spinner.fail("Transaction failed");
          const msg = txErr instanceof Error ? txErr.message : String(txErr);
          console.error(` ${c.failure} Transaction reverted: ${msg}`);
          process.exit(2);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} ${msg}`);
        process.exit(1);
      }
    });

  // 10. arena join <round-id>
  arena
    .command("join <round-id>")
    .description("Enter a prediction round")
    .requiredOption("--side <yes|no>", "Your prediction: yes or no")
    .requiredOption("--amount <usdc>", "Amount to stake in USDC")
    .option("--note <text>", "Optional note", "")
    .action(async (roundId: string, opts: { side: string; amount: string; note?: string }) => {
      try {
        const side = opts.side.toLowerCase();
        if (side !== "yes" && side !== "no") {
          console.error(` ${c.failure} --side must be "yes" or "no"`);
          process.exit(1);
        }
        const sideNum = side === "yes" ? 0 : 1;

        const amountFloat = parseFloat(opts.amount);
        if (isNaN(amountFloat) || amountFloat <= 0) {
          console.error(` ${c.failure} Invalid --amount value`);
          process.exit(1);
        }
        const amountMicro = ethers.parseUnits(String(amountFloat), 6);
        const roundIdNum = BigInt(roundId);

        const config = loadConfig();
        const { signer, address } = await requireSigner(config);
        const provider = signer.provider!;

        // Pre-flight: check USDC balance
        const usdc = new ethers.Contract(USDC_ADDR, USDC_ABI, signer);
        const balance = await (usdc["balanceOf"] as (a: string) => Promise<bigint>)(address);
        if (balance < amountMicro) {
          console.error(` ${c.failure} Insufficient USDC balance. Have ${formatUsdc(balance)}, need ${formatUsdc(amountMicro)}`);
          process.exit(1);
        }

        const pool = new ethers.Contract(ARENA_ADDRESSES["arena.arenaPool"], ARENA_POOL_ABI, signer);

        // Check allowance and approve if needed
        const allowance = await (usdc["allowance"] as (o: string, s: string) => Promise<bigint>)(address, ARENA_ADDRESSES["arena.arenaPool"]);
        if (allowance < amountMicro) {
          const spinner = startSpinner("Approving USDC…");
          try {
            const approveTx = await (usdc["approve"] as (s: string, a: bigint) => Promise<ethers.TransactionResponse>)(ARENA_ADDRESSES["arena.arenaPool"], amountMicro);
            await approveTx.wait();
            spinner.succeed("USDC approved");
          } catch (txErr) {
            spinner.fail("Approval failed");
            const msg = txErr instanceof Error ? txErr.message : String(txErr);
            console.error(` ${c.failure} Transaction reverted: ${msg}`);
            process.exit(2);
          }
        }

        const spinner = startSpinner(`Entering round ${roundId} on ${side.toUpperCase()}…`);
        try {
          const tx = await (pool["enterRound"] as (id: bigint, s: number, a: bigint, n: string) => Promise<ethers.TransactionResponse>)(
            roundIdNum, sideNum, amountMicro, opts.note ?? ""
          );
          spinner.update("Waiting for confirmation…");
          const receipt = await tx.wait();
          spinner.succeed(`Entered round — tx ${receipt?.hash ?? tx.hash}`);
          console.log();
          console.log(`  ${chalk.bold("Round")}   #${roundId}`);
          console.log(`  ${chalk.bold("Side")}    ${side.toUpperCase()}`);
          console.log(`  ${chalk.bold("Amount")}  ${formatUsdc(amountMicro)}`);
          if (opts.note) console.log(`  ${chalk.bold("Note")}    ${opts.note}`);
        } catch (txErr) {
          spinner.fail("Transaction failed");
          const msg = txErr instanceof Error ? txErr.message : String(txErr);
          console.error(` ${c.failure} Transaction reverted: ${msg}`);
          process.exit(2);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} ${msg}`);
        process.exit(1);
      }
    });

  // 11. arena standings
  arena
    .command("standings")
    .description("View Arena leaderboard standings")
    .option("--category <cat>", "Filter by category")
    .option("--limit <n>", "Max results", "20")
    .option("--json", "Output as JSON")
    .action(async (opts: { category?: string; limit?: string; json?: boolean }) => {
      try {
        const limit = parseInt(opts.limit ?? "20", 10);
        const catFilter = opts.category ? `where: { category: "${opts.category}" }` : "";

        const data = await gql(`{
          agentStandings(${catFilter} first: ${limit}, orderBy: wins, orderDirection: desc) {
            id agent wins losses netUsdc
          }
        }`);

        const standings = (data["agentStandings"] as unknown[]) ?? [];

        if (opts.json) {
          console.log(JSON.stringify(standings, null, 2));
          return;
        }

        console.log();
        console.log(chalk.bold("  Arena Standings"));
        console.log();

        if (standings.length === 0) {
          console.log(chalk.dim("  No standings data."));
        } else {
          let rank = 1;
          for (const s of standings) {
            const st = s as Record<string, unknown>;
            const net = BigInt(String(st["netUsdc"] ?? "0"));
            const netStr = net >= 0n ? chalk.green("+" + formatUsdc(net)) : chalk.red("-" + formatUsdc(-net));
            console.log(`  ${String(rank++).padStart(3)}.  ${truncateAddr(String(st["agent"]))}  ${chalk.green(String(st["wins"]))}W / ${chalk.red(String(st["losses"]))}L  ${netStr}`);
          }
        }
        console.log();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} Subgraph unavailable: ${msg}`);
        process.exit(2);
      }
    });

  // 12. arena history [address]
  arena
    .command("history [address]")
    .description("View Arena entry history for an address")
    .option("--json", "Output as JSON")
    .action(async (address?: string, opts?: { json?: boolean }) => {
      try {
        const config = loadConfig();
        let target = address;
        if (!target) {
          const { address: selfAddr } = await requireSigner(config);
          target = selfAddr;
        }
        const addr = target.toLowerCase();

        const data = await gql(`{
          arenaEntries(where: { agent: "${addr}" }, first: 100, orderBy: timestamp, orderDirection: desc) {
            id round { id question resolved outcome } side amount note timestamp
          }
        }`);

        const entries = (data["arenaEntries"] as unknown[]) ?? [];

        if (opts?.json) {
          console.log(JSON.stringify(entries, null, 2));
          return;
        }

        console.log();
        console.log(chalk.bold(`  Arena History — ${truncateAddr(target)}`));
        console.log();

        if (entries.length === 0) {
          console.log(chalk.dim("  No entries found."));
        } else {
          for (const e of entries) {
            const entry = e as Record<string, unknown>;
            const round = entry["round"] as Record<string, unknown>;
            const side = Number(entry["side"]);
            const amount = BigInt(String(entry["amount"] ?? "0"));
            const resolved = round?.["resolved"] as boolean;
            let resultTag = chalk.yellow("pending");
            if (resolved) {
              const outcome = round["outcome"] as boolean;
              const won = (side === 0 && outcome) || (side === 1 && !outcome);
              resultTag = won ? chalk.green("WON") : chalk.red("LOST");
            }
            console.log(`  Round #${round?.["id"]}  ${sideLabel(side)}  ${formatUsdc(amount)}  ${resultTag}  ${chalk.dim(formatElapsed(Number(entry["timestamp"])))}`);
            if (entry["note"]) console.log(`    ${chalk.dim(String(entry["note"]))}`);
          }
        }
        console.log();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} Subgraph unavailable: ${msg}`);
        process.exit(2);
      }
    });

  // 13. arena result <round-id>
  arena
    .command("result <round-id>")
    .description("Show the result and all entries for a round")
    .option("--json", "Output as JSON")
    .action(async (roundId: string, opts: { json?: boolean }) => {
      try {
        const data = await gql(`{
          arenaRound(id: "${roundId}") {
            id question category yesPot noPot resolved outcome evidenceHash
            stakingClosesAt resolvesAt createdAt creator
          }
          arenaEntries(where: { round: "${roundId}" }, first: 100) {
            agent side amount note timestamp
          }
        }`);

        const round = data["arenaRound"] as Record<string, unknown> | null;
        const entries = (data["arenaEntries"] as unknown[]) ?? [];

        if (opts.json) {
          console.log(JSON.stringify({ round, entries }, null, 2));
          return;
        }

        if (!round) {
          console.error(` ${c.failure} Round ${roundId} not found in subgraph`);
          process.exit(1);
        }

        const resolved = round["resolved"] as boolean;
        const outcome  = round["outcome"] as boolean;
        const yesPot = BigInt(String(round["yesPot"] ?? "0"));
        const noPot  = BigInt(String(round["noPot"] ?? "0"));

        console.log();
        console.log(chalk.bold(`  Round #${roundId} — ${String(round["question"])}`));
        console.log();
        console.log(`  Category  ${round["category"]}`);
        console.log(`  Status    ${resolved ? (outcome ? chalk.green("RESOLVED YES") : chalk.red("RESOLVED NO")) : chalk.yellow("Open")}`);
        console.log(`  YES Pot   ${formatUsdc(yesPot)}`);
        console.log(`  NO Pot    ${formatUsdc(noPot)}`);
        if (resolved && round["evidenceHash"]) {
          console.log(`  Evidence  ${round["evidenceHash"]}`);
        }
        console.log();
        console.log(chalk.bold(`  Entries (${entries.length})`));
        for (const e of entries) {
          const entry = e as Record<string, unknown>;
          const side = Number(entry["side"]);
          const amount = BigInt(String(entry["amount"] ?? "0"));
          const sideStr = side === 0 ? chalk.green("YES") : chalk.red("NO");
          console.log(`    ${sideStr}  ${truncateAddr(String(entry["agent"]))}  ${formatUsdc(amount)}  ${chalk.dim(formatElapsed(Number(entry["timestamp"])))}`);
          if (entry["note"]) console.log(`         ${chalk.dim(String(entry["note"]))}`);
        }
        console.log();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} Subgraph unavailable: ${msg}`);
        process.exit(2);
      }
    });

  // 14. arena claim <round-id>
  arena
    .command("claim <round-id>")
    .description("Claim winnings from a resolved round")
    .action(async (roundId: string) => {
      try {
        const config = loadConfig();
        const { signer, address } = await requireSigner(config);

        // Pre-flight: check subgraph
        const data = await gql(`{
          arenaRound(id: "${roundId}") {
            resolved outcome
          }
          arenaEntries(where: { round: "${roundId}", agent: "${address.toLowerCase()}" }, first: 1) {
            side amount
          }
        }`);

        const round = data["arenaRound"] as Record<string, unknown> | null;
        if (!round) {
          console.error(` ${c.failure} Round ${roundId} not found`);
          process.exit(1);
        }
        if (!round["resolved"]) {
          console.error(` ${c.failure} Round ${roundId} is not yet resolved`);
          process.exit(1);
        }

        const myEntries = (data["arenaEntries"] as unknown[]) ?? [];
        if (myEntries.length === 0) {
          console.error(` ${c.failure} You have no entry in round ${roundId}`);
          process.exit(1);
        }

        const myEntry = myEntries[0] as Record<string, unknown>;
        const mySide = Number(myEntry["side"]);
        const outcome = round["outcome"] as boolean;
        const won = (mySide === 0 && outcome) || (mySide === 1 && !outcome);
        if (!won) {
          console.error(` ${c.failure} You did not win round ${roundId} (you picked ${sideLabel(mySide)})`);
          process.exit(1);
        }

        const pool = new ethers.Contract(ARENA_ADDRESSES["arena.arenaPool"], ARENA_POOL_ABI, signer);

        // Check already claimed (on-chain)
        try {
          const claimed = await (pool["hasClaimed"] as (id: bigint, a: string) => Promise<boolean>)(BigInt(roundId), address);
          if (claimed) {
            console.error(` ${c.failure} You have already claimed round ${roundId}`);
            process.exit(1);
          }
        } catch { /* non-fatal, proceed */ }

        const spinner = startSpinner(`Claiming round ${roundId}…`);
        try {
          const tx = await (pool["claim"] as (id: bigint) => Promise<ethers.TransactionResponse>)(BigInt(roundId));
          spinner.update("Waiting for confirmation…");
          const receipt = await tx.wait();
          spinner.succeed(`Claimed — tx ${receipt?.hash ?? tx.hash}`);
        } catch (txErr) {
          spinner.fail("Transaction failed");
          const msg = txErr instanceof Error ? txErr.message : String(txErr);
          console.error(` ${c.failure} Transaction reverted: ${msg}`);
          process.exit(2);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} ${msg}`);
        process.exit(1);
      }
    });

  // ══════════════════════════════════════════════════════════════════════════
  // WATCHTOWER
  // ══════════════════════════════════════════════════════════════════════════

  const wtCmd = arena.command("watchtower").description("Arena watchtower commands");

  // 15. arena watchtower collect <round-id>
  wtCmd
    .command("collect <round-id>")
    .description("Collect evidence for a round and save signed stub")
    .option("--source <name>", "Evidence source names (repeatable)", (v: string, a: string[]) => [...a, v], [] as string[])
    .action(async (roundId: string, opts: { source?: string[] }) => {
      try {
        const config = loadConfig();
        const { signer, address } = await requireSigner(config);
        const provider = signer.provider!;

        const pool = new ethers.Contract(ARENA_ADDRESSES["arena.arenaPool"], ARENA_POOL_ABI, provider);

        const spinner = startSpinner(`Fetching round ${roundId} from chain…`);
        let roundData: { question: string; category: string; yesPot: bigint; noPot: bigint; stakingClosesAt: bigint; resolvesAt: bigint; resolved: boolean; outcome: boolean; evidenceHash: string; creator: string };
        try {
          const raw = await (pool["getRound"] as (id: bigint) => Promise<[string, string, bigint, bigint, bigint, bigint, boolean, boolean, string, string]>)(BigInt(roundId));
          roundData = {
            question:        raw[0],
            category:        raw[1],
            yesPot:          raw[2],
            noPot:           raw[3],
            stakingClosesAt: raw[4],
            resolvesAt:      raw[5],
            resolved:        raw[6],
            outcome:         raw[7],
            evidenceHash:    raw[8],
            creator:         raw[9],
          };
          spinner.succeed("Round data fetched");
        } catch (rpcErr) {
          spinner.fail("RPC read failed");
          const msg = rpcErr instanceof Error ? rpcErr.message : String(rpcErr);
          console.error(` ${c.failure} ${msg}`);
          process.exit(2);
        }

        const evidence = {
          roundId,
          question:        roundData.question,
          category:        roundData.category,
          yesPot:          roundData.yesPot.toString(),
          noPot:           roundData.noPot.toString(),
          stakingClosesAt: roundData.stakingClosesAt.toString(),
          resolvesAt:      roundData.resolvesAt.toString(),
          resolved:        roundData.resolved,
          sources:         opts.source ?? [],
          collectedAt:     Math.floor(Date.now() / 1000),
          collectedBy:     address,
        };

        const evidenceJson = JSON.stringify(evidence, null, 2);
        const evidenceHash = computeContentHash(evidenceJson);

        // EIP-191 sign the evidence hash
        const signature = await signer.signMessage(ethers.getBytes(evidenceHash));

        const payload = {
          ...evidence,
          evidenceHash,
          signature,
        };

        fs.mkdirSync(WATCHTOWER_DIR, { recursive: true });
        const filename = `${roundId}-${evidenceHash.slice(2, 10)}.json`;
        const filepath = path.join(WATCHTOWER_DIR, filename);
        fs.writeFileSync(filepath, JSON.stringify(payload, null, 2), "utf-8");

        console.log();
        console.log(` ${c.success} Evidence saved: ${filepath}`);
        console.log(`  ${chalk.bold("Round")}     #${roundId}`);
        console.log(`  ${chalk.bold("Question")} ${roundData.question.slice(0, 60)}`);
        console.log(`  ${chalk.bold("Hash")}      ${evidenceHash}`);
        console.log(`  ${chalk.bold("Signed by")} ${address}`);
        if ((opts.source ?? []).length === 0) {
          console.log(chalk.dim("  Hint: use --source <name> to record evidence sources"));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} ${msg}`);
        process.exit(1);
      }
    });

  // 16. arena watchtower evidence <round-id>
  wtCmd
    .command("evidence <round-id>")
    .description("Show stored evidence for a round")
    .option("--json", "Output as JSON")
    .action(async (roundId: string, opts: { json?: boolean }) => {
      try {
        if (!fs.existsSync(WATCHTOWER_DIR)) {
          console.error(` ${c.failure} Evidence directory not found: ${WATCHTOWER_DIR}`);
          process.exit(1);
        }

        const files = fs.readdirSync(WATCHTOWER_DIR)
          .filter(f => f.startsWith(`${roundId}-`) && f.endsWith(".json"));

        if (files.length === 0) {
          console.error(` ${c.failure} No evidence found for round ${roundId}`);
          process.exit(1);
        }

        const filepath = path.join(WATCHTOWER_DIR, files[0]);
        const raw = fs.readFileSync(filepath, "utf-8");
        const payload = JSON.parse(raw) as Record<string, unknown>;

        if (opts.json) {
          console.log(raw);
          return;
        }

        console.log();
        console.log(chalk.bold(`  Evidence — Round #${roundId}`));
        console.log(`  File       ${filepath}`);
        console.log(`  Question   ${payload["question"]}`);
        console.log(`  Category   ${payload["category"]}`);
        console.log(`  Hash       ${payload["evidenceHash"]}`);
        console.log(`  Signed by  ${payload["collectedBy"]}`);
        const collected = Number(payload["collectedAt"]);
        console.log(`  Collected  ${new Date(collected * 1000).toISOString()}  (${formatElapsed(collected)})`);
        const sources = payload["sources"] as string[];
        if (sources?.length) console.log(`  Sources    ${sources.join(", ")}`);
        console.log(`  Resolved   ${payload["resolved"] ? "yes" : "no"}`);
        console.log();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} ${msg}`);
        process.exit(1);
      }
    });

  // 17. arena watchtower resolve <round-id>
  wtCmd
    .command("resolve <round-id>")
    .description("Submit on-chain resolution with stored evidence")
    .requiredOption("--outcome <yes|no>", "Resolution outcome: yes or no")
    .action(async (roundId: string, opts: { outcome: string }) => {
      try {
        const outcome = opts.outcome.toLowerCase();
        if (outcome !== "yes" && outcome !== "no") {
          console.error(` ${c.failure} --outcome must be "yes" or "no"`);
          process.exit(1);
        }
        const outcomeBoolean = outcome === "yes";

        // Read evidence file
        if (!fs.existsSync(WATCHTOWER_DIR)) {
          console.error(` ${c.failure} Evidence directory not found. Run 'arena watchtower collect' first.`);
          process.exit(1);
        }

        const files = fs.readdirSync(WATCHTOWER_DIR)
          .filter(f => f.startsWith(`${roundId}-`) && f.endsWith(".json"));

        if (files.length === 0) {
          console.error(` ${c.failure} No evidence found for round ${roundId}. Run 'arena watchtower collect' first.`);
          process.exit(1);
        }

        const filepath = path.join(WATCHTOWER_DIR, files[0]);
        const payload = JSON.parse(fs.readFileSync(filepath, "utf-8")) as Record<string, unknown>;
        const evidenceHash = payload["evidenceHash"] as string;

        if (!evidenceHash || !evidenceHash.startsWith("0x")) {
          console.error(` ${c.failure} Invalid evidence hash in file`);
          process.exit(1);
        }

        const config = loadConfig();
        const { signer } = await requireSigner(config);
        const pool = new ethers.Contract(ARENA_ADDRESSES["arena.arenaPool"], ARENA_POOL_ABI, signer);

        const spinner = startSpinner(`Submitting resolution for round ${roundId} — ${outcome.toUpperCase()}…`);
        try {
          const tx = await (pool["submitResolution"] as (id: bigint, o: boolean, h: string) => Promise<ethers.TransactionResponse>)(
            BigInt(roundId), outcomeBoolean, evidenceHash as `0x${string}`
          );
          spinner.update("Waiting for confirmation…");
          const receipt = await tx.wait();
          spinner.succeed(`Resolution submitted — tx ${receipt?.hash ?? tx.hash}`);
          console.log();
          console.log(`  ${chalk.bold("Round")}    #${roundId}`);
          console.log(`  ${chalk.bold("Outcome")}  ${outcomeBoolean ? chalk.green("YES") : chalk.red("NO")}`);
          console.log(`  ${chalk.bold("Evidence")} ${evidenceHash}`);
        } catch (txErr) {
          spinner.fail("Transaction failed");
          const msg = txErr instanceof Error ? txErr.message : String(txErr);
          console.error(` ${c.failure} Transaction reverted: ${msg}`);
          process.exit(2);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} ${msg}`);
        process.exit(1);
      }
    });

  // 18. arena watchtower verify <round-id>
  wtCmd
    .command("verify <round-id>")
    .description("Check on-chain attestation status for a round")
    .requiredOption("--watchtower <address>", "Watchtower address to check")
    .action(async (roundId: string, opts: { watchtower: string }) => {
      try {
        const config = loadConfig();
        const provider = new ethers.JsonRpcProvider(config.rpcUrl);
        const pool = new ethers.Contract(ARENA_ADDRESSES["arena.arenaPool"], ARENA_POOL_ABI, provider);

        const spinner = startSpinner("Checking attestation…");
        try {
          const attested      = await (pool["hasAttested"] as (id: bigint, w: string) => Promise<boolean>)(BigInt(roundId), opts.watchtower);
          const yesCount      = await (pool["getAttestationCount"] as (id: bigint, o: boolean) => Promise<bigint>)(BigInt(roundId), true);
          const noCount       = await (pool["getAttestationCount"] as (id: bigint, o: boolean) => Promise<bigint>)(BigInt(roundId), false);
          spinner.succeed("Attestation data fetched");

          console.log();
          console.log(chalk.bold(`  Watchtower Attestation — Round #${roundId}`));
          console.log(`  Watchtower  ${opts.watchtower}`);
          console.log(`  Attested    ${attested ? chalk.green("yes") : chalk.red("no")}`);
          console.log(`  YES votes   ${yesCount.toString()}`);
          console.log(`  NO votes    ${noCount.toString()}`);
          console.log();
        } catch (rpcErr) {
          spinner.fail("RPC read failed");
          const msg = rpcErr instanceof Error ? rpcErr.message : String(rpcErr);
          console.error(` ${c.failure} ${msg}`);
          process.exit(2);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} ${msg}`);
        process.exit(1);
      }
    });

  // ══════════════════════════════════════════════════════════════════════════
  // RESEARCH SQUADS
  // ══════════════════════════════════════════════════════════════════════════

  const squadCmd = arena.command("squad").description("Research squad management");

  // 19. arena squad list
  squadCmd
    .command("list")
    .description("List research squads")
    .option("--domain <domain>", "Filter by domain tag")
    .option("--json", "Output as JSON")
    .action(async (opts: { domain?: string; json?: boolean }) => {
      try {
        const domainFilter = opts.domain ? `where: { domainTag: "${opts.domain}" }` : "";

        const data = await gql(`{
          researchSquads(${domainFilter} first: 50, orderBy: createdAt, orderDirection: desc) {
            id name domainTag creator status inviteOnly memberCount createdAt
          }
        }`);

        const squads = (data["researchSquads"] as unknown[]) ?? [];

        if (opts.json) {
          console.log(JSON.stringify(squads, null, 2));
          return;
        }

        console.log();
        console.log(chalk.bold("  Research Squads"));
        console.log();

        if (squads.length === 0) {
          console.log(chalk.dim("  No squads found."));
        } else {
          for (const s of squads) {
            const sq = s as Record<string, unknown>;
            const sid = formatSquadId(BigInt(String(sq["id"])));
            const statusStr = squadStatusLabel(Number(sq["status"]));
            const invite = sq["inviteOnly"] ? chalk.dim(" [invite-only]") : "";
            console.log(`  ${chalk.bold(sid)}  ${chalk.bold(String(sq["name"]))}  [${statusStr}]${invite}`);
            console.log(`    domain:${sq["domainTag"]}  members:${sq["memberCount"]}  creator:${truncateAddr(String(sq["creator"]))}  ${chalk.dim(formatElapsed(Number(sq["createdAt"])))}`);
            console.log();
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} Subgraph unavailable: ${msg}`);
        process.exit(2);
      }
    });

  // 20. arena squad create
  squadCmd
    .command("create <name>")
    .description("Create a new research squad")
    .requiredOption("--domain <domain>", "Domain tag for the squad")
    .option("--invite-only", "Restrict membership to invites", false)
    .action(async (name: string, opts: { domain: string; inviteOnly?: boolean }) => {
      try {
        const config = loadConfig();
        const { signer } = await requireSigner(config);

        const contract = new ethers.Contract(ARENA_ADDRESSES["arena.researchSquad"], RESEARCH_SQUAD_ABI, signer);
        const spinner = startSpinner(`Creating squad "${name}"…`);

        try {
          const tx = await (contract["createSquad"] as (n: string, d: string, i: boolean) => Promise<ethers.TransactionResponse>)(
            name, opts.domain, opts.inviteOnly ?? false
          );
          spinner.update("Waiting for confirmation…");
          const receipt = await tx.wait();
          spinner.succeed(`Squad created — tx ${receipt?.hash ?? tx.hash}`);
          console.log();
          console.log(`  ${chalk.bold("Name")}    ${name}`);
          console.log(`  ${chalk.bold("Domain")}  ${opts.domain}`);
          console.log(`  ${chalk.bold("Invite")}  ${opts.inviteOnly ? "yes" : "no"}`);
        } catch (txErr) {
          spinner.fail("Transaction failed");
          const msg = txErr instanceof Error ? txErr.message : String(txErr);
          console.error(` ${c.failure} Transaction reverted: ${msg}`);
          process.exit(2);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} ${msg}`);
        process.exit(1);
      }
    });

  // 21. arena squad join
  squadCmd
    .command("join <squad-id>")
    .description("Join a research squad")
    .action(async (squadIdStr: string) => {
      try {
        let squadId: bigint;
        try {
          squadId = parseSquadId(squadIdStr);
        } catch {
          console.error(` ${c.failure} Invalid squad ID: ${squadIdStr}`);
          process.exit(1);
        }

        const config = loadConfig();
        const { signer } = await requireSigner(config);

        const contract = new ethers.Contract(ARENA_ADDRESSES["arena.researchSquad"], RESEARCH_SQUAD_ABI, signer);
        const spinner = startSpinner(`Joining squad ${formatSquadId(squadId)}…`);

        try {
          const tx = await (contract["joinSquad"] as (id: bigint) => Promise<ethers.TransactionResponse>)(squadId);
          spinner.update("Waiting for confirmation…");
          const receipt = await tx.wait();
          spinner.succeed(`Joined squad ${formatSquadId(squadId)} — tx ${receipt?.hash ?? tx.hash}`);
        } catch (txErr) {
          spinner.fail("Transaction failed");
          const msg = txErr instanceof Error ? txErr.message : String(txErr);
          console.error(` ${c.failure} Transaction reverted: ${msg}`);
          process.exit(2);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} ${msg}`);
        process.exit(1);
      }
    });

  // 22. arena squad contribute
  squadCmd
    .command("contribute <squad-id>")
    .description("Record a contribution to a squad")
    .requiredOption("--hash <bytes32>", "Contribution content hash (bytes32)")
    .requiredOption("--description <text>", "Contribution description")
    .action(async (squadIdStr: string, opts: { hash: string; description: string }) => {
      try {
        let squadId: bigint;
        try {
          squadId = parseSquadId(squadIdStr);
        } catch {
          console.error(` ${c.failure} Invalid squad ID: ${squadIdStr}`);
          process.exit(1);
        }

        if (!opts.hash.startsWith("0x") || opts.hash.length !== 66) {
          console.error(` ${c.failure} --hash must be a valid 32-byte hex string (0x + 64 hex chars)`);
          process.exit(1);
        }

        const config = loadConfig();
        const { signer } = await requireSigner(config);

        const contract = new ethers.Contract(ARENA_ADDRESSES["arena.researchSquad"], RESEARCH_SQUAD_ABI, signer);
        const spinner = startSpinner(`Recording contribution to ${formatSquadId(squadId)}…`);

        try {
          const tx = await (contract["recordContribution"] as (id: bigint, h: string, d: string) => Promise<ethers.TransactionResponse>)(
            squadId, opts.hash as `0x${string}`, opts.description
          );
          spinner.update("Waiting for confirmation…");
          const receipt = await tx.wait();
          spinner.succeed(`Contribution recorded — tx ${receipt?.hash ?? tx.hash}`);
          console.log();
          console.log(`  ${chalk.bold("Squad")}       ${formatSquadId(squadId)}`);
          console.log(`  ${chalk.bold("Hash")}        ${opts.hash}`);
          console.log(`  ${chalk.bold("Description")} ${opts.description}`);
        } catch (txErr) {
          spinner.fail("Transaction failed");
          const msg = txErr instanceof Error ? txErr.message : String(txErr);
          console.error(` ${c.failure} Transaction reverted: ${msg}`);
          process.exit(2);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} ${msg}`);
        process.exit(1);
      }
    });

  // 23. arena squad conclude
  squadCmd
    .command("conclude <squad-id>")
    .description("Conclude (close) a research squad")
    .action(async (squadIdStr: string) => {
      try {
        let squadId: bigint;
        try {
          squadId = parseSquadId(squadIdStr);
        } catch {
          console.error(` ${c.failure} Invalid squad ID: ${squadIdStr}`);
          process.exit(1);
        }

        const config = loadConfig();
        const { signer } = await requireSigner(config);

        const contract = new ethers.Contract(ARENA_ADDRESSES["arena.researchSquad"], RESEARCH_SQUAD_ABI, signer);
        const spinner = startSpinner(`Concluding squad ${formatSquadId(squadId)}…`);

        try {
          const tx = await (contract["concludeSquad"] as (id: bigint) => Promise<ethers.TransactionResponse>)(squadId);
          spinner.update("Waiting for confirmation…");
          const receipt = await tx.wait();
          spinner.succeed(`Squad concluded — tx ${receipt?.hash ?? tx.hash}`);
        } catch (txErr) {
          spinner.fail("Transaction failed");
          const msg = txErr instanceof Error ? txErr.message : String(txErr);
          console.error(` ${c.failure} Transaction reverted: ${msg}`);
          process.exit(2);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} ${msg}`);
        process.exit(1);
      }
    });

  // 24. arena squad info
  squadCmd
    .command("info <squad-id>")
    .description("Show squad details, members, and briefings")
    .option("--json", "Output as JSON")
    .action(async (squadIdStr: string, opts: { json?: boolean }) => {
      try {
        let squadId: bigint;
        try {
          squadId = parseSquadId(squadIdStr);
        } catch {
          console.error(` ${c.failure} Invalid squad ID: ${squadIdStr}`);
          process.exit(1);
        }

        const sid = squadId.toString();
        const data = await gql(`{
          researchSquad(id: "${sid}") {
            id name domainTag creator status inviteOnly memberCount createdAt
            members { id agent role }
          }
          squadBriefings(where: { squad: "${sid}" }, first: 20, orderBy: publishedAt, orderDirection: desc) {
            id preview endpoint tags publishedAt
          }
        }`);

        const squad = data["researchSquad"] as Record<string, unknown> | null;
        const briefings = (data["squadBriefings"] as unknown[]) ?? [];

        if (opts.json) {
          console.log(JSON.stringify({ squad, briefings }, null, 2));
          return;
        }

        if (!squad) {
          console.error(` ${c.failure} Squad ${squadIdStr} not found`);
          process.exit(1);
        }

        const members = (squad["members"] as unknown[]) ?? [];

        console.log();
        console.log(chalk.bold(`  Squad — ${squad["name"]}`));
        console.log(`  ID       ${formatSquadId(BigInt(sid))}`);
        console.log(`  Domain   ${squad["domainTag"]}`);
        console.log(`  Status   ${squadStatusLabel(Number(squad["status"]))}`);
        console.log(`  Creator  ${truncateAddr(String(squad["creator"]))}`);
        console.log(`  Members  ${squad["memberCount"]}`);
        console.log(`  Invite   ${squad["inviteOnly"] ? "yes" : "no"}`);
        console.log(`  Created  ${formatElapsed(Number(squad["createdAt"]))}`);

        if (members.length > 0) {
          console.log();
          console.log(chalk.bold("  Members"));
          for (const m of members) {
            const member = m as Record<string, unknown>;
            console.log(`    ${truncateAddr(String(member["agent"]))}  role:${member["role"]}`);
          }
        }

        if (briefings.length > 0) {
          console.log();
          console.log(chalk.bold("  Briefings"));
          for (const b of briefings) {
            const br = b as Record<string, unknown>;
            const tags = (br["tags"] as string[])?.join(", ") ?? "";
            console.log(`    ${chalk.dim(formatElapsed(Number(br["publishedAt"])))}  ${String(br["preview"]).slice(0, 50)}  ${chalk.dim(tags)}`);
          }
        }
        console.log();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} Subgraph unavailable: ${msg}`);
        process.exit(2);
      }
    });

  // ══════════════════════════════════════════════════════════════════════════
  // SQUAD BRIEFINGS
  // ══════════════════════════════════════════════════════════════════════════

  const briefingCmd = arena.command("briefing").description("Squad briefing management");

  // 25. arena briefing publish
  briefingCmd
    .command("publish <squad-id>")
    .description("Publish a briefing to a squad (creator/admin)")
    .requiredOption("--file <path>", "Path to briefing file")
    .requiredOption("--preview <text>", "Short preview text")
    .requiredOption("--endpoint <url>", "Briefing endpoint URL")
    .option("--tags <tags>", "Comma-separated tags", "")
    .action(async (squadIdStr: string, opts: { file: string; preview: string; endpoint: string; tags?: string }) => {
      try {
        let squadId: bigint;
        try {
          squadId = parseSquadId(squadIdStr);
        } catch {
          console.error(` ${c.failure} Invalid squad ID: ${squadIdStr}`);
          process.exit(1);
        }

        if (!fs.existsSync(opts.file)) {
          console.error(` ${c.failure} File not found: ${opts.file}`);
          process.exit(1);
        }

        const content = fs.readFileSync(opts.file, "utf-8");
        const contentHash = computeContentHash(content);
        const tags = (opts.tags ?? "").split(",").map(t => t.trim()).filter(Boolean);

        const config = loadConfig();
        const { signer } = await requireSigner(config);

        const contract = new ethers.Contract(ARENA_ADDRESSES["arena.squadBriefing"], SQUAD_BRIEFING_ABI, signer);
        const spinner = startSpinner(`Publishing briefing to squad ${formatSquadId(squadId)}…`);

        try {
          const tx = await (contract["publishBriefing"] as (id: bigint, h: string, p: string, e: string, t: string[]) => Promise<ethers.TransactionResponse>)(
            squadId, contentHash as `0x${string}`, opts.preview, opts.endpoint, tags
          );
          spinner.update("Waiting for confirmation…");
          const receipt = await tx.wait();
          spinner.succeed(`Briefing published — tx ${receipt?.hash ?? tx.hash}`);
          console.log();
          console.log(`  ${chalk.bold("Squad")}    ${formatSquadId(squadId)}`);
          console.log(`  ${chalk.bold("Hash")}     ${contentHash}`);
          console.log(`  ${chalk.bold("Preview")} ${opts.preview}`);
          console.log(`  ${chalk.bold("Endpoint")} ${opts.endpoint}`);
          if (tags.length) console.log(`  ${chalk.bold("Tags")}     ${tags.join(", ")}`);
        } catch (txErr) {
          spinner.fail("Transaction failed");
          const msg = txErr instanceof Error ? txErr.message : String(txErr);
          console.error(` ${c.failure} Transaction reverted: ${msg}`);
          process.exit(2);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} ${msg}`);
        process.exit(1);
      }
    });

  // 26. arena briefing propose
  briefingCmd
    .command("propose <squad-id>")
    .description("Propose a briefing for approval")
    .requiredOption("--file <path>", "Path to briefing file")
    .requiredOption("--preview <text>", "Short preview text")
    .requiredOption("--endpoint <url>", "Briefing endpoint URL")
    .option("--tags <tags>", "Comma-separated tags", "")
    .action(async (squadIdStr: string, opts: { file: string; preview: string; endpoint: string; tags?: string }) => {
      try {
        let squadId: bigint;
        try {
          squadId = parseSquadId(squadIdStr);
        } catch {
          console.error(` ${c.failure} Invalid squad ID: ${squadIdStr}`);
          process.exit(1);
        }

        if (!fs.existsSync(opts.file)) {
          console.error(` ${c.failure} File not found: ${opts.file}`);
          process.exit(1);
        }

        const content = fs.readFileSync(opts.file, "utf-8");
        const contentHash = computeContentHash(content);
        const tags = (opts.tags ?? "").split(",").map(t => t.trim()).filter(Boolean);

        const config = loadConfig();
        const { signer } = await requireSigner(config);

        const contract = new ethers.Contract(ARENA_ADDRESSES["arena.squadBriefing"], SQUAD_BRIEFING_ABI, signer);
        const spinner = startSpinner(`Proposing briefing to squad ${formatSquadId(squadId)}…`);

        try {
          const tx = await (contract["proposeBriefing"] as (id: bigint, h: string, p: string, e: string, t: string[]) => Promise<ethers.TransactionResponse>)(
            squadId, contentHash as `0x${string}`, opts.preview, opts.endpoint, tags
          );
          spinner.update("Waiting for confirmation…");
          const receipt = await tx.wait();
          spinner.succeed(`Briefing proposed — tx ${receipt?.hash ?? tx.hash}`);
          console.log();
          console.log(`  ${chalk.bold("Squad")}    ${formatSquadId(squadId)}`);
          console.log(`  ${chalk.bold("Hash")}     ${contentHash}`);
          console.log(`  ${chalk.bold("Preview")} ${opts.preview}`);
          console.log(chalk.dim("  Awaiting squad admin approval."));
        } catch (txErr) {
          spinner.fail("Transaction failed");
          const msg = txErr instanceof Error ? txErr.message : String(txErr);
          console.error(` ${c.failure} Transaction reverted: ${msg}`);
          process.exit(2);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} ${msg}`);
        process.exit(1);
      }
    });

  // 27. arena briefing approve
  briefingCmd
    .command("approve <content-hash>")
    .description("Approve a pending briefing proposal")
    .action(async (contentHash: string) => {
      try {
        if (!contentHash.startsWith("0x") || contentHash.length !== 66) {
          console.error(` ${c.failure} content-hash must be a 32-byte hex string (0x + 64 chars)`);
          process.exit(1);
        }

        const config = loadConfig();
        const { signer } = await requireSigner(config);

        const contract = new ethers.Contract(ARENA_ADDRESSES["arena.squadBriefing"], SQUAD_BRIEFING_ABI, signer);
        const spinner = startSpinner("Approving proposal…");

        try {
          const tx = await (contract["approveProposal"] as (h: string) => Promise<ethers.TransactionResponse>)(contentHash as `0x${string}`);
          spinner.update("Waiting for confirmation…");
          const receipt = await tx.wait();
          spinner.succeed(`Proposal approved — tx ${receipt?.hash ?? tx.hash}`);
        } catch (txErr) {
          spinner.fail("Transaction failed");
          const msg = txErr instanceof Error ? txErr.message : String(txErr);
          console.error(` ${c.failure} Transaction reverted: ${msg}`);
          process.exit(2);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} ${msg}`);
        process.exit(1);
      }
    });

  // 28. arena briefing reject
  briefingCmd
    .command("reject <content-hash>")
    .description("Reject a pending briefing proposal")
    .option("--reason <text>", "Rejection reason (informational)")
    .action(async (contentHash: string, opts: { reason?: string }) => {
      try {
        if (!contentHash.startsWith("0x") || contentHash.length !== 66) {
          console.error(` ${c.failure} content-hash must be a 32-byte hex string (0x + 64 chars)`);
          process.exit(1);
        }

        const config = loadConfig();
        const { signer } = await requireSigner(config);

        const contract = new ethers.Contract(ARENA_ADDRESSES["arena.squadBriefing"], SQUAD_BRIEFING_ABI, signer);
        const spinner = startSpinner("Rejecting proposal…");

        try {
          const tx = await (contract["rejectProposal"] as (h: string) => Promise<ethers.TransactionResponse>)(contentHash as `0x${string}`);
          spinner.update("Waiting for confirmation…");
          const receipt = await tx.wait();
          spinner.succeed(`Proposal rejected — tx ${receipt?.hash ?? tx.hash}`);
          if (opts.reason) console.log(chalk.dim(`  Reason: ${opts.reason}`));
        } catch (txErr) {
          spinner.fail("Transaction failed");
          const msg = txErr instanceof Error ? txErr.message : String(txErr);
          console.error(` ${c.failure} Transaction reverted: ${msg}`);
          process.exit(2);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} ${msg}`);
        process.exit(1);
      }
    });

  // 29. arena briefing list
  briefingCmd
    .command("list <squad-id>")
    .description("List published briefings for a squad")
    .option("--json", "Output as JSON")
    .action(async (squadIdStr: string, opts: { json?: boolean }) => {
      try {
        let squadId: bigint;
        try {
          squadId = parseSquadId(squadIdStr);
        } catch {
          console.error(` ${c.failure} Invalid squad ID: ${squadIdStr}`);
          process.exit(1);
        }

        const data = await gql(`{
          squadBriefings(where: { squad: "${squadId.toString()}", status: "published" }, first: 50, orderBy: publishedAt, orderDirection: desc) {
            id contentHash preview endpoint tags publishedAt author
          }
        }`);

        const briefings = (data["squadBriefings"] as unknown[]) ?? [];

        if (opts.json) {
          console.log(JSON.stringify(briefings, null, 2));
          return;
        }

        console.log();
        console.log(chalk.bold(`  Briefings — ${formatSquadId(squadId)}`));
        console.log();

        if (briefings.length === 0) {
          console.log(chalk.dim("  No published briefings."));
        } else {
          for (const b of briefings) {
            const br = b as Record<string, unknown>;
            const tags = (br["tags"] as string[])?.join(", ") ?? "";
            console.log(`  📋  ${chalk.bold(String(br["preview"]).slice(0, 60))}`);
            console.log(`       ${chalk.dim(formatElapsed(Number(br["publishedAt"])))}  ${truncateAddr(String(br["author"] ?? ""))}  ${chalk.dim(tags)}`);
            console.log(`       ${chalk.dim(String(br["endpoint"]))}`);
            console.log();
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} Subgraph unavailable: ${msg}`);
        process.exit(2);
      }
    });

  // 30. arena briefing proposals
  briefingCmd
    .command("proposals <squad-id>")
    .description("List pending briefing proposals for a squad")
    .option("--json", "Output as JSON")
    .action(async (squadIdStr: string, opts: { json?: boolean }) => {
      try {
        let squadId: bigint;
        try {
          squadId = parseSquadId(squadIdStr);
        } catch {
          console.error(` ${c.failure} Invalid squad ID: ${squadIdStr}`);
          process.exit(1);
        }

        const data = await gql(`{
          squadBriefings(where: { squad: "${squadId.toString()}", status: "pending" }, first: 50, orderBy: proposedAt, orderDirection: desc) {
            id contentHash preview endpoint tags proposedAt author
          }
        }`);

        const proposals = (data["squadBriefings"] as unknown[]) ?? [];

        if (opts.json) {
          console.log(JSON.stringify(proposals, null, 2));
          return;
        }

        console.log();
        console.log(chalk.bold(`  Pending Proposals — ${formatSquadId(squadId)}`));
        console.log();

        if (proposals.length === 0) {
          console.log(chalk.dim("  No pending proposals."));
        } else {
          for (const p of proposals) {
            const pr = p as Record<string, unknown>;
            console.log(`  ${chalk.yellow("●")}  ${String(pr["preview"]).slice(0, 60)}`);
            console.log(`       hash:${String(pr["contentHash"]).slice(0, 18)}…  by:${truncateAddr(String(pr["author"] ?? ""))}  ${chalk.dim(formatElapsed(Number(pr["proposedAt"])))}`);
            console.log(`       Approve: arena briefing approve ${pr["contentHash"]}`);
            console.log(`       Reject:  arena briefing reject ${pr["contentHash"]}`);
            console.log();
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} Subgraph unavailable: ${msg}`);
        process.exit(2);
      }
    });

  // ══════════════════════════════════════════════════════════════════════════
  // NEWSLETTERS
  // ══════════════════════════════════════════════════════════════════════════

  const newsletterCmd = arena.command("newsletter").description("Agent newsletter management");

  // 31. arena newsletter create
  newsletterCmd
    .command("create <name>")
    .description("Create a new newsletter")
    .requiredOption("--description <text>", "Newsletter description")
    .requiredOption("--endpoint <url>", "Newsletter endpoint URL")
    .action(async (name: string, opts: { description: string; endpoint: string }) => {
      try {
        const config = loadConfig();
        const { signer } = await requireSigner(config);

        const contract = new ethers.Contract(ARENA_ADDRESSES["arena.agentNewsletter"], AGENT_NEWSLETTER_ABI, signer);
        const spinner = startSpinner(`Creating newsletter "${name}"…`);

        try {
          const tx = await (contract["createNewsletter"] as (n: string, d: string, e: string) => Promise<ethers.TransactionResponse>)(
            name, opts.description, opts.endpoint
          );
          spinner.update("Waiting for confirmation…");
          const receipt = await tx.wait();
          spinner.succeed(`Newsletter created — tx ${receipt?.hash ?? tx.hash}`);
          console.log();
          console.log(`  ${chalk.bold("Name")}        ${name}`);
          console.log(`  ${chalk.bold("Description")} ${opts.description}`);
          console.log(`  ${chalk.bold("Endpoint")}    ${opts.endpoint}`);
        } catch (txErr) {
          spinner.fail("Transaction failed");
          const msg = txErr instanceof Error ? txErr.message : String(txErr);
          console.error(` ${c.failure} Transaction reverted: ${msg}`);
          process.exit(2);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} ${msg}`);
        process.exit(1);
      }
    });

  // 32. arena newsletter publish
  newsletterCmd
    .command("publish <newsletter-id>")
    .description("Publish a newsletter issue")
    .requiredOption("--file <path>", "Path to issue file")
    .requiredOption("--preview <text>", "Short preview text")
    .option("--endpoint <url>", "Issue endpoint URL (defaults to newsletter endpoint)")
    .action(async (newsletterIdStr: string, opts: { file: string; preview: string; endpoint?: string }) => {
      try {
        let newsletterId: bigint;
        try {
          newsletterId = parseNewsletterId(newsletterIdStr);
        } catch {
          console.error(` ${c.failure} Invalid newsletter ID: ${newsletterIdStr}`);
          process.exit(1);
        }

        if (!fs.existsSync(opts.file)) {
          console.error(` ${c.failure} File not found: ${opts.file}`);
          process.exit(1);
        }

        const content = fs.readFileSync(opts.file, "utf-8");
        const contentHash = computeContentHash(content);
        const endpoint = opts.endpoint ?? "";

        const config = loadConfig();
        const { signer } = await requireSigner(config);

        const contract = new ethers.Contract(ARENA_ADDRESSES["arena.agentNewsletter"], AGENT_NEWSLETTER_ABI, signer);
        const spinner = startSpinner(`Publishing issue to ${formatNewsletterId(newsletterId)}…`);

        try {
          const tx = await (contract["publishIssue"] as (id: bigint, h: string, p: string, e: string) => Promise<ethers.TransactionResponse>)(
            newsletterId, contentHash as `0x${string}`, opts.preview, endpoint
          );
          spinner.update("Waiting for confirmation…");
          const receipt = await tx.wait();
          spinner.succeed(`Issue published — tx ${receipt?.hash ?? tx.hash}`);
          console.log();
          console.log(`  ${chalk.bold("Newsletter")} ${formatNewsletterId(newsletterId)}`);
          console.log(`  ${chalk.bold("Hash")}       ${contentHash}`);
          console.log(`  ${chalk.bold("Preview")}    ${opts.preview}`);
          if (endpoint) console.log(`  ${chalk.bold("Endpoint")}   ${endpoint}`);
        } catch (txErr) {
          spinner.fail("Transaction failed");
          const msg = txErr instanceof Error ? txErr.message : String(txErr);
          console.error(` ${c.failure} Transaction reverted: ${msg}`);
          process.exit(2);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} ${msg}`);
        process.exit(1);
      }
    });

  // 33. arena newsletter list [address]
  newsletterCmd
    .command("list [address]")
    .description("List newsletters by an agent")
    .option("--json", "Output as JSON")
    .action(async (address?: string, opts?: { json?: boolean }) => {
      try {
        const config = loadConfig();
        let target = address;
        if (!target) {
          const { address: selfAddr } = await requireSigner(config);
          target = selfAddr;
        }
        const addr = target.toLowerCase();

        const data = await gql(`{
          agentNewsletters(where: { creator: "${addr}" }, first: 50, orderBy: createdAt, orderDirection: desc) {
            id name description endpoint createdAt issueCount
          }
        }`);

        const newsletters = (data["agentNewsletters"] as unknown[]) ?? [];

        if (opts?.json) {
          console.log(JSON.stringify(newsletters, null, 2));
          return;
        }

        console.log();
        console.log(chalk.bold(`  Newsletters — ${truncateAddr(target)}`));
        console.log();

        if (newsletters.length === 0) {
          console.log(chalk.dim("  No newsletters found."));
        } else {
          for (const n of newsletters) {
            const nl = n as Record<string, unknown>;
            const nid = formatNewsletterId(BigInt(String(nl["id"])));
            console.log(`  ${chalk.bold(nid)}  ${chalk.bold(String(nl["name"]))}`);
            console.log(`    ${nl["description"]}  issues:${nl["issueCount"] ?? 0}  ${chalk.dim(formatElapsed(Number(nl["createdAt"])))}`);
            console.log(`    ${chalk.dim(String(nl["endpoint"]))}`);
            console.log();
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} Subgraph unavailable: ${msg}`);
        process.exit(2);
      }
    });

  // 34. arena newsletter issues
  newsletterCmd
    .command("issues <newsletter-id>")
    .description("List issues for a newsletter")
    .option("--json", "Output as JSON")
    .action(async (newsletterIdStr: string, opts: { json?: boolean }) => {
      try {
        let newsletterId: bigint;
        try {
          newsletterId = parseNewsletterId(newsletterIdStr);
        } catch {
          console.error(` ${c.failure} Invalid newsletter ID: ${newsletterIdStr}`);
          process.exit(1);
        }

        const data = await gql(`{
          newsletterIssues(where: { newsletter: "${newsletterId.toString()}" }, first: 50, orderBy: publishedAt, orderDirection: desc) {
            id contentHash preview endpoint publishedAt
          }
        }`);

        const issues = (data["newsletterIssues"] as unknown[]) ?? [];

        if (opts.json) {
          console.log(JSON.stringify(issues, null, 2));
          return;
        }

        console.log();
        console.log(chalk.bold(`  Issues — ${formatNewsletterId(newsletterId)}`));
        console.log();

        if (issues.length === 0) {
          console.log(chalk.dim("  No issues published yet."));
        } else {
          let num = issues.length;
          for (const i of issues) {
            const issue = i as Record<string, unknown>;
            console.log(`  #${num--}  ${chalk.bold(String(issue["preview"]).slice(0, 60))}  ${chalk.dim(formatElapsed(Number(issue["publishedAt"])))}`);
            if (issue["endpoint"]) console.log(`       ${chalk.dim(String(issue["endpoint"]))}`);
          }
        }
        console.log();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} Subgraph unavailable: ${msg}`);
        process.exit(2);
      }
    });

  // ══════════════════════════════════════════════════════════════════════════
  // SETUP
  // ══════════════════════════════════════════════════════════════════════════

  arena
    .command("setup")
    .description("Check PolicyEngine whitelist and AgentRegistry registration for Arena contracts")
    .action(async () => {
      try {
        const config = loadConfig();
        const { signer, address } = await requireSigner(config);
        const provider = signer.provider!;

        const policyEngine  = new ethers.Contract(POLICY_ENGINE_ADDR, POLICY_ENGINE_ABI, signer);
        const agentRegistry = new ethers.Contract(AGENT_REGISTRY_ADDR, AGENT_REGISTRY_ABI as unknown as string[], provider);

        console.log();
        console.log(chalk.bold("  Arena Setup Check"));
        console.log(`  Wallet: ${address}`);
        console.log();

        // Check agent registration
        let isRegistered = false;
        try {
          isRegistered = await (agentRegistry["isRegistered"] as (a: string) => Promise<boolean>)(address);
          console.log(`  ${isRegistered ? c.success : c.warning} AgentRegistry: ${isRegistered ? "registered" : "not registered (run: arc402 agent register)"}`);
        } catch (e) {
          console.log(`  ${c.warning} AgentRegistry: check failed (${(e as Error).message})`);
        }

        // Check PolicyEngine whitelist for each Arena contract
        const targets: Array<[string, string]> = [
          ["StatusRegistry",      ARENA_ADDRESSES["arena.statusRegistry"]],
          ["ArenaPool",           ARENA_ADDRESSES["arena.arenaPool"]],
          ["ResearchSquad",       ARENA_ADDRESSES["arena.researchSquad"]],
          ["SquadBriefing",       ARENA_ADDRESSES["arena.squadBriefing"]],
          ["AgentNewsletter",     ARENA_ADDRESSES["arena.agentNewsletter"]],
          ["IntelligenceRegistry",ARENA_ADDRESSES["arena.intelligenceRegistry"]],
        ];

        let needsWhitelist: string[] = [];

        for (const [label, targetAddr] of targets) {
          try {
            const whitelisted = await (policyEngine["isContractWhitelisted"] as (w: string, t: string) => Promise<boolean>)(address, targetAddr);
            console.log(`  ${whitelisted ? c.success : c.failure} PolicyEngine: ${label} ${whitelisted ? "whitelisted" : "NOT whitelisted"}`);
            if (!whitelisted) needsWhitelist.push(targetAddr);
          } catch (e) {
            console.log(`  ${c.warning} PolicyEngine: ${label} check failed (${(e as Error).message})`);
          }
        }

        if (needsWhitelist.length > 0) {
          console.log();
          console.log(chalk.bold("  Whitelisting missing contracts…"));
          for (const targetAddr of needsWhitelist) {
            const label = targets.find(([, t]) => t === targetAddr)?.[0] ?? targetAddr;
            const spinner = startSpinner(`Whitelisting ${label}…`);
            try {
              const tx = await (policyEngine["whitelistContract"] as (w: string, t: string) => Promise<ethers.TransactionResponse>)(address, targetAddr);
              await tx.wait();
              spinner.succeed(`${label} whitelisted`);
            } catch (txErr) {
              spinner.fail(`Failed to whitelist ${label}`);
              const msg = txErr instanceof Error ? txErr.message : String(txErr);
              console.error(`    ${c.failure} ${msg}`);
            }
          }
        } else {
          console.log();
          console.log(` ${c.success} All Arena contracts whitelisted.`);
        }

        console.log();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(` ${c.failure} ${msg}`);
        process.exit(1);
      }
    });
}
