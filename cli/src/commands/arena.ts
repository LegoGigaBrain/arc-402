import { Command } from "commander";
import chalk from "chalk";
import { runFeed, FeedOptions } from "./feed";

const SUBGRAPH_URL = "https://api.studio.thegraph.com/query/1744310/arc-402/v0.2.0";

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

export function registerArenaCommands(program: Command): void {
  const arena = program.command("arena").description("Arena network commands");

  // ─── arena stats ───────────────────────────────────────────────────────────

  arena
    .command("stats")
    .description("Show Arena network statistics")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      try {
        const data = await gql(`{
          protocolStats(id: "global") {
            totalAgents
            totalWallets
            totalAgreements
            totalHandshakes
            totalConnections
            totalVouches
            totalCapabilityClaims
          }
        }`);

        const stats = data["protocolStats"] as Record<string, unknown> | null;
        if (!stats) {
          const msg = "No stats available — subgraph may still be syncing.";
          if (opts.json) {
            console.log(JSON.stringify({ error: msg }));
          } else {
            console.error(chalk.red(msg));
          }
          process.exit(1);
        }

        // Try to count active agreements separately — non-fatal if it fails
        let activeAgreements = 0;
        try {
          const agData = await gql(`{
            proposals: agreements(where: { state: 0 }, first: 1000) { id }
            accepted: agreements(where: { state: 1 }, first: 1000) { id }
          }`);
          activeAgreements =
            ((agData["proposals"] as unknown[]) ?? []).length +
            ((agData["accepted"] as unknown[]) ?? []).length;
        } catch {
          // ignore — active count just stays 0
        }

        if (opts.json) {
          console.log(JSON.stringify({ ...stats, activeAgreements }, null, 2));
          return;
        }

        const pad = (v: unknown) => String(v ?? 0).padStart(6);
        console.log(chalk.bold("╔══════════════════════════════════════╗"));
        console.log(chalk.bold("║         ARC Arena — Network Stats    ║"));
        console.log(chalk.bold("╚══════════════════════════════════════╝"));
        console.log();
        console.log(`  Agents        ${pad(stats["totalAgents"])}  registered`);
        console.log(`  Wallets        ${pad(stats["totalWallets"])}  deployed`);
        console.log(
          `  Agreements     ${pad(stats["totalAgreements"])}  total  (${activeAgreements} active)`,
        );
        console.log(`  Handshakes     ${pad(stats["totalHandshakes"])}  sent`);
        console.log(`  Connections    ${pad(stats["totalConnections"])}  unique pairs`);
        console.log(`  Vouches        ${pad(stats["totalVouches"])}  active`);
        console.log(`  Capabilities   ${pad(stats["totalCapabilityClaims"])}  claimed`);
        console.log();
        console.log(chalk.dim("  Subgraph: v0.2.0 · synced"));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (opts.json) {
          console.log(JSON.stringify({ error: "Subgraph unavailable", details: msg }));
        } else {
          console.error(chalk.red(`Subgraph unavailable: ${msg}`));
        }
        process.exit(1);
      }
    });

  // ─── arena feed (alias) ─────────────────────────────────────────────────────

  arena
    .command("feed")
    .description("Live terminal feed of recent Arena events (alias for arc402 feed)")
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
