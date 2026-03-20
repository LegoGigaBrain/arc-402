/**
 * ARC-402 Daemon — main process entry point.
 *
 * Startup sequence per Spec 32 §3.
 * Runs when spawned by `arc402 daemon start` or invoked with --foreground.
 *
 * IPC: Unix socket at ~/.arc402/daemon.sock (JSON-lines protocol).
 * Signals: SIGTERM → graceful shutdown.
 */
import * as fs from "fs";
import * as path from "path";
import * as net from "net";
import { ethers } from "ethers";
import Database from "better-sqlite3";

import {
  loadDaemonConfig,
  loadMachineKey,
  DAEMON_DIR,
  DAEMON_PID,
  DAEMON_LOG,
  DAEMON_DB,
  DAEMON_SOCK,
  type DaemonConfig,
} from "./config";
import { verifyWallet, getWalletBalance } from "./wallet-monitor";
import { Notifier } from "./notify";
import { HireListener } from "./hire-listener";
import { UserOpsManager, buildAcceptCalldata } from "./userops";

// ─── State DB ─────────────────────────────────────────────────────────────────

export interface HireRequestRow {
  id: string;
  agreement_id: string | null;
  hirer_address: string;
  capability: string;
  price_eth: string;
  deadline_unix: number;
  spec_hash: string;
  status: string; // pending_approval | accepted | rejected | delivered | complete
  created_at: number;
  updated_at: number;
  reject_reason: string | null;
}

export interface DaemonDB {
  insertHireRequest(row: Omit<HireRequestRow, "created_at" | "updated_at">): void;
  getHireRequest(id: string): HireRequestRow | undefined;
  updateHireRequestStatus(id: string, status: string, rejectReason?: string): void;
  listPendingHireRequests(): HireRequestRow[];
  listActiveHireRequests(): HireRequestRow[];
  countActiveHireRequests(): number;
  close(): void;
}

function openStateDB(dbPath: string): DaemonDB {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS hire_requests (
      id TEXT PRIMARY KEY,
      agreement_id TEXT,
      hirer_address TEXT NOT NULL,
      capability TEXT,
      price_eth TEXT,
      deadline_unix INTEGER,
      spec_hash TEXT,
      status TEXT NOT NULL,
      created_at INTEGER,
      updated_at INTEGER,
      reject_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS userop_queue (
      id TEXT PRIMARY KEY,
      hire_request_id TEXT,
      call_data TEXT NOT NULL,
      user_op_hash TEXT,
      status TEXT NOT NULL,
      submitted_at INTEGER,
      included_at INTEGER,
      retry_count INTEGER DEFAULT 0,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS session_channels (
      channel_id TEXT PRIMARY KEY,
      counterparty TEXT NOT NULL,
      token_address TEXT,
      latest_state_seq INTEGER,
      latest_state_bytes BLOB,
      status TEXT NOT NULL,
      challenge_deadline_unix INTEGER,
      external_watcher_id TEXT
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      payload TEXT,
      sent_at INTEGER,
      status TEXT
    );
  `);

  const insertHireRequest = db.prepare(`
    INSERT OR IGNORE INTO hire_requests
      (id, agreement_id, hirer_address, capability, price_eth, deadline_unix, spec_hash, status, created_at, updated_at, reject_reason)
    VALUES
      (@id, @agreement_id, @hirer_address, @capability, @price_eth, @deadline_unix, @spec_hash, @status, @created_at, @updated_at, @reject_reason)
  `);

  const getHireRequest = db.prepare(`SELECT * FROM hire_requests WHERE id = ?`);
  const updateStatus = db.prepare(`UPDATE hire_requests SET status = ?, reject_reason = ?, updated_at = ? WHERE id = ?`);
  const listPending = db.prepare(`SELECT * FROM hire_requests WHERE status = 'pending_approval' ORDER BY created_at ASC`);
  const listActive = db.prepare(`SELECT * FROM hire_requests WHERE status IN ('accepted', 'delivered') ORDER BY created_at ASC`);
  const countActive = db.prepare(`SELECT COUNT(*) as n FROM hire_requests WHERE status IN ('accepted', 'delivered')`);

  return {
    insertHireRequest(row) {
      const now = Date.now();
      insertHireRequest.run({ ...row, created_at: now, updated_at: now });
    },
    getHireRequest(id) {
      return getHireRequest.get(id) as HireRequestRow | undefined;
    },
    updateHireRequestStatus(id, status, rejectReason) {
      updateStatus.run(status, rejectReason ?? null, Date.now(), id);
    },
    listPendingHireRequests() {
      return listPending.all() as HireRequestRow[];
    },
    listActiveHireRequests() {
      return listActive.all() as HireRequestRow[];
    },
    countActiveHireRequests() {
      const row = countActive.get() as { n: number };
      return row.n;
    },
    close() {
      db.close();
    },
  };
}

// ─── Logger ───────────────────────────────────────────────────────────────────

function openLogger(logPath: string, foreground: boolean): (entry: Record<string, unknown>) => void {
  let stream: fs.WriteStream | null = null;
  if (!foreground) {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    stream = fs.createWriteStream(logPath, { flags: "a" });
  }

  return (entry: Record<string, unknown>) => {
    const line = JSON.stringify({ ...entry, ts: new Date().toISOString() });
    if (foreground) {
      process.stdout.write(line + "\n");
    } else if (stream) {
      stream.write(line + "\n");
    }
  };
}

// ─── IPC Socket ───────────────────────────────────────────────────────────────

interface IpcContext {
  db: DaemonDB;
  config: DaemonConfig;
  startTime: number;
  walletAddress: string;
  machineKeyAddress: string;
  hireListener: HireListener | null;
  userOps: UserOpsManager | null;
  activeAgreements: number;
  bundlerMode: string;
  bundlerEndpoint: string;
}

function startIpcServer(ctx: IpcContext, log: ReturnType<typeof openLogger>): net.Server {
  // Remove stale socket
  if (fs.existsSync(DAEMON_SOCK)) {
    fs.unlinkSync(DAEMON_SOCK);
  }

  const server = net.createServer((socket) => {
    let buf = "";
    socket.on("data", (data) => {
      buf += data.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let cmd: { command: string; id?: string; reason?: string };
        try {
          cmd = JSON.parse(line) as { command: string; id?: string; reason?: string };
        } catch {
          socket.write(JSON.stringify({ ok: false, error: "invalid_json" }) + "\n");
          continue;
        }

        const response = handleIpcCommand(cmd, ctx, log);
        socket.write(JSON.stringify(response) + "\n");
      }
    });
    socket.on("error", () => { /* client disconnected */ });
  });

  server.listen(DAEMON_SOCK, () => {
    fs.chmodSync(DAEMON_SOCK, 0o600);
    log({ event: "ipc_ready", socket: DAEMON_SOCK });
  });

  return server;
}

function handleIpcCommand(
  cmd: { command: string; id?: string; reason?: string },
  ctx: IpcContext,
  log: ReturnType<typeof openLogger>
): { ok: boolean; data?: unknown; error?: string } {
  const uptimeSeconds = Math.floor((Date.now() - ctx.startTime) / 1000);
  const uptimeStr = formatUptime(uptimeSeconds);

  switch (cmd.command) {
    case "status": {
      const pending = ctx.db.listPendingHireRequests();
      const active = ctx.db.listActiveHireRequests();
      return {
        ok: true,
        data: {
          state: "running",
          pid: process.pid,
          uptime: uptimeStr,
          wallet: ctx.walletAddress,
          machine_key_address: ctx.machineKeyAddress,
          relay_enabled: ctx.config.relay.enabled,
          relay_url: ctx.config.relay.relay_url,
          relay_poll_seconds: ctx.config.relay.poll_interval_seconds,
          watchtower_enabled: ctx.config.watchtower.enabled,
          bundler_mode: ctx.bundlerMode,
          bundler_endpoint: ctx.bundlerEndpoint,
          active_agreements: active.length,
          pending_approval: pending.length,
        },
      };
    }

    case "pending": {
      return { ok: true, data: { requests: ctx.db.listPendingHireRequests() } };
    }

    case "agreements": {
      return { ok: true, data: { agreements: ctx.db.listActiveHireRequests() } };
    }

    case "agreement": {
      if (!cmd.id) return { ok: false, error: "id required" };
      const agreement = ctx.db.getHireRequest(cmd.id);
      if (!agreement) return { ok: false, error: "agreement not found" };
      return { ok: true, data: { agreement } };
    }

    case "approve": {
      if (!cmd.id) return { ok: false, error: "id required" };
      const hire = ctx.db.getHireRequest(cmd.id);
      if (!hire) return { ok: false, error: "hire request not found" };
      if (hire.status !== "pending_approval") {
        return { ok: false, error: `hire request status is '${hire.status}', not pending_approval` };
      }
      ctx.db.updateHireRequestStatus(cmd.id, "accepted");
      log({ event: "hire_approved", id: cmd.id });

      // Trigger accept UserOp (fire and forget)
      if (ctx.userOps && ctx.config.serviceAgreementAddress) {
        const callData = buildAcceptCalldata(
          ctx.config.serviceAgreementAddress,
          hire.agreement_id ?? cmd.id,
          ctx.walletAddress
        );
        ctx.userOps.submit(callData, ctx.walletAddress).then((hash) => {
          log({ event: "userop_submitted", id: cmd.id, hash });
        }).catch((err: unknown) => {
          log({ event: "userop_error", id: cmd.id, error: String(err) });
        });
      }

      return { ok: true, data: { approved: true, id: cmd.id } };
    }

    case "reject": {
      if (!cmd.id) return { ok: false, error: "id required" };
      const hire = ctx.db.getHireRequest(cmd.id);
      if (!hire) return { ok: false, error: "hire request not found" };
      if (hire.status !== "pending_approval") {
        return { ok: false, error: `hire request status is '${hire.status}', not pending_approval` };
      }
      const reason = cmd.reason ?? "operator_rejected";
      ctx.db.updateHireRequestStatus(cmd.id, "rejected", reason);
      log({ event: "hire_rejected", id: cmd.id, reason });
      return { ok: true, data: { rejected: true, id: cmd.id, reason } };
    }

    default:
      return { ok: false, error: `unknown command: ${cmd.command}` };
  }
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ─── Daemon main ──────────────────────────────────────────────────────────────

// Extend config with serviceAgreementAddress (loaded from CLI config if available)
declare module "./config" {
  interface DaemonConfig {
    serviceAgreementAddress?: string;
  }
}

export async function runDaemon(foreground = false): Promise<void> {
  fs.mkdirSync(DAEMON_DIR, { recursive: true, mode: 0o700 });
  const log = openLogger(DAEMON_LOG, foreground);

  log({ event: "daemon_starting" });

  // ── Step 1: Load config ──────────────────────────────────────────────────
  let config: DaemonConfig;
  try {
    config = loadDaemonConfig();
    log({ event: "config_loaded", path: require("path").join(require("os").homedir(), ".arc402", "daemon.toml") });
  } catch (err) {
    process.stderr.write(`Config error: ${err}\n`);
    process.exit(1);
  }

  // ── Step 2: Load machine key ─────────────────────────────────────────────
  let machineKeyAddress: string;
  let machinePrivateKey: string;
  try {
    const mk = loadMachineKey(config);
    machinePrivateKey = mk.privateKey;
    machineKeyAddress = mk.address;
    log({ event: "machine_key_loaded", address: machineKeyAddress });
  } catch (err) {
    process.stderr.write(`Machine key error: ${err}\n`);
    process.exit(1);
  }

  // ── Step 3: Connect to RPC ───────────────────────────────────────────────
  const provider = new ethers.JsonRpcProvider(config.network.rpc_url);
  try {
    const chainId = (await provider.getNetwork()).chainId;
    if (Number(chainId) !== config.network.chain_id) {
      process.stderr.write(
        `RPC chain ID ${chainId} does not match config ${config.network.chain_id}\n`
      );
      process.exit(1);
    }
    const networkName = config.network.chain_id === 8453 ? "Base Mainnet" : `Chain ${config.network.chain_id}`;
    log({ event: "rpc_connected", chain_id: config.network.chain_id, network: networkName });
  } catch (err) {
    process.stderr.write(`RPC connection failed: ${err}\n`);
    process.exit(1);
  }

  // ── Step 4+5: Verify wallet ──────────────────────────────────────────────
  try {
    const walletStatus = await verifyWallet(config, provider, machineKeyAddress);
    log({
      event: "wallet_verified",
      address: walletStatus.contractAddress,
      owner: walletStatus.ownerAddress,
      balance_eth: walletStatus.ethBalance,
      machine_key_authorized: walletStatus.machineKeyAuthorized,
    });
  } catch (err) {
    process.stderr.write(`Wallet verification failed: ${err}\n`);
    process.exit(1);
  }

  // ── Step 6: Connect bundler ──────────────────────────────────────────────
  const userOps = new UserOpsManager(config, provider);
  const bundlerOk = await userOps.pingBundler();
  if (!bundlerOk) {
    log({ event: "bundler_warn", msg: "Bundler endpoint unreachable — will retry on demand" });
  }
  const bundlerEndpoint = config.bundler.endpoint || "https://api.pimlico.io/v2/base/rpc";
  log({ event: "bundler_configured", mode: config.bundler.mode, endpoint: bundlerEndpoint });

  // ── Step 7: Open state DB ────────────────────────────────────────────────
  let db: DaemonDB;
  try {
    db = openStateDB(DAEMON_DB);
    log({ event: "state_db_opened", path: DAEMON_DB });
  } catch (err) {
    process.stderr.write(`State DB error: ${err}\n`);
    process.exit(1);
  }

  // ── Setup notifier ───────────────────────────────────────────────────────
  const notifier = new Notifier(
    config.notifications.telegram_bot_token,
    config.notifications.telegram_chat_id,
    {
      hire_request: config.notifications.notify_on_hire_request,
      hire_accepted: config.notifications.notify_on_hire_accepted,
      hire_rejected: config.notifications.notify_on_hire_rejected,
      delivery: config.notifications.notify_on_delivery,
      dispute: config.notifications.notify_on_dispute,
      channel_challenge: config.notifications.notify_on_channel_challenge,
      low_balance: config.notifications.notify_on_low_balance,
    }
  );

  // ── Step 10: Start relay listener ───────────────────────────────────────
  const hireListener = new HireListener(config, db, notifier, config.wallet.contract_address);

  const ipcCtx: IpcContext = {
    db,
    config,
    startTime: Date.now(),
    walletAddress: config.wallet.contract_address,
    machineKeyAddress,
    hireListener,
    userOps,
    activeAgreements: 0,
    bundlerMode: config.bundler.mode,
    bundlerEndpoint,
  };

  // Wire approve callback — submits UserOp when hire is auto-accepted
  hireListener.setApproveCallback(async (hireId) => {
    const hire = db.getHireRequest(hireId);
    if (!hire || !hire.agreement_id || !config.serviceAgreementAddress) return;
    try {
      const callData = buildAcceptCalldata(
        config.serviceAgreementAddress,
        hire.agreement_id,
        config.wallet.contract_address
      );
      const hash = await userOps.submit(callData, config.wallet.contract_address);
      log({ event: "hire_auto_accepted", id: hireId, userop_hash: hash });
      if (config.notifications.notify_on_hire_accepted) {
        await notifier.notifyHireAccepted(hireId, hire.agreement_id);
      }
    } catch (err) {
      log({ event: "accept_userop_error", id: hireId, error: String(err) });
    }
  });

  // Relay poll interval
  let relayInterval: ReturnType<typeof setInterval> | null = null;
  if (config.relay.enabled && config.relay.relay_url) {
    const pollMs = config.relay.poll_interval_seconds * 1000;
    relayInterval = setInterval(() => { void hireListener.poll(); }, pollMs);
    void hireListener.poll(); // immediate first poll
    log({ event: "relay_started", url: config.relay.relay_url, poll_seconds: config.relay.poll_interval_seconds });
  }

  // Hire timeout checker — reject stale pending approvals
  const timeoutInterval = setInterval(() => {
    const pending = db.listPendingHireRequests();
    const now = Math.floor(Date.now() / 1000);
    for (const req of pending) {
      const minLead = config.policy.min_hire_lead_time_seconds;
      if (req.deadline_unix > 0 && req.deadline_unix < now + minLead) {
        db.updateHireRequestStatus(req.id, "rejected", "approval_timeout");
        log({ event: "hire_timeout_rejected", id: req.id });
      }
    }
  }, 30_000);

  // Balance monitor — every 5 minutes
  const balanceInterval = setInterval(async () => {
    try {
      const balance = await getWalletBalance(config.wallet.contract_address, provider);
      const threshold = parseFloat(config.notifications.low_balance_threshold_eth);
      if (parseFloat(balance) < threshold) {
        log({ event: "low_balance", balance_eth: balance, threshold_eth: config.notifications.low_balance_threshold_eth });
        await notifier.notifyLowBalance(balance, config.notifications.low_balance_threshold_eth);
      }
    } catch { /* non-fatal */ }
  }, 5 * 60 * 1000);

  // ── Step 11: Write PID file (if not foreground) ──────────────────────────
  if (!foreground) {
    fs.writeFileSync(DAEMON_PID, String(process.pid), { mode: 0o600 });
    log({ event: "pid_written", pid: process.pid, path: DAEMON_PID });
  }

  // ── Start IPC socket ─────────────────────────────────────────────────────
  const ipcServer = startIpcServer(ipcCtx, log);

  // ── Step 12: Startup complete ────────────────────────────────────────────
  const subsystems = [];
  if (config.relay.enabled) subsystems.push("relay");
  if (config.watchtower.enabled) subsystems.push("watchtower");
  subsystems.push(`bundler(${config.bundler.mode})`);

  log({
    event: "daemon_started",
    wallet: config.wallet.contract_address,
    subsystems,
    pid: process.pid,
  });

  await notifier.notifyStarted(config.wallet.contract_address, subsystems);

  // ── Graceful shutdown ────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    log({ event: "daemon_stopping", signal });

    // Stop accepting new hire requests
    if (relayInterval) clearInterval(relayInterval);
    clearInterval(timeoutInterval);
    clearInterval(balanceInterval);

    // Close IPC
    ipcServer.close();
    if (fs.existsSync(DAEMON_SOCK)) fs.unlinkSync(DAEMON_SOCK);

    await notifier.notifyStopped();
    log({ event: "daemon_stopped" });

    // Clean up PID file
    if (!foreground && fs.existsSync(DAEMON_PID)) {
      fs.unlinkSync(DAEMON_PID);
    }

    db.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.on("SIGINT", () => { void shutdown("SIGINT"); });

  // Keep process alive
  process.stdin.resume();
}

// ─── Entry point ──────────────────────────────────────────────────────────────
// Run when spawned directly (node dist/daemon/index.js [--foreground])

if (require.main === module || process.env.ARC402_DAEMON_PROCESS === "1") {
  const foreground = process.argv.includes("--foreground") ||
    process.env.ARC402_DAEMON_FOREGROUND === "1";
  runDaemon(foreground).catch((err) => {
    process.stderr.write(`Daemon fatal error: ${err}\n`);
    process.exit(1);
  });
}
