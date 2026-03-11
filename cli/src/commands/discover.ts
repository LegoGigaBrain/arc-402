import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { ethers } from "ethers";
import { loadConfig } from "../config";
import { getClient } from "../client";
import { AGENT_REGISTRY_ABI } from "../abis";
import { AgentRow, printAgentTable } from "../utils/format";

export function registerDiscoverCommand(program: Command): void {
  program
    .command("discover")
    .description("Discover registered agents on-chain")
    .option("--capability <cap>", "Filter by capability (substring match)")
    .option("--service-type <type>", "Filter by service type")
    .option("--min-trust <score>", "Minimum trust score", "0")
    .option("--limit <n>", "Maximum results", "10")
    .option("--json", "Output raw JSON")
    .action(async (opts) => {
      const config = loadConfig();
      const { provider } = await getClient(config);
      const registry = new ethers.Contract(
        config.agentRegistryAddress,
        AGENT_REGISTRY_ABI,
        provider
      );

      const spinner = ora("Fetching agents from chain…").start();

      try {
        const count = Number(await registry.agentCount());
        if (count === 0) {
          spinner.succeed("No agents registered yet.");
          return;
        }

        const limit = Math.min(count, parseInt(opts.limit, 10));
        const minTrust = parseInt(opts.minTrust, 10);

        // Fetch all agent addresses
        const addresses: string[] = [];
        for (let i = 0; i < count; i++) {
          addresses.push(await registry.getAgentAtIndex(i));
        }

        // Fetch all agent data in parallel
        const results = await Promise.allSettled(
          addresses.map(async (addr) => {
            const [info, score] = await Promise.all([
              registry.getAgent(addr),
              registry.getTrustScore(addr),
            ]);
            return {
              address: String(info.wallet),
              name: String(info.name),
              capabilities: [...info.capabilities] as string[],
              serviceType: String(info.serviceType),
              trust: Number(score),
              active: Boolean(info.active),
            } as AgentRow;
          })
        );

        let agents: AgentRow[] = results
          .filter(
            (r): r is PromiseFulfilledResult<AgentRow> => r.status === "fulfilled"
          )
          .map((r) => r.value);

        // Filter
        if (opts.capability) {
          const cap = opts.capability.toLowerCase();
          agents = agents.filter((a) =>
            a.capabilities.some((c) => c.toLowerCase().includes(cap))
          );
        }
        if (opts.serviceType) {
          const st = opts.serviceType.toLowerCase();
          agents = agents.filter((a) =>
            a.serviceType.toLowerCase().includes(st)
          );
        }
        agents = agents.filter((a) => a.trust >= minTrust);

        // Sort by trust descending
        agents.sort((a, b) => b.trust - a.trust);

        // Limit
        agents = agents.slice(0, limit);

        spinner.succeed(`Found ${agents.length} agent(s)`);

        if (agents.length === 0) {
          console.log(chalk.gray("  No agents match the given filters."));
          return;
        }

        if (opts.json) {
          console.log(JSON.stringify(agents, null, 2));
          return;
        }

        printAgentTable(agents);
      } catch (err: unknown) {
        spinner.fail(chalk.red("Discovery failed"));
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
