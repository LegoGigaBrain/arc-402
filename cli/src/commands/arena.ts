import { Command } from "commander";
import chalk from "chalk";
import { c } from "../ui/colors";
import { registerArenaV2Commands, getArenaAddresses } from "./arena-v2";

export { getArenaAddresses };

const SUBGRAPH_URL = "https://api.studio.thegraph.com/query/1744310/arc-402/v0.3.0";

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
            console.error(' ' + c.warning + c.white(` ${msg}`));
          }
          process.exit(1);
        }

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
          // ignore
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
        console.log(chalk.dim("  Subgraph: v0.3.0 · synced"));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (opts.json) {
          console.log(JSON.stringify({ error: "Subgraph unavailable", details: msg }));
        } else {
          console.error(' ' + c.failure + c.white(` Subgraph unavailable: ${msg}`));
        }
        process.exit(1);
      }
    });

  // ─── Register all Arena v2 commands (feed, profile, card, status, inbox,
  //     discover, trending, rounds, round, join, standings, history, result,
  //     claim, watchtower, squad, briefing, newsletter, setup) ─────────────────

  registerArenaV2Commands(arena, gql);
}
