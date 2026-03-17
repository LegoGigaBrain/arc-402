import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import * as net from "net";
import * as os from "os";
import { spawn, spawnSync } from "child_process";
import { ethers } from "ethers";
import prompts from "prompts";
import { parse as parseToml } from "smol-toml";
import { loadConfig } from "../config";
import { requireSigner } from "../client";
import { SERVICE_AGREEMENT_ABI } from "../abis";
import {
  DAEMON_DIR,
  DAEMON_PID,
  DAEMON_LOG,
  DAEMON_SOCK,
  DAEMON_TOML,
  TEMPLATE_DAEMON_TOML,
} from "../daemon/config";

// ─── Constants ────────────────────────────────────────────────────────────────

const CHANNEL_STATES_DIR = path.join(os.homedir(), ".arc402", "channel-states");
const OPENSHELL_TOML = path.join(os.homedir(), ".arc402", "openshell.toml");

// ─── OpenShell helpers ────────────────────────────────────────────────────────

interface OpenShellConfig {
  sandbox: { name: string; policy?: string; providers?: string[] };
}

function readOpenShellConfig(): OpenShellConfig | null {
  if (!fs.existsSync(OPENSHELL_TOML)) return null;
  try {
    const raw = fs.readFileSync(OPENSHELL_TOML, "utf-8");
    const parsed = parseToml(raw) as Record<string, unknown>;
    const sb = parsed.sandbox as Record<string, unknown> | undefined;
    if (!sb || typeof sb.name !== "string") return null;
    return { sandbox: { name: sb.name, policy: sb.policy as string | undefined, providers: sb.providers as string[] | undefined } };
  } catch {
    return null;
  }
}

// ─── Harness registry ─────────────────────────────────────────────────────────

const HARNESS_REGISTRY: Record<string, string> = {
  openclaw: "openclaw run {task}",
  claude:   "claude --dangerously-skip-permissions {task}",
  codex:    "codex {task}",
  opencode: "opencode {task}",
};

// ChannelStatus enum (mirrors ServiceAgreement.ChannelStatus)
const ChannelStatus = { OPEN: 0, CLOSING: 1, CHALLENGED: 2, SETTLED: 3 } as const;

// ─── Local state store ────────────────────────────────────────────────────────

interface LocalChannelState {
  channelId: string;
  sequenceNumber: string | number;
  callCount: string | number;
  cumulativePayment: string;
  token: string;
  timestamp: string | number;
  clientSig: string;
  providerSig: string;
}

function getStatePath(channelId: string): string {
  return path.join(CHANNEL_STATES_DIR, `${channelId}.json`);
}

function loadLocalState(channelId: string): LocalChannelState | null {
  const p = getStatePath(channelId);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as LocalChannelState;
  } catch {
    return null;
  }
}

/**
 * ABI-encode a ChannelState for submission to challengeChannel().
 */
function encodeChannelState(state: LocalChannelState): string {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(bytes32,uint256,uint256,uint256,address,uint256,bytes,bytes)"],
    [[
      state.channelId,
      BigInt(state.sequenceNumber),
      BigInt(state.callCount),
      BigInt(state.cumulativePayment),
      state.token,
      BigInt(state.timestamp),
      state.clientSig,
      state.providerSig,
    ]]
  );
}

// ─── Channel-watch loop ───────────────────────────────────────────────────────

async function runChannelWatchLoop(opts: {
  pollInterval: number;
  wallet: string;
  contract: ethers.Contract;
  json: boolean;
}): Promise<void> {
  const { pollInterval, wallet, contract, json } = opts;

  const log = (data: Record<string, unknown> | string) => {
    const out: Record<string, unknown> =
      typeof data === "string"
        ? { msg: data, ts: Date.now() }
        : { ...data, ts: Date.now() };
    if (json) {
      console.log(JSON.stringify(out));
    } else {
      const ts = new Date(out.ts as number).toISOString();
      if ("msg" in out) {
        console.log(`[${ts}] ${out.msg}`);
      } else {
        const { ts: _ts, ...rest } = out;
        console.log(`[${ts}] ${JSON.stringify(rest)}`);
      }
    }
  };

  log(`channel-watch started for ${wallet}`);
  log(`poll interval: ${pollInterval}ms`);
  log(`state store: ${CHANNEL_STATES_DIR}`);

  const poll = async () => {
    try {
      const clientChannels: string[] = await contract.getChannelsByClient(wallet);
      const providerChannels: string[] = await contract.getChannelsByProvider(wallet);
      const allChannels = [...new Set([...clientChannels, ...providerChannels])];

      for (const channelId of allChannels) {
        try {
          const ch = await contract.getChannel(channelId);
          const status = Number(ch.status);

          if (status !== ChannelStatus.CLOSING) continue;

          const now = Math.floor(Date.now() / 1000);
          const challengeExpiry = Number(ch.challengeExpiry);
          if (now > challengeExpiry) continue;

          const localState = loadLocalState(channelId);
          if (!localState) {
            log({ event: "no_local_state", channelId });
            continue;
          }

          const localSeq = BigInt(localState.sequenceNumber);
          const chainSeq = BigInt(ch.lastSequenceNumber);

          if (localSeq > chainSeq) {
            log({
              event: "stale_close_detected",
              channelId,
              chainSeq: chainSeq.toString(),
              localSeq: localSeq.toString(),
              windowExpiresAt: new Date(challengeExpiry * 1000).toISOString(),
            });

            const encoded = encodeChannelState(localState);
            const tx = await contract.challengeChannel(channelId, encoded);
            const receipt = await tx.wait();
            log({ event: "challenge_submitted", channelId, txHash: receipt.hash });
          }
        } catch (err) {
          log({ event: "channel_error", channelId, error: String(err) });
        }
      }
    } catch (err) {
      log({ event: "poll_error", error: String(err) });
    }
  };

  await poll();
  const intervalId = setInterval(() => { void poll(); }, pollInterval);

  process.on("SIGINT", () => {
    clearInterval(intervalId);
    log("channel-watch stopped");
    process.exit(0);
  });

  process.stdin.resume();
}

// ─── IPC helper ───────────────────────────────────────────────────────────────

type IpcResponse = { ok: boolean; data?: unknown; error?: string };

function sendIpcCommand(cmd: Record<string, unknown>): Promise<IpcResponse> {
  if (!fs.existsSync(DAEMON_SOCK)) {
    console.error("Daemon is not running. Start with: arc402 daemon start");
    process.exit(1);
  }

  return new Promise((resolve, reject) => {
    const socket = net.createConnection(DAEMON_SOCK, () => {
      socket.write(JSON.stringify(cmd) + "\n");
    });

    let buf = "";
    socket.on("data", (data) => {
      buf += data.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as IpcResponse;
          socket.destroy();
          resolve(parsed);
        } catch {
          socket.destroy();
          reject(new Error("Invalid JSON response from daemon"));
        }
        return;
      }
    });

    socket.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ENOENT" ||
          (err as NodeJS.ErrnoException).code === "ECONNREFUSED") {
        console.error("Daemon is not running. Start with: arc402 daemon start");
        process.exit(1);
      }
      reject(err);
    });

    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error("IPC timeout — daemon did not respond within 5 seconds"));
    });
  });
}

// ─── PID helpers ─────────────────────────────────────────────────────────────

function readPid(): number | null {
  if (!fs.existsSync(DAEMON_PID)) return null;
  const raw = fs.readFileSync(DAEMON_PID, "utf-8").trim();
  const pid = parseInt(raw, 10);
  return isNaN(pid) ? null : pid;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ─── Start helpers ────────────────────────────────────────────────────────────

async function startDaemonBackground(sandboxName?: string): Promise<void> {
  // Resolve the compiled daemon entry point
  const daemonEntry = path.join(__dirname, "..", "daemon", "index.js");
  if (!fs.existsSync(daemonEntry)) {
    console.error(`Daemon entry not found at ${daemonEntry}. Run: npm run build`);
    process.exit(1);
  }

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ARC402_DAEMON_PROCESS: "1",
  };

  let child: ReturnType<typeof spawn>;
  if (sandboxName) {
    // OpenShell sandbox mode — credentials injected by providers, run inside sandbox
    child = spawn("openshell", [
      "sandbox", "exec", sandboxName, "--",
      process.execPath, daemonEntry,
    ], {
      detached: true,
      stdio: "ignore",
      env: childEnv,
    });
  } else {
    // Direct mode — pass credentials from CLI config
    let machineKey: string | undefined;
    let telegramBotToken: string | undefined;
    let telegramChatId: string | undefined;
    try {
      const config = loadConfig();
      machineKey = config.privateKey;
      telegramBotToken = config.telegramBotToken;
      telegramChatId = config.telegramChatId;
    } catch {
      // Config load is optional here — daemon will use its own daemon.toml
    }
    if (machineKey) childEnv["ARC402_MACHINE_KEY"] = machineKey;
    if (telegramBotToken) childEnv["TELEGRAM_BOT_TOKEN"] = telegramBotToken;
    if (telegramChatId) childEnv["TELEGRAM_CHAT_ID"] = telegramChatId;

    child = spawn(process.execPath, [daemonEntry], {
      detached: true,
      stdio: "ignore",
      env: childEnv,
    });
  }
  child.unref();

  // Wait up to 5 seconds for PID file to appear
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    const pid = readPid();
    if (pid && isProcessAlive(pid)) {
      console.log(`ARC-402 daemon started. PID: ${pid}`);
      console.log(`Log: ${DAEMON_LOG}`);
      return;
    }
  }

  console.error("Daemon did not start within 5 seconds. Check logs:");
  console.error(`  ${DAEMON_LOG}`);
  process.exit(1);
}

async function stopDaemon(opts: { wait?: boolean } = {}): Promise<boolean> {
  const pid = readPid();
  if (!pid) {
    return false; // not running
  }

  if (!isProcessAlive(pid)) {
    // Stale PID file
    fs.unlinkSync(DAEMON_PID);
    return false;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    console.error(`Failed to send SIGTERM to PID ${pid}`);
    return false;
  }

  if (opts.wait !== false) {
    // Wait up to 10 seconds for process to exit
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
      if (!isProcessAlive(pid)) {
        // Clean up stale PID file if daemon didn't remove it
        if (fs.existsSync(DAEMON_PID)) fs.unlinkSync(DAEMON_PID);
        return true;
      }
    }
    console.error(`Daemon (PID ${pid}) did not exit within 10 seconds`);
    return false;
  }

  return true;
}

// ─── Output formatters ────────────────────────────────────────────────────────

function formatStatus(data: Record<string, unknown>): void {
  const line = (label: string, value: string) =>
    console.log(`${label.padEnd(20)}${value}`);

  console.log("ARC-402 Daemon Status");
  console.log("─────────────────────");
  line("State:", String(data.state ?? "unknown"));
  line("PID:", String(data.pid ?? "unknown"));
  line("Uptime:", String(data.uptime ?? "unknown"));
  line("Wallet:", String(data.wallet ?? "unknown"));
  line("Machine Key:", String(data.machine_key_address ?? "unknown"));
  console.log();
  console.log("Subsystems:");
  const relayStatus = data.relay_enabled
    ? `active — polling ${data.relay_url || "relay"} every ${data.relay_poll_seconds}s`
    : "disabled";
  const watchtowerStatus = data.watchtower_enabled ? "active" : "disabled";
  const bundlerStatus = `${data.bundler_mode} — ${data.bundler_endpoint || "default"}`;
  console.log(`  Relay:      ${relayStatus}`);
  console.log(`  Watchtower: ${watchtowerStatus}`);
  console.log(`  Bundler:    ${bundlerStatus}`);
  console.log();
  const pending = Number(data.pending_approval ?? 0);
  console.log(`Active Agreements:  ${data.active_agreements ?? 0}`);
  if (pending > 0) {
    console.log(`Pending Approval:   ${pending}  ← (review with: arc402 daemon pending)`);
  } else {
    console.log(`Pending Approval:   0`);
  }
}

interface HireRow {
  id: string;
  hirer_address: string;
  capability: string;
  price_eth: string;
  deadline_unix: number;
  status: string;
  created_at: number;
}

function formatHireTable(rows: HireRow[]): void {
  if (rows.length === 0) {
    console.log("(none)");
    return;
  }
  const cols = ["ID", "Hirer", "Capability", "Price (ETH)", "Deadline", "Status"];
  const widths = [20, 14, 20, 12, 22, 18];
  const header = cols.map((c, i) => c.padEnd(widths[i])).join("  ");
  const sep = cols.map((_, i) => "─".repeat(widths[i])).join("  ");
  console.log(header);
  console.log(sep);
  for (const row of rows) {
    const deadline = row.deadline_unix
      ? new Date(row.deadline_unix * 1000).toISOString()
      : "none";
    const cols2 = [
      row.id.slice(0, 18),
      row.hirer_address.slice(0, 12) + "...",
      (row.capability || "").slice(0, 18),
      row.price_eth || "0",
      deadline.replace("T", " ").replace("Z", ""),
      row.status,
    ];
    console.log(cols2.map((c, i) => String(c).padEnd(widths[i])).join("  "));
  }
}

// ─── Command registration ─────────────────────────────────────────────────────

export function registerDaemonCommands(program: Command): void {
  const daemon = program
    .command("daemon")
    .description("ARC-402 daemon management and hire request workflow (Spec 32)");

  // ── daemon start ────────────────────────────────────────────────────────────
  daemon
    .command("start")
    .description("Start the ARC-402 daemon in the background. Use --foreground for systemd/launchd.")
    .option("--foreground", "Run in foreground (blocking). Used by systemd/launchd service managers.")
    .action(async (opts) => {
      const foreground = opts.foreground as boolean | undefined;

      // Check for OpenShell sandbox configuration
      const openShellCfg = readOpenShellConfig();
      const sandboxName = openShellCfg?.sandbox.name;

      if (foreground) {
        if (sandboxName) {
          // Run inside OpenShell sandbox (blocking)
          const daemonEntry = path.join(__dirname, "..", "daemon", "index.js");
          const result = spawnSync("openshell", [
            "sandbox", "exec", sandboxName, "--",
            process.execPath, daemonEntry,
          ], {
            stdio: "inherit",
            env: { ...process.env, ARC402_DAEMON_PROCESS: "1" },
          });
          process.exit(result.status ?? 0);
        } else {
          // Foreground mode without sandbox: import and run directly (blocking)
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { runDaemon } = require("../daemon/index") as { runDaemon: (fg: boolean) => Promise<void> };
          await runDaemon(true);
        }
        return;
      }

      // Check if already running
      const existingPid = readPid();
      if (existingPid && isProcessAlive(existingPid)) {
        console.log(`Daemon is already running. PID: ${existingPid}`);
        process.exit(0);
      }

      // Remove stale PID file if present
      if (fs.existsSync(DAEMON_PID)) fs.unlinkSync(DAEMON_PID);

      if (sandboxName) {
        console.log(`Starting ARC-402 daemon inside OpenShell sandbox: ${sandboxName}`);
      }
      await startDaemonBackground(sandboxName);
    });

  // ── daemon stop ─────────────────────────────────────────────────────────────
  daemon
    .command("stop")
    .description("Gracefully stop the running daemon (SIGTERM + wait for exit).")
    .action(async () => {
      const pid = readPid();
      if (!pid || !isProcessAlive(pid)) {
        console.log("Daemon is not running.");
        process.exit(0);
      }

      console.log(`Stopping daemon (PID ${pid})...`);
      const stopped = await stopDaemon({ wait: true });
      if (stopped) {
        console.log("Daemon stopped.");
      } else {
        console.error("Failed to stop daemon cleanly.");
        process.exit(1);
      }
    });

  // ── daemon restart ──────────────────────────────────────────────────────────
  daemon
    .command("restart")
    .description("Stop the running daemon then start a new one.")
    .action(async () => {
      const pid = readPid();
      if (pid && isProcessAlive(pid)) {
        console.log(`Stopping daemon (PID ${pid})...`);
        const stopped = await stopDaemon({ wait: true });
        if (!stopped) {
          console.error("Failed to stop daemon cleanly.");
          process.exit(1);
        }
        console.log("Daemon stopped.");
      } else {
        console.log("Daemon was not running.");
        if (fs.existsSync(DAEMON_PID)) fs.unlinkSync(DAEMON_PID);
      }

      await startDaemonBackground();
    });

  // ── daemon status ───────────────────────────────────────────────────────────
  daemon
    .command("status")
    .description("Show current daemon status via IPC.")
    .action(async () => {
      // First check if daemon is even running at the PID level
      const pid = readPid();
      if (!pid || !isProcessAlive(pid)) {
        console.log("Daemon is not running.");
        console.log("Start with: arc402 daemon start");
        process.exit(1);
      }

      const res = await sendIpcCommand({ command: "status" });
      if (!res.ok) {
        console.error(`Error: ${res.error}`);
        process.exit(1);
      }
      formatStatus(res.data as Record<string, unknown>);
    });

  // ── daemon logs ─────────────────────────────────────────────────────────────
  daemon
    .command("logs")
    .description("Show daemon log output.")
    .option("--follow", "Stream live log output (tail -f)")
    .option("--lines <n>", "Number of lines to show", "50")
    .action((opts) => {
      const follow = opts.follow as boolean | undefined;
      const lines = parseInt(opts.lines as string, 10) || 50;

      if (!fs.existsSync(DAEMON_LOG)) {
        console.log(`Log file not found: ${DAEMON_LOG}`);
        console.log("Has the daemon been started? Run: arc402 daemon start");
        process.exit(0);
      }

      if (follow) {
        // Stream with tail -f equivalent using spawn
        const tail = spawn("tail", ["-f", "-n", String(lines), DAEMON_LOG], {
          stdio: "inherit",
        });
        tail.on("error", (err) => {
          console.error(`Failed to tail log: ${err.message}`);
          process.exit(1);
        });
        process.on("SIGINT", () => {
          tail.kill();
          process.exit(0);
        });
      } else {
        // Read last N lines
        const content = fs.readFileSync(DAEMON_LOG, "utf-8");
        const allLines = content.split("\n").filter((l) => l.trim());
        const slice = allLines.slice(-lines);
        for (const line of slice) {
          // Try pretty-print JSON log entries
          try {
            const entry = JSON.parse(line) as Record<string, unknown>;
            const ts = entry.ts ? `[${entry.ts}] ` : "";
            const { ts: _ts, ...rest } = entry;
            console.log(`${ts}${JSON.stringify(rest)}`);
          } catch {
            console.log(line);
          }
        }
      }
    });

  // ── daemon approve <id> ─────────────────────────────────────────────────────
  daemon
    .command("approve <id>")
    .description("Approve a pending hire request.")
    .action(async (id: string) => {
      const res = await sendIpcCommand({ command: "approve", id });
      if (!res.ok) {
        console.error(`Error: ${res.error}`);
        process.exit(1);
      }
      const data = res.data as { approved: boolean; id: string };
      console.log(`Approved hire request: ${data.id}`);
    });

  // ── daemon reject <id> ──────────────────────────────────────────────────────
  daemon
    .command("reject <id>")
    .description("Reject a pending hire request.")
    .option("--reason <reason>", "Rejection reason", "operator_rejected")
    .action(async (id: string, opts) => {
      const reason = opts.reason as string;
      const res = await sendIpcCommand({ command: "reject", id, reason });
      if (!res.ok) {
        console.error(`Error: ${res.error}`);
        process.exit(1);
      }
      const data = res.data as { rejected: boolean; id: string; reason: string };
      console.log(`Rejected hire request: ${data.id} (reason: ${data.reason})`);
    });

  // ── daemon pending ──────────────────────────────────────────────────────────
  daemon
    .command("pending")
    .description("List all hire requests awaiting operator approval.")
    .action(async () => {
      const res = await sendIpcCommand({ command: "pending" });
      if (!res.ok) {
        console.error(`Error: ${res.error}`);
        process.exit(1);
      }
      const data = res.data as { requests: HireRow[] };
      const rows = data.requests ?? [];
      if (rows.length === 0) {
        console.log("No pending hire requests.");
        return;
      }
      console.log(`Pending Hire Requests (${rows.length}):`);
      console.log();
      formatHireTable(rows);
      console.log();
      console.log("Approve: arc402 daemon approve <id>");
      console.log("Reject:  arc402 daemon reject <id> [--reason <reason>]");
    });

  // ── daemon agreements ────────────────────────────────────────────────────────
  daemon
    .command("agreements")
    .description("List all active agreements and their status.")
    .action(async () => {
      const res = await sendIpcCommand({ command: "agreements" });
      if (!res.ok) {
        console.error(`Error: ${res.error}`);
        process.exit(1);
      }
      const data = res.data as { agreements: HireRow[] };
      const rows = data.agreements ?? [];
      if (rows.length === 0) {
        console.log("No active agreements.");
        return;
      }
      console.log(`Active Agreements (${rows.length}):`);
      console.log();
      formatHireTable(rows);
    });

  // ── daemon init ──────────────────────────────────────────────────────────────
  daemon
    .command("init")
    .description("Generate a template ~/.arc402/daemon.toml configuration file.")
    .option("--force", "Overwrite existing daemon.toml")
    .option("--reconfigure-harness", "Re-run harness selection on an existing daemon.toml")
    .action(async (opts) => {
      const force = opts.force as boolean | undefined;
      const reconfigureHarness = opts.reconfigureHarness as boolean | undefined;

      if (fs.existsSync(DAEMON_TOML) && !force && !reconfigureHarness) {
        console.log(`daemon.toml already exists at ${DAEMON_TOML}`);
        console.log("Use --force to overwrite, or --reconfigure-harness to update the harness only.");
        process.exit(0);
      }

      // ── Harness selection ────────────────────────────────────────────────────
      console.log("Which harness should execute work tasks?");
      console.log();
      console.log("  1. openclaw  (OpenClaw agent runtime — default)");
      console.log("  2. claude    (Claude Code — Anthropic)");
      console.log("  3. codex     (Codex CLI — OpenAI)");
      console.log("  4. opencode  (OpenCode)");
      console.log("  5. custom    (enter your own exec_command)");
      console.log();

      const harnessResponse = await prompts({
        type: "select",
        name: "harness",
        message: "Select harness",
        choices: [
          { title: "openclaw", value: "openclaw" },
          { title: "claude", value: "claude" },
          { title: "codex", value: "codex" },
          { title: "opencode", value: "opencode" },
          { title: "custom", value: "custom" },
        ],
        initial: 0,
      });

      const selectedHarness: string = harnessResponse.harness ?? "openclaw";
      let execCommand = HARNESS_REGISTRY[selectedHarness] ?? "";

      if (selectedHarness === "custom") {
        const customResponse = await prompts({
          type: "text",
          name: "exec_command",
          message: "Enter your exec_command (use {task} as placeholder)",
          validate: (v: string) => v.trim().length > 0 || "exec_command cannot be empty",
        });
        execCommand = (customResponse.exec_command as string | undefined) ?? "";
      }

      if (reconfigureHarness && fs.existsSync(DAEMON_TOML)) {
        // Patch only the [work] section in the existing file
        let existing = fs.readFileSync(DAEMON_TOML, "utf-8");

        // Replace or insert harness and exec_command in [work] section
        const harnessLine = selectedHarness === "custom"
          ? `harness = "${selectedHarness}"\nexec_command = "${execCommand}"`
          : `harness = "${selectedHarness}"\n# exec_command: ${execCommand}\n# To change: arc402 daemon init --reconfigure-harness`;

        if (/^\[work\]/m.test(existing)) {
          // Remove old harness/exec_command lines if present, then insert after [work]
          existing = existing
            .replace(/^harness\s*=.*$/m, "")
            .replace(/^exec_command\s*=.*$/m, "")
            .replace(/^# exec_command:.*$/m, "")
            .replace(/^# To change:.*$/m, "")
            .replace(/^\[work\]/m, `[work]\n${harnessLine}`);
          fs.writeFileSync(DAEMON_TOML, existing, { mode: 0o600 });
        } else {
          console.error("[work] section not found in daemon.toml. Run: arc402 daemon init --force");
          process.exit(1);
        }

        console.log(`\nHarness updated: ${selectedHarness}`);
        if (selectedHarness !== "custom") {
          console.log(`exec_command:    ${execCommand}`);
        }
        return;
      }

      // ── Write full daemon.toml ────────────────────────────────────────────────
      const harnessSection = selectedHarness === "custom"
        ? `[work]\nharness = "${selectedHarness}"\nexec_command = "${execCommand}"              # Your custom command\nhttp_url = ""                  # POST {agreementId, specHash, deadline} as JSON (http mode)\nhttp_auth_token = "env:WORKER_AUTH_TOKEN"\n`
        : `[work]\nharness = "${selectedHarness}"\n# exec_command: ${execCommand}\n# To change: arc402 daemon init --reconfigure-harness\nhttp_url = ""                  # POST {agreementId, specHash, deadline} as JSON (http mode)\nhttp_auth_token = "env:WORKER_AUTH_TOKEN"\n`;

      const toml = TEMPLATE_DAEMON_TOML.replace(
        /^\[work\].*?(?=\n\[|\n*$)/ms,
        harnessSection
      );

      fs.mkdirSync(DAEMON_DIR, { recursive: true, mode: 0o700 });
      fs.writeFileSync(DAEMON_TOML, toml, { mode: 0o600 });
      console.log(`\nCreated ${DAEMON_TOML}`);
      console.log(`Harness: ${selectedHarness}${selectedHarness !== "custom" ? ` (${execCommand})` : ""}`);
      console.log();
      console.log("Next steps:");
      console.log("  1. Edit daemon.toml — fill in wallet.contract_address and network.rpc_url");
      console.log("  2. Set your machine key: export ARC402_MACHINE_KEY=0x<private-key>");
      console.log("  3. Start the daemon: arc402 daemon start");
    });

  // ── daemon channel-watch ─────────────────────────────────────────────────────
  daemon
    .command("channel-watch")
    .description(
      "Monitor all open channels for the configured wallet. " +
      "Polls the chain on an interval and auto-challenges any stale close " +
      "using the latest signed state from ~/.arc402/channel-states/. " +
      "Runs until interrupted (Ctrl+C)."
    )
    .option("--poll-interval <ms>", "Polling interval in milliseconds", "30000")
    .option("--json", "Machine-parseable output (one JSON object per line)")
    .action(async (opts) => {
      const config = loadConfig();
      if (!config.serviceAgreementAddress) {
        console.error("serviceAgreementAddress missing in config. Run `arc402 config init`.");
        process.exit(1);
      }

      const { signer, address } = await requireSigner(config);
      const contract = new ethers.Contract(
        config.serviceAgreementAddress,
        SERVICE_AGREEMENT_ABI,
        signer
      );

      await runChannelWatchLoop({
        pollInterval: parseInt(opts.pollInterval, 10),
        wallet: address,
        contract,
        json: opts.json || program.opts().json,
      });
    });
}
