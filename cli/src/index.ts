#!/usr/bin/env node
import { createProgram } from "./program";
import { startREPL } from "./repl";
import { configExists, loadConfig, saveConfig } from "./config";

// ── Upgrade safety check ────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-var-requires
const currentVersion: string = (require("../package.json") as { version: string }).version;

function checkUpgrade(): void {
  if (!configExists()) return;
  try {
    const config = loadConfig();
    const prev = config.lastCliVersion;
    if (prev && prev !== currentVersion) {
      // Compare semver loosely — just print if different
      console.log(`◈ Upgraded from ${prev} → ${currentVersion}`);
    }
    if (config.lastCliVersion !== currentVersion) {
      // Never overwrite existing fields — only update lastCliVersion
      saveConfig({ ...config, lastCliVersion: currentVersion });
    }
  } catch {
    // Never crash on upgrade check
  }
}

const printMode = process.argv.includes("--print");

if (printMode) {
  // --print mode: skip REPL entirely, suppress ANSI/spinners, run command, exit.
  // Used by OpenClaw agents running arc402 commands via ACP.
  process.argv = process.argv.filter((a) => a !== "--print");
  process.env["NO_COLOR"] = "1";
  process.env["FORCE_COLOR"] = "0";
  process.env["ARC402_PRINT"] = "1";
  checkUpgrade();
  const program = createProgram();
  void program.parseAsync(process.argv).then(() => process.exit(0)).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
} else if (process.argv.length <= 2) {
  // No subcommand — enter interactive REPL
  checkUpgrade();
  void startREPL();
} else {
  // One-shot mode — arc402 wallet deploy still works as usual
  checkUpgrade();
  const program = createProgram();
  program.parse(process.argv);
}
