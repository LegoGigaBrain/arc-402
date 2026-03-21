import { Command } from "commander";
import { ethers } from "ethers";
import { AgentRegistryClient, CapabilityRegistryClient, ReputationOracleClient, SponsorshipAttestationClient } from "@arc402/sdk";
import { loadConfig } from "../config";
import { getClient } from "../client";
import { getTrustTier, printTable, truncateAddress } from "../utils/format";
import { c } from '../ui/colors';
import { renderTree } from '../ui/tree';

// Minimal ABI for the new getAgentsWithCapability function (Spec 18)
const CAPABILITY_REGISTRY_EXTRA_ABI = [
  "function getAgentsWithCapability(string calldata capability) external view returns (address[])",
];

// ─── Composite scoring helpers ────────────────────────────────────────────────

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
  highestTier?: unknown;
  reputation?: unknown;
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
  const jobsVals  = normalise(agents.map((a) => a.completedJobs));

  // Price: lower is better — invert. Missing price gets neutral 0.5.
  const rawPrices   = agents.map((a) => (a.priceUsd !== null ? a.priceUsd : -1));
  const validPrices = rawPrices.filter((p) => p >= 0);
  const maxPrice    = validPrices.length > 0 ? Math.max(...validPrices) : 1;
  const priceInvVals = rawPrices.map((p) =>
    p < 0 ? 0.5 : maxPrice > 0 ? 1 - p / maxPrice : 1
  );

  return agents.map((agent, i) => ({
    ...agent,
    compositeScore:
      trustVals[i]    * 0.5 +
      stakeVals[i]    * 0.2 +
      jobsVals[i]     * 0.2 +
      priceInvVals[i] * 0.1,
    rank: 0, // filled after sort
  }));
}

// ─── Endpoint health check ────────────────────────────────────────────────────

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

// ─── Command ──────────────────────────────────────────────────────────────────

export function registerDiscoverCommand(program: Command): void {
  program
    .command("discover")
    .description(
      "Discover agents by capability with trust/price/stake filters and composite ranking (Specs 16, 18)"
    )
    .option("--capability <cap>",        "Exact canonical capability (e.g. legal.patent-analysis.us.v1)")
    .option("--capability-prefix <pfx>", "Prefix match against registered capabilities")
    .option("--service-type <type>",     "Filter by serviceType substring")
    .option("--type <type>",             "Filter by serviceType substring (alias for --service-type)")
    .option("--min-trust <score>",       "Minimum trust score", "0")
    .option("--max-price <usd>",         "Maximum price in USD (from agent metadataURI, best-effort)", "0")
    .option("--min-stake <wei>",         "Minimum stake in wei", "0")
    .option("--top <n>",                 "Show top N agents by trust score")
    .option("--sort <field>",            "Sort by: trust | price | jobs | stake | composite", "composite")
    .option("--limit <n>",               "Max results", "20")
    .option("--online",                  "Only show agents whose /health endpoint responds")
    .option("--json",                    "Machine-parseable output")
    .action(async (opts) => {
      const config = loadConfig();
      if (!config.agentRegistryAddress) throw new Error("agentRegistryAddress missing in config");
      const { provider } = await getClient(config);

      const registry     = new AgentRegistryClient(config.agentRegistryAddress, provider);
      const capabilitySDK = config.capabilityRegistryAddress
        ? new CapabilityRegistryClient(config.capabilityRegistryAddress, provider)
        : null;
      const sponsorship  = config.sponsorshipAttestationAddress
        ? new SponsorshipAttestationClient(config.sponsorshipAttestationAddress, provider)
        : null;
      const reputation   = config.reputationOracleAddress
        ? new ReputationOracleClient(config.reputationOracleAddress, provider)
        : null;

      // --top <n> sets sort to trust and overrides limit
      const effectiveSort  = opts.top ? "trust" : opts.sort;
      const limit          = opts.top ? Number(opts.top) : Number(opts.limit);
      const minTrust       = Number(opts.minTrust);
      const maxPriceUsd    = Number(opts.maxPrice);   // 0 = no filter
      const minStakeWei    = BigInt(opts.minStake);
      // --type is an alias for --service-type
      if (opts.type && !opts.serviceType) opts.serviceType = opts.type;

      // ── Step 1: Get candidate addresses ─────────────────────────────────────

      let candidateAddresses: string[] | null = null;

      if (opts.capability && config.capabilityRegistryAddress) {
        // Use the reverse index for O(1) exact-match (Spec 18: getAgentsWithCapability)
        const capContract = new ethers.Contract(
          config.capabilityRegistryAddress,
          CAPABILITY_REGISTRY_EXTRA_ABI,
          provider
        );
        try {
          const addrs: string[] = await capContract.getAgentsWithCapability(opts.capability);
          candidateAddresses = addrs;
        } catch {
          // Contract may not have been upgraded yet; fall through to listAgents
        }
      }

      // ── Step 2: Load agent data ───────────────────────────────────────────

      let agentInfos: Awaited<ReturnType<typeof registry.listAgents>>;

      if (candidateAddresses !== null) {
        const results = await Promise.allSettled(
          candidateAddresses.map((addr) => registry.getAgent(addr))
        );
        agentInfos = results
          .filter((r): r is PromiseFulfilledResult<typeof agentInfos[number]> => r.status === "fulfilled")
          .map((r) => r.value);
      } else {
        agentInfos = await registry.listAgents(limit * 10);
      }

      // ── Step 3: Apply filters ────────────────────────────────────────────

      let filtered = agentInfos.filter((a) => a.active !== false);

      if (opts.capability) {
        filtered = filtered.filter((a) =>
          a.capabilities.some((c: string) => c === opts.capability)
        );
      }

      if (opts.capabilityPrefix) {
        filtered = filtered.filter((a) =>
          a.capabilities.some((c: string) => c.startsWith(opts.capabilityPrefix as string))
        );
      }

      if (opts.serviceType) {
        filtered = filtered.filter((a) =>
          a.serviceType.toLowerCase().includes(String(opts.serviceType).toLowerCase())
        );
      }

      filtered = filtered.filter((a) => Number(a.trustScore ?? 0n) >= minTrust);

      if (minStakeWei > 0n) {
        filtered = filtered.filter((a) => {
          const stake = (a as unknown as { stake?: bigint }).stake ?? 0n;
          return BigInt(stake) >= minStakeWei;
        });
      }

      // ── Step 4: Enrich ──────────────────────────────────────────────────

      const enriched = await Promise.all(
        filtered.slice(0, limit * 5).map(async (agent) => {
          const [operational, canonicalCapabilities, highestTier, rep] = await Promise.all([
            registry.getOperationalMetrics(agent.wallet),
            capabilitySDK ? capabilitySDK.getCapabilities(agent.wallet) : Promise.resolve([]),
            sponsorship ? sponsorship.getHighestTier(agent.wallet) : Promise.resolve(undefined),
            reputation ? reputation.getReputation(agent.wallet) : Promise.resolve(undefined),
          ]);

          // Best-effort metadata fetch for priceUsd
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
            } catch { /* ignore — advisory only */ }
          }

          // Apply max-price filter post-enrichment
          if (maxPriceUsd > 0 && priceUsd !== null && priceUsd > maxPriceUsd) {
            return null;
          }

          const repObj = rep && typeof rep === "object" ? (rep as unknown) as Record<string, unknown> : {};

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
            highestTier,
            reputation: rep,
          } as Omit<ScoredAgent, "compositeScore" | "rank">;
        })
      );

      const validAgents = enriched.filter((a): a is Omit<ScoredAgent, "compositeScore" | "rank"> => a !== null);

      // ── Step 5: Score ──────────────────────────────────────────────────────

      let scored = computeCompositeScores(validAgents);

      // Sort
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
        default: // "composite"
          scored.sort((a, b) => b.compositeScore - a.compositeScore);
      }

      // Assign 1-based ranks after sort
      scored = scored.slice(0, limit).map((a, i) => ({ ...a, rank: i + 1 }));

      // ── Step 6: Endpoint health checks ────────────────────────────────────

      type ScoredWithStatus = ScoredAgent & { endpointStatus: "online" | "offline" | "unknown" };

      let withStatus: ScoredWithStatus[];

      if (opts.online || /* always ping for tree display */ true) {
        const statuses = await Promise.all(
          scored.map(async (agent) => {
            if (!agent.endpoint) return "unknown" as const;
            return pingEndpoint(agent.endpoint);
          })
        );
        withStatus = scored.map((agent, i) => ({ ...agent, endpointStatus: statuses[i] as "online" | "offline" | "unknown" }));
      } else {
        withStatus = scored.map((agent) => ({ ...agent, endpointStatus: "unknown" as const }));
      }

      // Apply --online filter
      if (opts.online) {
        withStatus = withStatus.filter((a) => a.endpointStatus === "online");
        if (withStatus.length === 0) {
          console.log(`\n  ${c.warning} No agents with responding /health endpoints found.`);
          return;
        }
      }

      // ── Step 7: Output ─────────────────────────────────────────────────────

      if (opts.json) {
        return console.log(JSON.stringify(
          withStatus,
          (_k, value) => typeof value === "bigint" ? value.toString() : value,
          2
        ));
      }

      const onlineCount = withStatus.filter((a) => a.endpointStatus === "online").length;
      console.log('\n ' + c.mark + c.white(' Discover Results') + c.dim(` — ${withStatus.length} agent${withStatus.length !== 1 ? 's' : ''} found, ${onlineCount} online`));

      // Tree output per agent
      for (const agent of withStatus) {
        const caps = (agent.canonicalCapabilities.length
          ? agent.canonicalCapabilities
          : agent.capabilities
        ).slice(0, 3).join(", ") || c.dim("none");

        const statusIcon = agent.endpointStatus === "online"
          ? c.green("● online")
          : agent.endpointStatus === "offline"
          ? c.red("○ offline")
          : c.dim("? unknown");

        const tierStr = getTrustTier(agent.trustScore);

        console.log(`\n  ${c.dim(`#${agent.rank}`)} ${c.white(agent.name)}  ${c.dim(truncateAddress(agent.wallet))}`);
        renderTree([
          { label: "service",  value: agent.serviceType },
          { label: "trust",    value: `${agent.trustScore} ${tierStr}` },
          { label: "score",    value: agent.compositeScore.toFixed(3) },
          { label: "caps",     value: caps },
          { label: "endpoint", value: statusIcon, last: true },
        ]);
      }
      console.log();
    });
}
