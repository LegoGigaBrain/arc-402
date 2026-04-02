import { Command } from "commander";
import chalk from "chalk";
import * as fs from "fs";
import {
  fetchDaemonAgreements,
  fetchDaemonHealth,
  fetchDaemonWalletStatus,
  fetchDaemonWorkroomStatus,
  resolveChatDaemonTarget,
  type DaemonCommerceClientOptions,
  type ResolvedChatDaemonTarget,
} from "../commerce-client";
import { configExists, loadConfig } from "../config";
import { DAEMON_TOML, loadDaemonConfig } from "../daemon/config";

type SummaryHeading =
  | { type: "title"; text: string }
  | { type: "upgrade"; from: string; to: string };

export type OperatorSummaryOptions = {
  baseUrl?: string;
  heading?: SummaryHeading;
  includeGuidance?: boolean;
};

function readConfiguredWallet(): string | undefined {
  if (fs.existsSync(DAEMON_TOML)) {
    try {
      const wallet = loadDaemonConfig().wallet.contract_address.trim();
      if (wallet) return wallet;
    } catch {
      // Ignore invalid daemon config here and fall back to CLI config.
    }
  }

  if (configExists()) {
    try {
      return loadConfig().walletContractAddress?.trim() || undefined;
    } catch {
      // Ignore invalid CLI config and fall back to unknown.
    }
  }

  return undefined;
}

function renderDaemonGuidance(target: ResolvedChatDaemonTarget): void {
  if (target.mode !== "local") {
    console.log("Next steps:");
    console.log("  1. Confirm the remote daemon URL is correct and reachable.");
    console.log("  2. Re-run `arc402 chat --setup` if you want to switch back to a local node.");
    return;
  }

  console.log("Next steps:");
  if (!fs.existsSync(DAEMON_TOML)) {
    console.log("  1. Run `arc402 daemon init` or `arc402 setup` to create ~/.arc402/daemon.toml.");
    console.log("  2. Fill in wallet + node settings, then start the node with `arc402 daemon start`.");
  } else {
    console.log("  1. Start the local node with `arc402 daemon start`.");
    console.log("  2. If it exits immediately, inspect `arc402 daemon logs` for the startup guidance.");
  }
  console.log("  3. Run `arc402 chat --setup` and choose Remote if this machine should not host the node.");
}

export async function renderOperatorSummary(options: OperatorSummaryOptions = {}): Promise<void> {
  const target = resolveChatDaemonTarget({ explicitBaseUrl: options.baseUrl });
  const heading = options.heading ?? { type: "title", text: "◈ ARC-402 status" };

  if (heading.type === "upgrade") {
    console.log(chalk.bold(`◈ Upgraded from ${heading.from} → ${heading.to}`));
  } else {
    console.log(chalk.bold(heading.text));
  }

  try {
    const [health, wallet, workroom, agreements] = await Promise.all([
      fetchDaemonHealth({ baseUrl: target.baseUrl }),
      fetchDaemonWalletStatus({ baseUrl: target.baseUrl }),
      fetchDaemonWorkroomStatus({ baseUrl: target.baseUrl }),
      fetchDaemonAgreements({ baseUrl: target.baseUrl }),
    ]);

    console.log(`  Wallet:    ${wallet.wallet}`);
    console.log(`  Daemon:    ${health.ok ? chalk.green("online") : chalk.red("offline")} (${wallet.daemonId})`);
    console.log(`  Workroom:  ${workroom.status}`);
    console.log(`  Node:      ${target.mode} (${target.baseUrl})`);
    console.log(`  Chain:     ${wallet.chainId} via ${wallet.rpcUrl}`);
    console.log(`  Agreements ${agreements.agreements.length}`);
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallbackWallet = readConfiguredWallet();
    const daemonState = target.mode === "local"
      ? fs.existsSync(DAEMON_TOML)
        ? "configured locally but not responding"
        : "not configured on this machine"
      : "remote node unreachable";

    console.log(`  Wallet:    ${fallbackWallet ?? "not configured"}`);
    console.log(`  Daemon:    ${chalk.yellow(daemonState)}`);
    console.log(`  Workroom:  waiting for daemon context`);
    console.log(`  Node:      ${target.mode} (${target.baseUrl})`);
    console.log(`  Detail:    ${message}`);

    if (options.includeGuidance ?? true) {
      console.log("");
      renderDaemonGuidance(target);
    }
  }
}

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show top-level operator status for the configured node")
    .option("--daemon-url <url>", "Override the daemon API base URL")
    .action(async (opts: { daemonUrl?: string }) => {
      await renderOperatorSummary({
        baseUrl: opts.daemonUrl,
        heading: { type: "title", text: "◈ ARC-402 status" },
        includeGuidance: true,
      });
    });
}
