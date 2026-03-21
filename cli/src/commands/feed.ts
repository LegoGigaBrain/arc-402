import { Command } from "commander";
import chalk from "chalk";
import { c } from '../ui/colors';

const SUBGRAPH_URL = "https://api.studio.thegraph.com/query/1744310/arc-402/v0.2.0";

const HS_TYPE_LABELS: Record<number, string> = {
  0: "Respected",
  1: "Curious",
  2: "Endorsed",
  3: "Thanked",
  4: "Collaborated",
  5: "Challenged",
  6: "Referred",
  7: "Hello",
};

async function gql(query: string): Promise<Record<string, unknown>> {
  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Subgraph HTTP ${res.status}`);
  const json = (await res.json()) as { data?: Record<string, unknown>; errors?: unknown[] };
  if (json.errors?.length) throw new Error(`Subgraph error: ${JSON.stringify(json.errors[0])}`);
  return json.data ?? {};
}

function shortAddr(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;
}

function utcTime(ts: number): string {
  const d = new Date(ts * 1000);
  const h = d.getUTCHours().toString().padStart(2, "0");
  const m = d.getUTCMinutes().toString().padStart(2, "0");
  return `${h}:${m} UTC`;
}

function weiToEth(wei: string): string {
  return (Number(BigInt(wei)) / 1e18).toFixed(4);
}

function weiToUsdc(wei: string): string {
  return (Number(BigInt(wei)) / 1e6).toFixed(2);
}

type FeedEvent = {
  type: "handshake" | "hire" | "fulfill" | "vouch";
  timestamp: number;
  raw: Record<string, unknown>;
};

async function fetchFeedEvents(limit: number, typeFilter?: string, sinceTs?: number): Promise<FeedEvent[]> {
  const includeHandshakes = !typeFilter || typeFilter === "handshake";
  const includeHire = !typeFilter || typeFilter === "hire";
  const includeFulfill = !typeFilter || typeFilter === "fulfill";
  const includeVouch = !typeFilter || typeFilter === "vouch";

  const tsFilt = sinceTs ? `, where: { timestamp_gt: "${sinceTs}" }` : "";
  const agTsFilt = sinceTs ? `, where: { proposedAt_gt: "${sinceTs}" }` : "";

  const parts: string[] = [];

  if (includeHandshakes) {
    parts.push(`
      handshakes(orderBy: timestamp, orderDirection: desc, first: ${limit}${tsFilt}) {
        id from { id name } to { id name } hsType note timestamp isNewConnection
      }`);
  }

  if (includeHire || includeFulfill) {
    parts.push(`
      agreements(orderBy: proposedAt, orderDirection: desc, first: ${limit}${agTsFilt}) {
        id client provider serviceType price state proposedAt updatedAt
      }`);
  }

  if (includeVouch) {
    parts.push(`
      vouches(orderBy: id, orderDirection: desc, first: ${limit}) {
        id voucher { id name } newAgent { id name } stakeAmount active
      }`);
  }

  const data = await gql(`{ ${parts.join("\n")} }`);
  const events: FeedEvent[] = [];

  if (includeHandshakes) {
    for (const h of (data.handshakes as Record<string, unknown>[]) ?? []) {
      events.push({ type: "handshake", timestamp: Number(h["timestamp"]), raw: h });
    }
  }

  if (data["agreements"]) {
    for (const a of data["agreements"] as Record<string, unknown>[]) {
      const state = Number(a["state"]);
      if (includeHire && state === 0) {
        events.push({ type: "hire", timestamp: Number(a["proposedAt"]), raw: a });
      }
      if (includeFulfill && state === 2) {
        events.push({ type: "fulfill", timestamp: Number(a["updatedAt"]), raw: a });
      }
    }
  }

  if (includeVouch) {
    for (const v of (data["vouches"] as Record<string, unknown>[]) ?? []) {
      events.push({ type: "vouch", timestamp: 0, raw: v });
    }
  }

  events.sort((a, b) => b.timestamp - a.timestamp);
  return events.slice(0, limit);
}

function renderFeedEvent(ev: FeedEvent): string {
  const ts = ev.timestamp > 0 ? `[${utcTime(ev.timestamp)}]` : "[       ]";

  switch (ev.type) {
    case "handshake": {
      const h = ev.raw;
      const from = h["from"] as Record<string, string>;
      const to = h["to"] as Record<string, string>;
      const fromName = from["name"] || shortAddr(from["id"]);
      const toName = to["name"] || shortAddr(to["id"]);
      const label = HS_TYPE_LABELS[Number(h["hsType"])] ?? `Type${h["hsType"]}`;
      const note = h["note"] ? `  "${h["note"]}"` : "";
      return chalk.cyan(`${ts}  🤝 ${fromName} → ${toName}     ${label}${note}`);
    }
    case "hire": {
      const a = ev.raw;
      const price = a["price"] ? `  ${weiToEth(a["price"] as string)} ETH` : "";
      return chalk.yellow(
        `${ts}  📋 ${shortAddr(a["client"] as string)} hired ${shortAddr(a["provider"] as string)}   ${a["serviceType"]}${price}`,
      );
    }
    case "fulfill": {
      const a = ev.raw;
      const price = a["price"] ? `  ${weiToEth(a["price"] as string)} ETH released` : "";
      return chalk.green(`${ts}  ✅ Agreement #${(a["id"] as string).slice(0, 8)} fulfilled${price}`);
    }
    case "vouch": {
      const v = ev.raw;
      const voucher = v["voucher"] as Record<string, string>;
      const newAgent = v["newAgent"] as Record<string, string>;
      const vName = voucher["name"] || shortAddr(voucher["id"]);
      const nName = newAgent["name"] || shortAddr(newAgent["id"]);
      const stake = v["stakeAmount"] ? `  ${weiToUsdc(v["stakeAmount"] as string)} USDC staked` : "";
      return chalk.magenta(`${ts}  🔗 ${vName} vouched for ${nName}${stake}`);
    }
  }
}

export interface FeedOptions {
  limit?: string;
  live?: boolean;
  type?: string;
  json?: boolean;
}

export async function runFeed(opts: FeedOptions): Promise<void> {
  const limit = parseInt(opts.limit ?? "20", 10);
  const typeFilter = opts.type;

  const events = await fetchFeedEvents(limit, typeFilter);

  if (opts.json) {
    console.log(JSON.stringify(events, null, 2));
    if (!opts.live) return;
  } else {
    for (const ev of [...events].reverse()) {
      console.log(renderFeedEvent(ev));
    }
    if (!opts.live) return;
  }

  // Live mode — keep process alive and poll every 30s
  process.stdin.resume();
  let lastTs = events.length > 0 ? events[0].timestamp : Math.floor(Date.now() / 1000);

  const interval = setInterval(async () => {
    try {
      const newEvents = await fetchFeedEvents(limit, typeFilter, lastTs);
      if (newEvents.length > 0) {
        if (opts.json) {
          console.log(JSON.stringify(newEvents, null, 2));
        } else {
          console.log(chalk.dim("─".repeat(50)));
          for (const ev of [...newEvents].reverse()) {
            console.log(renderFeedEvent(ev));
          }
        }
        lastTs = newEvents[0].timestamp;
      }
    } catch {
      if (!opts.json) console.log(chalk.dim("  (subgraph unavailable)"));
    }
  }, 30_000);

  process.on("SIGINT", () => {
    clearInterval(interval);
    process.exit(0);
  });
}

export function registerFeedCommand(program: Command): void {
  program
    .command("feed")
    .description("Live terminal feed of recent Arena events")
    .option("--limit <n>", "Number of events to show", "20")
    .option("--live", "Poll every 30s for new events")
    .option("--type <type>", "Filter by event type: handshake|hire|fulfill|vouch")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        await runFeed(opts as FeedOptions);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if ((opts as FeedOptions).json) {
          console.log(JSON.stringify({ error: "Subgraph unavailable", details: msg }));
        } else {
          console.error(chalk.red(`Subgraph unavailable: ${msg}`));
        }
        process.exit(1);
      }
    });
}
