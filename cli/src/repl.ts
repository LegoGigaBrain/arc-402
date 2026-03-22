import chalk from "chalk";
import fs from "fs";
import path from "path";
import os from "os";
import readline from "readline";
import { createProgram } from "./program";
import { getBannerLines, BannerConfig } from "./ui/banner";
import { c } from "./ui/colors";

// ─── Config helpers ────────────────────────────────────────────────────────────

const CONFIG_PATH = path.join(os.homedir(), ".arc402", "config.json");

async function loadBannerConfig(): Promise<BannerConfig | undefined> {
  if (!fs.existsSync(CONFIG_PATH)) return undefined;
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) as {
      network?: string;
      walletContractAddress?: string;
    };
    const cfg: BannerConfig = { network: raw.network };
    if (raw.walletContractAddress) {
      const w = raw.walletContractAddress;
      cfg.wallet = `${w.slice(0, 6)}...${w.slice(-4)}`;
    }
    return cfg;
  } catch {
    return undefined;
  }
}

// ─── Prompt ────────────────────────────────────────────────────────────────────

const PROMPT =
  chalk.cyanBright("◈") +
  " " +
  chalk.dim("arc402") +
  " " +
  chalk.white(">") +
  " ";

// ─── Shell-style tokenizer ────────────────────────────────────────────────────

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
    } else if (ch === " ") {
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

// ─── REPL entry point (basic readline fallback) ────────────────────────────────

export async function startREPL(): Promise<void> {
  if (!process.stdout.isTTY) {
    const bannerCfg = await loadBannerConfig();
    for (const line of getBannerLines(bannerCfg)) {
      process.stdout.write(line + "\n");
    }
    process.stdout.write(
      "Interactive TUI requires a TTY. Use arc402 <command> directly.\n"
    );
    return;
  }

  const bannerCfg = await loadBannerConfig();
  for (const line of getBannerLines(bannerCfg)) {
    process.stdout.write(line + "\n");
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: PROMPT,
    terminal: true,
  });

  rl.prompt();

  rl.on("line", async (input) => {
    const trimmed = input.trim();

    if (!trimmed) {
      rl.prompt();
      return;
    }

    if (trimmed === "exit" || trimmed === "quit") {
      process.stdout.write(
        " " + chalk.cyanBright("◈") + chalk.dim(" goodbye") + "\n"
      );
      process.exit(0);
    }

    if (trimmed === "clear") {
      process.stdout.write("\x1b[2J\x1b[H");
      for (const line of getBannerLines(bannerCfg)) {
        process.stdout.write(line + "\n");
      }
      rl.prompt();
      return;
    }

    // Dispatch to commander
    const tokens = parseTokens(trimmed);
    const prog = createProgram();
    prog.exitOverride();
    prog.configureOutput({
      writeOut: (str) => process.stdout.write(str),
      writeErr: (str) => process.stderr.write(str),
    });

    try {
      await prog.parseAsync(["node", "arc402", ...tokens]);
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (
        e.code === "commander.helpDisplayed" ||
        e.code === "commander.version" ||
        e.code === "commander.executeSubCommandAsync"
      ) {
        // already written
      } else if (e.code === "commander.unknownCommand") {
        process.stdout.write(
          `\n ${c.failure} ${chalk.red(`Unknown command: ${chalk.white(tokens[0])}`)} \n`
        );
        process.stdout.write(chalk.dim("  Type 'help' for available commands\n"));
      } else {
        process.stdout.write(
          `\n ${c.failure} ${chalk.red(e.message ?? String(err))}\n`
        );
      }
    }

    process.stdout.write("\n");
    rl.prompt();
  });

  rl.on("close", () => {
    process.stdout.write(
      "\n " + chalk.cyanBright("◈") + chalk.dim(" goodbye") + "\n"
    );
    process.exit(0);
  });

  // Keep alive
  await new Promise<never>(() => {
    /* readline keeps event loop alive */
  });
}
