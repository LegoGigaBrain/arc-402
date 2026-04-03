import { ServiceAgreementClient } from "@arc402/sdk";
import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  fetchDaemonAgreements,
  fetchDaemonHealth,
  fetchDaemonWalletStatus,
  fetchDaemonWorkroomStatus,
  inspectCommerceEndpoint,
  resolveChatDaemonTarget,
} from "../commerce-client";
import { configExists, loadConfig } from "../config";
import { getClient } from "../client";
import { agreementStatusLabel } from "../utils/format";
import { DAEMON_DIR, DAEMON_TOML, loadDaemonConfig } from "../daemon/config";
import { printAgreementList, printDiscoverList, printRoundsList, printSquadCard, printStatusCard, printSubscribeCard, printWorkroomCard } from "./command-renderers";

function readConfiguredWallet(): string | undefined {
  if (fs.existsSync(DAEMON_TOML)) {
    try {
      const wallet = loadDaemonConfig().wallet.contract_address.trim();
      if (wallet) return wallet;
    } catch {
      // ignore
    }
  }

  if (configExists()) {
    try {
      return loadConfig().walletContractAddress?.trim() || undefined;
    } catch {
      // ignore
    }
  }

  return undefined;
}

function renderDaemonGuidance(target: { mode: string }): string[] {
  if (target.mode !== "local") {
    return [
      "Next steps:",
      "  1. Confirm the remote daemon URL is correct and reachable.",
      "  2. Re-run `arc402 chat --setup` if you want to switch back to a local node.",
    ];
  }

  const lines = ["Next steps:"];
  if (!fs.existsSync(DAEMON_TOML)) {
    lines.push("  1. Run `arc402 daemon init` or `arc402 setup` to create ~/.arc402/daemon.toml.");
    lines.push("  2. Fill in wallet + node settings, then start the node with `arc402 daemon start`.");
  } else {
    lines.push("  1. Start the local node with `arc402 daemon start`.");
    lines.push("  2. If it exits immediately, inspect `arc402 daemon logs` for the startup guidance.");
  }
  lines.push("  3. Run `arc402 chat --setup` and choose Remote if this machine should not host the node.");
  return lines;
}

const CAPABILITY_REGISTRY_EXTRA_ABI = [
  "function getAgentsWithCapability(string calldata capability) external view returns (address[])",
];

interface ScoredAgent {
  wallet: string;
  name: string;
  serviceType: string;
  endpoint: string;
  metadataURI: string;
  capabilities: string[];
  canonicalCapabilities: string[];
  trustScore: number;
  stake: bigint;
  completedJobs: number;
  priceUsd: number | null;
  compositeScore: number;
  rank: number;
  operational: { uptimeScore: number; responseScore: number };
}

function normalise(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  if (range === 0) return values.map(() => 1);
  return values.map((v) => (v - min) / range);
}

function computeCompositeScores(agents: Omit<ScoredAgent, "compositeScore" | "rank">[]): ScoredAgent[] {
  if (agents.length === 0) return [];
  const trustVals = normalise(agents.map((a) => a.trustScore));
  const stakeVals = normalise(agents.map((a) => Number(a.stake)));
  const jobsVals = normalise(agents.map((a) => a.completedJobs));
  const rawPrices = agents.map((a) => (a.priceUsd !== null ? a.priceUsd : -1));
  const validPrices = rawPrices.filter((p) => p >= 0);
  const maxPrice = validPrices.length > 0 ? Math.max(...validPrices) : 1;
  const priceInvVals = rawPrices.map((p) => (p < 0 ? 0.5 : maxPrice > 0 ? 1 - p / maxPrice : 1));

  return agents.map((agent, i) => ({
    ...agent,
    compositeScore: trustVals[i] * 0.5 + stakeVals[i] * 0.2 + jobsVals[i] * 0.2 + priceInvVals[i] * 0.1,
    rank: 0,
  }));
}

async function pingEndpoint(endpoint: string): Promise<"online" | "offline"> {
  if (!endpoint || !/^https?:\/\//.test(endpoint)) return "offline";
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 3000);
    const resp = await fetch(`${endpoint.replace(/\/$/, "")}/health`, { signal: ctrl.signal });
    clearTimeout(tid);
    return resp.ok ? "online" : "offline";
  } catch {
    return "offline";
  }
}

function parseTokens(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";
  let escape = false;
  for (const ch of input) {
    if (escape) {
      current += ch;
      escape = false;
      continue;
    }
    if (inQuote) {
      if (quoteChar === '"' && ch === "\\") {
        escape = true;
      } else if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function readWorkroomStatusSnapshot(): { statusLabel: string; harness?: string; policyHash?: string; queueDepth?: number; runtime?: string } {
  const policyFile = path.join(DAEMON_DIR, "openshell-policy.yaml");
  let policyHash = "n/a";
  if (fs.existsSync(policyFile)) {
    const content = fs.readFileSync(policyFile, "utf-8");
    const crypto = require("crypto") as typeof import("crypto");
    policyHash = "0x" + crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
  }

  const workerConfigPath = path.join(DAEMON_DIR, "worker", "config.json");
  let harness = "arc";
  if (fs.existsSync(workerConfigPath)) {
    try {
      const workerConfig = JSON.parse(fs.readFileSync(workerConfigPath, "utf-8")) as { harness?: string };
      harness = workerConfig.harness ?? harness;
    } catch {
      // ignore
    }
  }

  const daemonLog = path.join(DAEMON_DIR, "daemon.log");
  const statusLabel = fs.existsSync(daemonLog) ? "healthy" : "idle";

  return {
    statusLabel,
    harness,
    policyHash,
    queueDepth: 0,
    runtime: "arc402-workroom",
  };
}

export function getTuiTopLevelCommands(): string[] {
  return ["status", "discover", "agreements", "workroom", "subscription", "subscribe", "arena"];
}

export function getTuiSubCommands(): Map<string, string[]> {
  return new Map([
    ["workroom", ["status", "worker"]],
    ["subscription", ["status", "list", "cancel", "topup"]],
    ["arena", ["rounds", "squad"]],
    ["squad", ["list", "info"]],
  ]);
}

export async function executeTuiKernel(input: string): Promise<boolean> {
  const tokens = parseTokens(input);
  if (tokens.length === 0) return false;

  if (tokens[0] === "status") {
    await executeStatusKernel(tokens.slice(1));
    return true;
  }

  if (tokens[0] === "discover") {
    await executeDiscoverKernel(tokens.slice(1));
    return true;
  }

  if (tokens[0] === "agreements") {
    await executeAgreementsKernel(tokens.slice(1));
    return true;
  }

  if (tokens[0] === "workroom" && tokens[1] === "status") {
    await executeWorkroomStatusKernel();
    return true;
  }

  if (tokens[0] === "subscription") {
    await executeSubscriptionKernel(tokens.slice(1));
    return true;
  }

  if (tokens[0] === "subscribe") {
    await executeSubscribeInspectKernel(tokens.slice(1));
    return true;
  }

  if (tokens[0] === "arena" && tokens[1] === "rounds") {
    await executeArenaRoundsKernel(tokens.slice(2));
    return true;
  }

  if (tokens[0] === "arena" && tokens[1] === "squad" && tokens[2] === "list") {
    await executeArenaSquadListKernel(tokens.slice(3));
    return true;
  }

  if (tokens[0] === "arena" && tokens[1] === "squad" && tokens[2] === "info" && tokens[3]) {
    await executeArenaSquadInfoKernel(tokens[3]);
    return true;
  }

  return false;
}

async function executeStatusKernel(args: string[]): Promise<void> {
  const daemonUrlIndex = args.indexOf("--daemon-url");
  const baseUrl = daemonUrlIndex >= 0 ? args[daemonUrlIndex + 1] : undefined;
  const target = resolveChatDaemonTarget({ explicitBaseUrl: baseUrl });

  try {
    const [health, wallet, workroom, agreements] = await Promise.all([
      fetchDaemonHealth({ baseUrl: target.baseUrl }),
      fetchDaemonWalletStatus({ baseUrl: target.baseUrl }),
      fetchDaemonWorkroomStatus({ baseUrl: target.baseUrl }),
      fetchDaemonAgreements({ baseUrl: target.baseUrl }),
    ]);

    const active = agreements.agreements.filter((agreement) => {
      const status = String((agreement.status ?? agreement.state ?? "")).toLowerCase();
      return status.includes("accept") || status.includes("active") || status.includes("proposed");
    }).length;
    const pendingVerification = agreements.agreements.filter((agreement) => {
      const status = String((agreement.status ?? agreement.state ?? "")).toLowerCase();
      return status.includes("verify") || status.includes("pending");
    }).length;
    const disputed = agreements.agreements.filter((agreement) => String((agreement.status ?? agreement.state ?? "")).toLowerCase().includes("disput")).length;

    await printStatusCard({
      wallet: wallet.wallet,
      network: `chain ${wallet.chainId}`,
      balance: target.mode === "local" ? target.baseUrl : `${target.mode} · ${target.baseUrl}`,
      endpoint: wallet.rpcUrl,
      agreements: { active, pendingVerification, disputed },
      workroom: { status: workroom.status },
      status: { label: health.ok ? "online" : "offline", tone: health.ok ? "success" : "danger" },
    });
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallbackWallet = readConfiguredWallet();
    const daemonState = target.mode === "local"
      ? fs.existsSync(DAEMON_TOML)
        ? "configured locally but not responding"
        : "not configured on this machine"
      : "remote node unreachable";

    await printStatusCard({
      wallet: fallbackWallet ?? "not configured",
      network: `${target.mode} node`,
      balance: target.baseUrl,
      endpoint: message,
      workroom: { status: "waiting for daemon context" },
      status: { label: daemonState, tone: "warning" },
    });

    for (const line of renderDaemonGuidance(target)) {
      const { writeTuiLine } = await import("./render-inline");
      writeTuiLine(line);
    }
  }
}

async function executeDiscoverKernel(args: string[]): Promise<void> {
  const config = loadConfig();
  if (!config.agentRegistryAddress) throw new Error("agentRegistryAddress missing in config");
  const { provider } = await getClient(config);

  const registryMod = await import("@arc402/sdk");
  const registry = new registryMod.AgentRegistryClient(config.agentRegistryAddress, provider);
  const capabilitySDK = config.capabilityRegistryAddress
    ? new registryMod.CapabilityRegistryClient(config.capabilityRegistryAddress, provider)
    : null;
  const sponsorship = config.sponsorshipAttestationAddress
    ? new registryMod.SponsorshipAttestationClient(config.sponsorshipAttestationAddress, provider)
    : null;
  const reputation = config.reputationOracleAddress
    ? new registryMod.ReputationOracleClient(config.reputationOracleAddress, provider)
    : null;

  const opts = {
    capability: readFlag(args, "--capability"),
    capabilityPrefix: readFlag(args, "--capability-prefix"),
    serviceType: readFlag(args, "--service-type") ?? readFlag(args, "--type"),
    minTrust: Number(readFlag(args, "--min-trust") ?? "0"),
    maxPrice: Number(readFlag(args, "--max-price") ?? "0"),
    minStake: BigInt(readFlag(args, "--min-stake") ?? "0"),
    top: readFlag(args, "--top"),
    sort: readFlag(args, "--sort") ?? "composite",
    limit: Number(readFlag(args, "--limit") ?? "20"),
    online: args.includes("--online"),
  };

  const effectiveSort = opts.top ? "trust" : opts.sort;
  const limit = opts.top ? Number(opts.top) : opts.limit;

  let candidateAddresses: string[] | null = null;
  if (opts.capability && config.capabilityRegistryAddress) {
    const capContract = new ethers.Contract(config.capabilityRegistryAddress, CAPABILITY_REGISTRY_EXTRA_ABI, provider);
    try {
      candidateAddresses = await capContract.getAgentsWithCapability(opts.capability);
    } catch {
      candidateAddresses = null;
    }
  }

  let agentInfos: Awaited<ReturnType<typeof registry.listAgents>>;
  if (candidateAddresses !== null) {
    const results = await Promise.allSettled(candidateAddresses.map((addr) => registry.getAgent(addr)));
    agentInfos = results
      .filter((r): r is PromiseFulfilledResult<typeof agentInfos[number]> => r.status === "fulfilled")
      .map((r) => r.value);
  } else {
    agentInfos = await registry.listAgents(limit * 10);
  }

  let filtered = agentInfos.filter((a) => a.active !== false);
  if (opts.capability) filtered = filtered.filter((a) => a.capabilities.some((c: string) => c === opts.capability));
  if (opts.capabilityPrefix) filtered = filtered.filter((a) => a.capabilities.some((c: string) => c.startsWith(opts.capabilityPrefix!)));
  if (opts.serviceType) filtered = filtered.filter((a) => a.serviceType.toLowerCase().includes(String(opts.serviceType).toLowerCase()));
  filtered = filtered.filter((a) => Number(a.trustScore ?? 0n) >= opts.minTrust);
  if (opts.minStake > 0n) {
    filtered = filtered.filter((a) => BigInt((a as unknown as { stake?: bigint }).stake ?? 0n) >= opts.minStake);
  }

  const enriched = await Promise.all(
    filtered.slice(0, limit * 5).map(async (agent) => {
      const [operational, canonicalCapabilities, rep] = await Promise.all([
        registry.getOperationalMetrics(agent.wallet),
        capabilitySDK ? capabilitySDK.getCapabilities(agent.wallet) : Promise.resolve([]),
        reputation ? reputation.getReputation(agent.wallet) : Promise.resolve(undefined),
        sponsorship ? sponsorship.getHighestTier(agent.wallet) : Promise.resolve(undefined),
      ]);

      let priceUsd: number | null = null;
      if (agent.metadataURI && /^https?:\/\//.test(agent.metadataURI)) {
        try {
          const ctrl = new AbortController();
          const tid = setTimeout(() => ctrl.abort(), 2000);
          const resp = await fetch(agent.metadataURI, { signal: ctrl.signal });
          clearTimeout(tid);
          if (resp.ok) {
            const meta = await resp.json() as { pricing?: { priceUsd?: number } };
            if (meta.pricing?.priceUsd != null) priceUsd = meta.pricing.priceUsd;
          }
        } catch {
          // ignore
        }
      }

      if (opts.maxPrice > 0 && priceUsd !== null && priceUsd > opts.maxPrice) return null;

      const repObj = rep && typeof rep === "object" ? (rep as unknown as Record<string, unknown>) : {};

      return {
        wallet: agent.wallet,
        name: agent.name,
        serviceType: agent.serviceType,
        endpoint: agent.endpoint,
        metadataURI: agent.metadataURI,
        capabilities: agent.capabilities as string[],
        canonicalCapabilities: canonicalCapabilities as string[],
        trustScore: Number(agent.trustScore ?? 0n),
        stake: (agent as unknown as { stake?: bigint }).stake ?? 0n,
        completedJobs: Number(repObj.completedJobs ?? 0),
        priceUsd,
        compositeScore: 0,
        rank: 0,
        operational: {
          uptimeScore: Number(operational.uptimeScore),
          responseScore: Number(operational.responseScore),
        },
      } as Omit<ScoredAgent, "compositeScore" | "rank">;
    })
  );

  let scored = computeCompositeScores(enriched.filter((a): a is Omit<ScoredAgent, "compositeScore" | "rank"> => a !== null));

  switch (effectiveSort) {
    case "trust":
      scored.sort((a, b) => b.trustScore - a.trustScore);
      break;
    case "price":
      scored.sort((a, b) => {
        if (a.priceUsd === null && b.priceUsd === null) return 0;
        if (a.priceUsd === null) return 1;
        if (b.priceUsd === null) return -1;
        return a.priceUsd - b.priceUsd;
      });
      break;
    case "jobs":
      scored.sort((a, b) => b.completedJobs - a.completedJobs);
      break;
    case "stake":
      scored.sort((a, b) => (b.stake > a.stake ? 1 : b.stake < a.stake ? -1 : 0));
      break;
    default:
      scored.sort((a, b) => b.compositeScore - a.compositeScore);
  }

  scored = scored.slice(0, limit).map((a, i) => ({ ...a, rank: i + 1 }));

  let withStatus = await Promise.all(
    scored.map(async (agent) => ({
      ...agent,
      endpointStatus: agent.endpoint ? await pingEndpoint(agent.endpoint) : "unknown" as const,
    }))
  );

  if (opts.online) withStatus = withStatus.filter((a) => a.endpointStatus === "online");

  const onlineCount = withStatus.filter((a) => a.endpointStatus === "online").length;
  await printDiscoverList({
    summary: `${withStatus.length} agent${withStatus.length === 1 ? "" : "s"} · ${onlineCount} online`,
    status: { label: effectiveSort, tone: "info" },
    agents: withStatus.map((agent) => ({
      rank: agent.rank,
      name: agent.name,
      wallet: agent.wallet,
      serviceType: agent.serviceType,
      trustScore: agent.trustScore,
      compositeScore: agent.compositeScore,
      endpointStatus: agent.endpointStatus,
      capabilitySummary: (agent.canonicalCapabilities.length ? agent.canonicalCapabilities : agent.capabilities).slice(0, 3).join(", ") || "none",
      priceLabel: agent.priceUsd === null ? undefined : `$${agent.priceUsd}`,
    })),
  });
}

async function executeAgreementsKernel(args: string[]): Promise<void> {
  const asIndex = args.indexOf("--as");
  const role = asIndex >= 0 ? (args[asIndex + 1] ?? "client") : "client";
  const config = loadConfig();
  if (!config.serviceAgreementAddress) throw new Error("serviceAgreementAddress missing in config");
  const { provider, address } = await getClient(config);
  if (!address) throw new Error("No wallet configured");
  const client = new ServiceAgreementClient(config.serviceAgreementAddress, provider);
  const agreements = role === "provider"
    ? await client.getProviderAgreements(address)
    : await client.getClientAgreements(address);

  const totalEscrowWei = agreements.reduce((sum, agreement) => sum + BigInt(agreement.price ?? 0n), 0n);
  await printAgreementList({
    roleLabel: role === "provider" ? "Provider Agreements" : "Client Agreements",
    totalEscrowLabel: `${totalEscrowWei.toString()} wei escrowed`,
    status: { label: `${agreements.length} total`, tone: "info" },
    agreements: agreements.map((agreement) => ({
      id: agreement.id.toString(),
      counterparty: role === "provider" ? agreement.client : agreement.provider,
      serviceType: agreement.serviceType,
      status: agreementStatusLabel(agreement.status),
      deadlineMinutes: Math.max(0, Math.round((Number(agreement.deadline) - Math.floor(Date.now() / 1000)) / 60)),
      price: `${BigInt(agreement.price ?? 0n).toString()} wei`,
    })),
  });
}

async function executeWorkroomStatusKernel(): Promise<void> {
  const snapshot = readWorkroomStatusSnapshot();
  await printWorkroomCard(snapshot);
}

async function executeSubscriptionKernel(args: string[]): Promise<void> {
  const sub = args[0] ?? "status";
  const id = args[1];
  const months = Number.parseInt(readFlag(args, "--months") ?? "1", 10);

  if (sub === "status") {
    await printSubscribeCard({
      provider: `subscription ${id ?? "unknown"}`,
      planId: "status",
      rateLabel: "pending query binding",
      accessSummary: ["Contract/subgraph lookup pending"],
      status: { label: "scaffold", tone: "warning" },
    });
    return;
  }

  if (sub === "list") {
    await printSubscribeCard({
      provider: "subscriptions",
      planId: "list",
      rateLabel: "query source pending",
      accessSummary: ["List query scaffolding only"],
      status: { label: "scaffold", tone: "warning" },
    });
    return;
  }

  if (sub === "cancel") {
    await printSubscribeCard({
      provider: `subscription ${id ?? "unknown"}`,
      planId: "cancel",
      rateLabel: "write path deferred",
      accessSummary: ["Cancellation intentionally not wired in this phase"],
      status: { label: "deferred", tone: "warning" },
    });
    return;
  }

  if (sub === "topup") {
    await printSubscribeCard({
      provider: `subscription ${id ?? "unknown"}`,
      planId: "topup",
      rateLabel: `+${months} months`,
      months,
      accessSummary: ["Top-up command shape is staged"],
      status: { label: "scaffold", tone: "warning" },
    });
    return;
  }

  throw new Error(`Unsupported subscription subcommand: ${sub}`);
}

async function executeSubscribeInspectKernel(args: string[]): Promise<void> {
  const endpoint = args[0];
  if (!endpoint) throw new Error("subscribe requires an endpoint");
  const inspection = await inspectCommerceEndpoint(endpoint);
  const months = Number.parseInt(readFlag(args, "--months") ?? "1", 10);
  const plan = readFlag(args, "--plan") ?? inspection.subscription?.plan ?? "unspecified";

  await printSubscribeCard({
    provider: endpoint,
    planId: plan,
    rateLabel: inspection.subscription?.rate ?? inspection.x402?.amount ?? "n/a",
    months,
    paymentOptions: inspection.paymentOptions,
    accessSummary: [inspection.subscription?.endpoint ?? endpoint, inspection.x402?.description ?? "read-only scaffold"],
    status: { label: inspection.paymentRequired ? "payment required" : "inspect", tone: inspection.paymentRequired ? "warning" : "info" },
  });
}

const ARENA_SUBGRAPH_URL = "https://api.studio.thegraph.com/query/1744310/arc-402/v0.3.0";

async function arenaGql(query: string): Promise<Record<string, unknown>> {
  const res = await fetch(ARENA_SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Subgraph HTTP ${res.status}`);
  const json = (await res.json()) as { data?: Record<string, unknown>; errors?: unknown[] };
  if (json.errors?.length) throw new Error(`Subgraph error: ${JSON.stringify(json.errors[0])}`);
  return json.data ?? {};
}

function separator(): string {
  return "─".repeat(60);
}

function formatSquadId(id: bigint | number): string {
  return `squad-0x${Number(id).toString(16)}`;
}

function parseSquadId(s: string): bigint {
  if (s.startsWith("squad-0x")) return BigInt("0x" + s.slice(8));
  return BigInt(s);
}

function truncateAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function squadStatusLabel(status: number): string {
  const labels: Record<number, string> = { 0: "active", 1: "concluded", 2: "disbanded" };
  return labels[status] ?? String(status);
}

function formatElapsed(ts: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - ts;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

async function executeArenaRoundsKernel(args: string[]): Promise<void> {
  const limit = Number.parseInt(readFlag(args, "--limit") ?? "10", 10);
  const data = await arenaGql(`{
    arenaRounds(first: ${Math.max(1, Math.min(limit, 50))}, orderBy: createdAt, orderDirection: desc) {
      id
      question
      category
      yesPot
      noPot
      stakingClosesAt
      resolvesAt
      resolved
      outcome
    }
  }`);

  const rounds = ((data["arenaRounds"] as unknown[]) ?? []).map((round) => {
    const r = round as Record<string, unknown>;
    const yesPot = BigInt(String(r["yesPot"] ?? "0"));
    const noPot = BigInt(String(r["noPot"] ?? "0"));
    const resolvesAt = Number(r["resolvesAt"] ?? 0);
    return {
      id: String(r["id"]),
      question: String(r["question"]),
      category: String(r["category"] ?? ""),
      yesLabel: yesPot.toString(),
      noLabel: noPot.toString(),
      timingLabel: resolvesAt > 0 ? formatElapsed(resolvesAt) : "timing n/a",
      resolved: Boolean(r["resolved"]),
      outcomeLabel: Boolean(r["outcome"]) ? "YES" : "NO",
    };
  });

  await printRoundsList({
    title: "Arena Rounds",
    status: { label: "subgraph", tone: "info" },
    rounds,
  });
}

async function executeArenaSquadListKernel(args: string[]): Promise<void> {
  const domain = readFlag(args, "--domain");
  const domainFilter = domain ? `where: { domainTag: "${domain}" }` : "";
  const data = await arenaGql(`{
    researchSquads(${domainFilter} first: 50, orderBy: createdAt, orderDirection: desc) {
      id name domainTag creator status inviteOnly memberCount createdAt
    }
  }`);

  const squads = (data["researchSquads"] as unknown[]) ?? [];
  const { writeTuiLine } = await import("./render-inline");

  if (squads.length === 0) {
    writeTuiLine("◈ Research Squads");
    writeTuiLine(separator());
    writeTuiLine("  No squads found.");
    return;
  }

  for (const s of squads) {
    const sq = s as Record<string, unknown>;
    await printSquadCard({
      id: formatSquadId(BigInt(String(sq["id"]))),
      name: String(sq["name"]),
      domainTag: String(sq["domainTag"]),
      statusLabel: squadStatusLabel(Number(sq["status"])),
      creator: truncateAddr(String(sq["creator"])),
      memberCount: Number(sq["memberCount"]),
      inviteOnly: Boolean(sq["inviteOnly"]),
      briefings: [{ preview: formatElapsed(Number(sq["createdAt"])), publishedLabel: "created" }],
    });
    writeTuiLine("");
  }
}

async function executeArenaSquadInfoKernel(squadIdArg: string): Promise<void> {
  const rawId = parseSquadId(squadIdArg).toString();
  // Subgraph stores squad IDs as the raw decimal integer from the contract event.
  // Try the raw integer first, then the hex form used in formatSquadId if not found.
  let data = await arenaGql(`{
    researchSquad(id: "${rawId}") {
      id name domainTag creator status inviteOnly memberCount
    }
    contributions(where: { squad: "${rawId}" }, first: 10, orderBy: timestamp, orderDirection: desc) {
      id description timestamp author
    }
    squadMembers: contributions(where: { squad: "${rawId}" }, first: 100) {
      author
    }
  }`);

  let squad = data["researchSquad"] as Record<string, unknown> | null;

  // Subgraph may not have indexed this squad yet or ID form may differ
  if (!squad) {
    const { writeTuiLine } = await import("./render-inline");
    writeTuiLine("◈ Squad");
    writeTuiLine(separator());
    writeTuiLine(`  Squad not found: ${squadIdArg}`);
    writeTuiLine("  The subgraph may not have indexed this squad yet.");
    return;
  }

  // Unique authors as member proxies (contributions schema)
  const allContribs = ((data["squadMembers"] as unknown[]) ?? []);
  const seenAuthors = new Set<string>();
  const members = allContribs
    .filter((c) => {
      const author = String((c as Record<string, unknown>)["author"] ?? "");
      if (!author || seenAuthors.has(author)) return false;
      seenAuthors.add(author);
      return true;
    })
    .map((c) => ({
      agent: truncateAddr(String((c as Record<string, unknown>)["author"])),
      role: "contributor" as const,
    }));

  const briefings = ((data["contributions"] as unknown[]) ?? []).map((contribution) => {
    const b = contribution as Record<string, unknown>;
    return {
      preview: String(b["description"] ?? "contribution"),
      publishedLabel: formatElapsed(Number(b["timestamp"] ?? 0)),
    };
  });

  await printSquadCard({
    id: formatSquadId(BigInt(String(squad["id"]))),
    name: String(squad["name"]),
    domainTag: String(squad["domainTag"]),
    statusLabel: squadStatusLabel(Number(squad["status"])),
    creator: truncateAddr(String(squad["creator"])),
    memberCount: Number(squad["memberCount"]),
    inviteOnly: Boolean(squad["inviteOnly"]),
    members,
    briefings,
  });
}

function readFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 ? args[idx + 1] : undefined;
}
