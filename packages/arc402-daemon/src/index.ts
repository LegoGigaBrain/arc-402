#!/usr/bin/env node
/**
 * @arc402/daemon — entrypoint.
 *
 * Phase 1.2 (Spec 46 §16 Pattern 1): Two-process split.
 *   - arc402-signer: isolated child, holds machine key, Unix socket only
 *   - arc402-api:    public child, HTTPS/Express, zero machine key access
 *
 * The machine key env var is stripped from the API process environment
 * to enforce the isolation at the OS level.
 *
 * Legacy single-process mode preserved when --legacy flag is passed.
 */
import { fork, type ChildProcess } from "child_process";
import * as path from "path";

const legacy =
  process.argv.includes("--legacy") ||
  process.env.ARC402_DAEMON_LEGACY === "1";

const foreground =
  process.argv.includes("--foreground") ||
  process.env.ARC402_DAEMON_FOREGROUND === "1";

if (legacy) {
  // ── Legacy single-process mode (Phase 1.1 server.ts) ──────────────────────
  // Preserved for backward compatibility. Removed in a future release.
  const { runDaemon } = require("./server") as { runDaemon: (fg: boolean) => Promise<void> };
  runDaemon(foreground).catch((err: unknown) => {
    process.stderr.write(
      `Daemon fatal error: ${err instanceof Error ? err.message : String(err)}\n`
    );
    process.exit(1);
  });
} else {
  // ── Two-process split ──────────────────────────────────────────────────────
  startTwoProcessDaemon();
}

function startTwoProcessDaemon(): void {
  const signerPath = path.join(__dirname, "signer.js");
  const apiPath    = path.join(__dirname, "api.js");

  // ── Start signer first (creates the Unix socket) ──────────────────────────
  // Signer inherits full env (including ARC402_MACHINE_KEY).
  const signerProcess: ChildProcess = fork(signerPath, [], {
    stdio: foreground ? "inherit" : "pipe",
  });

  if (!foreground && signerProcess.stdout) {
    signerProcess.stdout.on("data", (d: Buffer) => {
      process.stdout.write(d);
    });
  }
  if (!foreground && signerProcess.stderr) {
    signerProcess.stderr.on("data", (d: Buffer) => {
      process.stderr.write(d);
    });
  }

  signerProcess.on("exit", (code) => {
    process.stderr.write(`[index] signer exited with code ${String(code)} — shutting down\n`);
    apiProcess?.kill("SIGTERM");
    process.exit(1);
  });

  // ── Start API after 1s (socket must exist before api connects) ────────────
  // API env: strip ARC402_MACHINE_KEY so the API process cannot access it.
  let apiProcess: ChildProcess | undefined;

  setTimeout(() => {
    const apiEnv: NodeJS.ProcessEnv = { ...process.env };

    // Determine which env var holds the machine key and remove it
    const machineKeyVar = apiEnv.ARC402_MACHINE_KEY
      ? "ARC402_MACHINE_KEY"
      : Object.keys(apiEnv).find(k => k.startsWith("ARC402_") && apiEnv[k]?.startsWith("0x"));
    if (machineKeyVar) {
      delete apiEnv[machineKeyVar];
    }
    // Also strip any private key look-alikes under common names
    for (const k of ["PRIVATE_KEY", "MACHINE_PRIVATE_KEY", "ARC402_SIGNER_KEY"]) {
      delete apiEnv[k];
    }

    apiProcess = fork(apiPath, [], {
      env: apiEnv,
      stdio: foreground ? "inherit" : "pipe",
    });

    if (!foreground && apiProcess.stdout) {
      apiProcess.stdout.on("data", (d: Buffer) => {
        process.stdout.write(d);
      });
    }
    if (!foreground && apiProcess.stderr) {
      apiProcess.stderr.on("data", (d: Buffer) => {
        process.stderr.write(d);
      });
    }

    apiProcess.on("exit", (code) => {
      process.stderr.write(`[index] api exited with code ${String(code)} — shutting down\n`);
      signerProcess.kill("SIGTERM");
      process.exit(1);
    });

    process.stdout.write("[index] Two-process daemon started (signer + api)\n");
  }, 1000);

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  function shutdown(signal: string): void {
    process.stderr.write(`[index] ${signal} received — shutting down\n`);
    apiProcess?.kill("SIGTERM");
    signerProcess.kill("SIGTERM");
    setTimeout(() => process.exit(0), 3000);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
}
