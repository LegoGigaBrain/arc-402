import { Command } from "commander";
import chalk from "chalk";
import readline from "readline";
import {
  fetchDaemonAgreements,
  fetchDaemonHealth,
  fetchDaemonWalletStatus,
  fetchDaemonWorkroomStatus,
  type DaemonCommerceClientOptions,
} from "../commerce-client";

type ChatOptions = {
  daemonUrl?: string;
  harness?: string;
  model?: string;
};

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
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function truncateAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

function formatAgreementStatus(value: unknown): string {
  const raw = typeof value === "string" ? value : typeof value === "number" ? String(value) : "unknown";
  return raw.toUpperCase();
}

async function renderStatus(options: DaemonCommerceClientOptions): Promise<void> {
  const [health, wallet, workroom, agreements] = await Promise.all([
    fetchDaemonHealth(options),
    fetchDaemonWalletStatus(options),
    fetchDaemonWorkroomStatus(options),
    fetchDaemonAgreements(options),
  ]);

  console.log(chalk.bold("◈ ARC-402 Commerce Shell"));
  console.log(
    `  Wallet: ${truncateAddress(wallet.wallet)}  Chain: ${wallet.chainId}  Workroom: ${workroom.status}  Agreements: ${agreements.agreements.length}`
  );
  console.log(`  Daemon: ${truncateAddress(wallet.daemonId)}  RPC: ${wallet.rpcUrl}`);
  console.log(`  Health: ${health.ok ? chalk.green("ok") : chalk.red("down")}`);
}

async function renderAgreements(options: DaemonCommerceClientOptions): Promise<void> {
  const result = await fetchDaemonAgreements(options);
  console.log(chalk.bold("◈ Agreements"));
  if (result.agreements.length === 0) {
    console.log("  No agreements found.");
    return;
  }

  for (const agreement of result.agreements.slice(0, 10)) {
    const id = agreement["agreement_id"] ?? agreement["id"] ?? "n/a";
    const counterparty =
      agreement["provider_address"] ??
      agreement["hirer_address"] ??
      agreement["counterparty"] ??
      "unknown";
    const status = formatAgreementStatus(agreement["status"]);
    console.log(`  #${String(id).padEnd(6)} ${status.padEnd(22)} ${truncateAddress(String(counterparty))}`);
  }
}

async function renderWorkroom(options: DaemonCommerceClientOptions): Promise<void> {
  const result = await fetchDaemonWorkroomStatus(options);
  console.log(chalk.bold("◈ Workroom"));
  console.log(`  Status: ${result.status}`);
}

function printHelp(): void {
  console.log(chalk.bold("◈ Commerce REPL"));
  console.log("  status            Refresh wallet/workroom/agreement context from the daemon API");
  console.log("  agreements        List recent agreements from the daemon API");
  console.log("  workroom          Show current workroom status");
  console.log("  /<command>        Run any existing arc402 CLI command inside the shell");
  console.log("  help              Show this help");
  console.log("  exit              Leave the shell");
  console.log("");
  console.log(chalk.dim("Thin Phase 5A surface: daemon-backed context is wired now; autonomous tool routing lands in later phases."));
}

async function dispatchCliCommand(line: string): Promise<void> {
  const tokens = parseTokens(line);
  if (tokens.length === 0) return;

  const { createProgram } = await import("../program");
  const program = createProgram();
  program.exitOverride();
  program.configureOutput({
    writeOut: (str) => process.stdout.write(str),
    writeErr: (str) => process.stderr.write(str),
  });

  try {
    await program.parseAsync(["node", "arc402", ...tokens]);
  } catch (err) {
    const error = err as { code?: string; message?: string };
    if (
      error.code === "commander.helpDisplayed" ||
      error.code === "commander.version" ||
      error.code === "commander.executeSubCommandAsync"
    ) {
      return;
    }
    throw err;
  }
}

function inferIntent(input: string): "status" | "agreements" | "workroom" | "help" | "unknown" {
  const normalized = input.trim().toLowerCase();
  if (normalized === "help") return "help";
  if (normalized.includes("agreement")) return "agreements";
  if (normalized.includes("workroom")) return "workroom";
  if (normalized.includes("status") || normalized.includes("wallet") || normalized.includes("balance")) return "status";
  return "unknown";
}

export function registerChatCommand(program: Command): void {
  program
    .command("chat")
    .description("Launch the initial ARC-402 Commerce REPL surface")
    .option("--daemon-url <url>", "Override the daemon API base URL")
    .option("--harness <name>", "Reserved for later harness routing", "local")
    .option("--model <name>", "Reserved for later harness routing")
    .action(async (opts: ChatOptions) => {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        throw new Error("arc402 chat requires an interactive TTY");
      }

      const clientOptions: DaemonCommerceClientOptions = { baseUrl: opts.daemonUrl };

      console.log(chalk.cyanBright("◈"), chalk.bold("ARC-402 Commerce Shell"));
      console.log(
        chalk.dim(
          `Harness: ${opts.harness ?? "local"}${opts.model ? `  Model: ${opts.model}` : ""}  Use /<command> for direct CLI commands`
        )
      );

      try {
        await renderStatus(clientOptions);
      } catch (err) {
        console.log(
          chalk.yellow(
            `  Daemon context unavailable: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      }

      printHelp();

      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: `${chalk.cyanBright(">")} `,
        terminal: true,
      });

      rl.prompt();

      rl.on("line", async (line) => {
        const trimmed = line.trim();

        if (!trimmed) {
          rl.prompt();
          return;
        }

        try {
          if (trimmed === "exit" || trimmed === "quit") {
            rl.close();
            return;
          }

          if (trimmed.startsWith("/")) {
            await dispatchCliCommand(trimmed.slice(1));
            console.log("");
            rl.prompt();
            return;
          }

          switch (inferIntent(trimmed)) {
            case "help":
              printHelp();
              break;
            case "status":
              await renderStatus(clientOptions);
              break;
            case "agreements":
              await renderAgreements(clientOptions);
              break;
            case "workroom":
              await renderWorkroom(clientOptions);
              break;
            default:
              console.log("  Thin Phase 5A shell understands status/agreement/workroom intents.");
              console.log("  Use `/hire`, `/discover`, `/subscribe`, `/compute ...`, or another CLI command for direct execution.");
              break;
          }
        } catch (err) {
          console.log(`  ${chalk.red(err instanceof Error ? err.message : String(err))}`);
        }

        console.log("");
        rl.prompt();
      });

      rl.on("close", () => {
        console.log(chalk.dim("Commerce shell closed."));
        process.exit(0);
      });

      await new Promise<never>(() => {
        // readline keeps the process alive until close()
      });
    });
}
