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
import * as http from "http";
import { ethers } from "ethers";
import Database from "better-sqlite3";

import * as crypto from "crypto";

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
import { generateReceipt, extractLearnings, createJobDirectory, cleanJobDirectory } from "./job-lifecycle";

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

// ─── Auth token ───────────────────────────────────────────────────────────────

const DAEMON_TOKEN_FILE = path.join(path.dirname(DAEMON_SOCK), "daemon.token");

function generateApiToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function saveApiToken(token: string): void {
  fs.mkdirSync(path.dirname(DAEMON_TOKEN_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(DAEMON_TOKEN_FILE, token, { mode: 0o600 });
}

function loadApiToken(): string | null {
  try {
    return fs.readFileSync(DAEMON_TOKEN_FILE, "utf-8").trim();
  } catch {
    return null;
  }
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────

interface RateBucket { count: number; resetTime: number }
const rateLimitMap = new Map<string, RateBucket>();
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  let bucket = rateLimitMap.get(ip);
  if (!bucket || now >= bucket.resetTime) {
    bucket = { count: 0, resetTime: now + RATE_WINDOW_MS };
    rateLimitMap.set(ip, bucket);
  }
  bucket.count++;
  return bucket.count <= RATE_LIMIT;
}

// Cleanup stale rate limit entries every 5 minutes to prevent unbounded growth
let rateLimitCleanupInterval: ReturnType<typeof setInterval> | null = null;

// ─── Body size limit ──────────────────────────────────────────────────────────

const MAX_BODY_SIZE = 1024 * 1024; // 1 MB

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

function startIpcServer(ctx: IpcContext, log: ReturnType<typeof openLogger>, apiToken: string): net.Server {
  // Remove stale socket
  if (fs.existsSync(DAEMON_SOCK)) {
    fs.unlinkSync(DAEMON_SOCK);
  }

  const server = net.createServer((socket) => {
    let buf = "";
    let authenticated = false;
    socket.on("data", (data) => {
      buf += data.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let cmd: { command: string; id?: string; reason?: string; auth?: string };
        try {
          cmd = JSON.parse(line) as { command: string; id?: string; reason?: string; auth?: string };
        } catch {
          socket.write(JSON.stringify({ ok: false, error: "invalid_json" }) + "\n");
          continue;
        }

        // First message must be auth
        if (!authenticated) {
          if (cmd.auth === apiToken) {
            authenticated = true;
            socket.write(JSON.stringify({ ok: true, authenticated: true }) + "\n");
          } else {
            log({ event: "ipc_auth_failed" });
            socket.write(JSON.stringify({ ok: false, error: "unauthorized" }) + "\n");
            socket.destroy();
          }
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

    case "complete": {
      // Called after a job is delivered and accepted. Triggers post-job lifecycle:
      // receipt generation, learning extraction, worker memory update.
      if (!cmd.id) return { ok: false, error: "id required" };
      const hire = ctx.db.getHireRequest(cmd.id);
      if (!hire) return { ok: false, error: "hire request not found" };

      const now = new Date().toISOString();
      const startedAt = new Date(hire.created_at).toISOString();

      // Generate execution receipt
      const receipt = generateReceipt({
        agreementId: hire.agreement_id ?? cmd.id,
        deliverableHash: hire.spec_hash ?? "0x0",
        walletAddress: ctx.walletAddress,
        startedAt,
        completedAt: now,
      });
      log({ event: "receipt_generated", id: cmd.id, receipt_hash: receipt.receipt_hash });

      // Extract learnings
      extractLearnings({
        agreementId: hire.agreement_id ?? cmd.id,
        taskDescription: hire.capability ?? "unknown",
        deliverableHash: hire.spec_hash ?? "0x0",
        priceEth: hire.price_eth ?? "0",
        capability: hire.capability ?? "general",
        wallClockSeconds: receipt.metrics.wall_clock_seconds,
        success: true,
      });
      log({ event: "learnings_extracted", id: cmd.id });

      // Update status to complete
      ctx.db.updateHireRequestStatus(cmd.id, "complete");

      // Clean job directory (keep receipt + memory)
      cleanJobDirectory(hire.agreement_id ?? cmd.id);

      return {
        ok: true,
        data: {
          completed: true,
          id: cmd.id,
          receipt_hash: receipt.receipt_hash,
        },
      };
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

  // Rate limit map cleanup — every 5 minutes (prevents unbounded growth)
  rateLimitCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of rateLimitMap) {
      if (bucket.resetTime < now) rateLimitMap.delete(ip);
    }
  }, 5 * 60 * 1000);

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

  // ── Generate and save API token ──────────────────────────────────────────
  const apiToken = generateApiToken();
  saveApiToken(apiToken);
  log({ event: "auth_token_saved", path: DAEMON_TOKEN_FILE });

  // ── Start IPC socket ─────────────────────────────────────────────────────
  const ipcServer = startIpcServer(ipcCtx, log, apiToken);

  // ── Start HTTP relay server (public endpoint) ────────────────────────────
  const httpPort = config.relay.listen_port ?? 4402;

  /**
   * Optionally verifies X-ARC402-Signature against the request body.
   * Logs the result but never rejects — unsigned requests are accepted for backwards compat.
   */
  function verifyRequestSignature(body: string, req: http.IncomingMessage): void {
    const sig = req.headers["x-arc402-signature"] as string | undefined;
    if (!sig) return;
    const claimedSigner = req.headers["x-arc402-signer"] as string | undefined;
    try {
      const recovered = ethers.verifyMessage(body, sig);
      if (claimedSigner && recovered.toLowerCase() !== claimedSigner.toLowerCase()) {
        log({ event: "sig_mismatch", claimed: claimedSigner, recovered });
      } else {
        log({ event: "sig_verified", signer: recovered });
      }
    } catch {
      log({ event: "sig_invalid" });
    }
  }

  /**
   * Read request body with a size cap. Destroys the request and sends 413
   * if the body exceeds MAX_BODY_SIZE. Returns null in that case.
   */
  function readBody(req: http.IncomingMessage, res: http.ServerResponse): Promise<string | null> {
    return new Promise((resolve) => {
      let body = "";
      let size = 0;
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_SIZE) {
          req.destroy();
          res.writeHead(413, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "payload_too_large" }));
          resolve(null);
          return;
        }
        body += chunk.toString();
      });
      req.on("end", () => { resolve(body); });
      req.on("error", () => { resolve(null); });
    });
  }

  const PUBLIC_GET_PATHS = new Set(["/", "/health", "/agent", "/capabilities", "/status"]);

  // CORS whitelist — localhost for local tooling, arc402.xyz for the web app
  const CORS_WHITELIST = new Set(["localhost", "127.0.0.1", "arc402.xyz", "app.arc402.xyz"]);

  const httpServer = http.createServer(async (req, res) => {
    // CORS — only reflect origin header if it's in the whitelist
    const origin = (req.headers["origin"] ?? "") as string;
    if (origin) {
      try {
        const { hostname } = new URL(origin);
        if (CORS_WHITELIST.has(hostname)) {
          res.setHeader("Access-Control-Allow-Origin", origin);
          res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        }
      } catch { /* ignore invalid origin */ }
    }
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url || "/", `http://localhost:${httpPort}`);
    const pathname = url.pathname;

    // Rate limiting (all endpoints)
    const clientIp = (req.socket.remoteAddress ?? "unknown").replace(/^::ffff:/, "");
    if (!checkRateLimit(clientIp)) {
      log({ event: "rate_limited", ip: clientIp, path: pathname });
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "too_many_requests" }));
      return;
    }

    // Auth required on all POST endpoints (GET public paths are open)
    if (req.method === "POST" || (req.method === "GET" && !PUBLIC_GET_PATHS.has(pathname))) {
      const authHeader = req.headers["authorization"] ?? "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (token !== apiToken) {
        log({ event: "http_unauthorized", ip: clientIp, path: pathname });
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
    }

    // Health / info
    if (pathname === "/" || pathname === "/health") {
      const info = {
        protocol: "arc-402",
        version: "0.3.0",
        agent: config.wallet.contract_address,
        status: "online",
        capabilities: config.policy.allowed_capabilities,
        uptime: Math.floor((Date.now() - ipcCtx.startTime) / 1000),
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(info));
      return;
    }

    // Agent info
    if (pathname === "/agent") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        wallet: config.wallet.contract_address,
        owner: config.wallet.owner_address,
        machineKey: machineKeyAddress,
        chainId: config.network.chain_id,
        bundlerMode: config.bundler.mode,
        relay: config.relay.enabled,
      }));
      return;
    }

    // Receive hire proposal
    if (pathname === "/hire" && req.method === "POST") {
      const body = await readBody(req, res);
      if (body === null) return;
      verifyRequestSignature(body, req);
      try {
          const msg = JSON.parse(body) as Record<string, unknown>;

          // Feed into the hire listener's message handler
          const proposal = {
            messageId: String(msg.messageId ?? msg.id ?? `http_${Date.now()}`),
            hirerAddress: String(msg.hirerAddress ?? msg.hirer_address ?? msg.from ?? ""),
            capability: String(msg.capability ?? ""),
            priceEth: String(msg.priceEth ?? msg.price_eth ?? "0"),
            deadlineUnix: Number(msg.deadlineUnix ?? msg.deadline ?? 0),
            specHash: String(msg.specHash ?? msg.spec_hash ?? ""),
            agreementId: msg.agreementId ? String(msg.agreementId) : undefined,
            signature: msg.signature ? String(msg.signature) : undefined,
          };

          // Dedup
          const existing = db.getHireRequest(proposal.messageId);
          if (existing) {
            log({ event: "hire_duplicate", id: proposal.messageId, status: existing.status });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: existing.status, id: proposal.messageId }));
            return;
          }

          // Policy check
          const { evaluatePolicy } = await import("./hire-listener");
          const activeCount = db.countActiveHireRequests();
          const policyResult = evaluatePolicy(proposal, config, activeCount);

          if (!policyResult.allowed) {
            db.insertHireRequest({
              id: proposal.messageId,
              agreement_id: proposal.agreementId ?? null,
              hirer_address: proposal.hirerAddress,
              capability: proposal.capability,
              price_eth: proposal.priceEth,
              deadline_unix: proposal.deadlineUnix,
              spec_hash: proposal.specHash,
              status: "rejected",
              reject_reason: policyResult.reason ?? "policy_violation",
            });
            log({ event: "http_hire_rejected", id: proposal.messageId, reason: policyResult.reason });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "rejected", reason: policyResult.reason, id: proposal.messageId }));
            return;
          }

          const status = config.policy.auto_accept ? "accepted" : "pending_approval";
          db.insertHireRequest({
            id: proposal.messageId,
            agreement_id: proposal.agreementId ?? null,
            hirer_address: proposal.hirerAddress,
            capability: proposal.capability,
            price_eth: proposal.priceEth,
            deadline_unix: proposal.deadlineUnix,
            spec_hash: proposal.specHash,
            status,
            reject_reason: null,
          });

          log({ event: "http_hire_received", id: proposal.messageId, hirer: proposal.hirerAddress, status });

          if (config.notifications.notify_on_hire_request) {
            await notifier.notifyHireRequest(proposal.messageId, proposal.hirerAddress, proposal.priceEth, proposal.capability);
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status, id: proposal.messageId }));
        } catch (err) {
          log({ event: "http_hire_error", error: String(err) });
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid_request" }));
        }
      return;
    }

    // Handshake acknowledgment endpoint
    if (pathname === "/handshake" && req.method === "POST") {
      const body = await readBody(req, res);
      if (body === null) return;
      verifyRequestSignature(body, req);
      try {
          const msg = JSON.parse(body);
          log({ event: "handshake_received", from: msg.from, type: msg.type, note: msg.note });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ received: true, agent: config.wallet.contract_address }));
        } catch {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid_request" }));
        }
      return;
    }

    // POST /hire/accepted — provider accepted, client notified
    if (pathname === "/hire/accepted" && req.method === "POST") {
      const body = await readBody(req, res);
      if (body === null) return;
      try {
        const msg = JSON.parse(body) as Record<string, unknown>;
        const agreementId = String(msg.agreementId ?? msg.agreement_id ?? "");
        const from = String(msg.from ?? "");
        log({ event: "hire_accepted_inbound", agreementId, from });
        if (config.notifications.notify_on_hire_accepted) {
          await notifier.notifyHireAccepted(agreementId, agreementId);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ received: true, agent: config.wallet.contract_address }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_request" }));
      }
      return;
    }

    // POST /message — off-chain negotiation message
    if (pathname === "/message" && req.method === "POST") {
      const body = await readBody(req, res);
      if (body === null) return;
      verifyRequestSignature(body, req);
      try {
        const msg = JSON.parse(body) as Record<string, unknown>;
        const from = String(msg.from ?? "");
        const to = String(msg.to ?? "");
        const content = String(msg.content ?? "");
        const timestamp = Number(msg.timestamp ?? Date.now());
        log({ event: "message_received", from, to, timestamp, content_len: content.length });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ received: true, agent: config.wallet.contract_address }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_request" }));
      }
      return;
    }

    // POST /delivery — provider committed a deliverable
    if (pathname === "/delivery" && req.method === "POST") {
      const body = await readBody(req, res);
      if (body === null) return;
      verifyRequestSignature(body, req);
      try {
        const msg = JSON.parse(body) as Record<string, unknown>;
        const agreementId = String(msg.agreementId ?? msg.agreement_id ?? "");
        const deliverableHash = String(msg.deliverableHash ?? msg.deliverable_hash ?? "");
        const from = String(msg.from ?? "");
        log({ event: "delivery_received", agreementId, deliverableHash, from });
        // Update DB: mark delivered
        const active = db.listActiveHireRequests();
        const found = active.find(r => r.agreement_id === agreementId);
        if (found) db.updateHireRequestStatus(found.id, "delivered");
        if (config.notifications.notify_on_delivery) {
          await notifier.notifyDelivery(agreementId, deliverableHash, "");
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ received: true, agent: config.wallet.contract_address }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_request" }));
      }
      return;
    }

    // POST /delivery/accepted — client accepted delivery, payment releasing
    if (pathname === "/delivery/accepted" && req.method === "POST") {
      const body = await readBody(req, res);
      if (body === null) return;
      try {
        const msg = JSON.parse(body) as Record<string, unknown>;
        const agreementId = String(msg.agreementId ?? msg.agreement_id ?? "");
        const from = String(msg.from ?? "");
        log({ event: "delivery_accepted_inbound", agreementId, from });
        // Update DB: mark complete
        const all = db.listActiveHireRequests();
        const found = all.find(r => r.agreement_id === agreementId);
        if (found) db.updateHireRequestStatus(found.id, "complete");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ received: true, agent: config.wallet.contract_address }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_request" }));
      }
      return;
    }

    // POST /dispute — dispute raised against this agent
    if (pathname === "/dispute" && req.method === "POST") {
      const body = await readBody(req, res);
      if (body === null) return;
      try {
        const msg = JSON.parse(body) as Record<string, unknown>;
        const agreementId = String(msg.agreementId ?? msg.agreement_id ?? "");
        const reason = String(msg.reason ?? "");
        const from = String(msg.from ?? "");
        log({ event: "dispute_received", agreementId, reason, from });
        if (config.notifications.notify_on_dispute) {
          await notifier.notifyDispute(agreementId, from);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ received: true, agent: config.wallet.contract_address }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_request" }));
      }
      return;
    }

    // POST /dispute/resolved — dispute resolved by arbitrator
    if (pathname === "/dispute/resolved" && req.method === "POST") {
      const body = await readBody(req, res);
      if (body === null) return;
      try {
        const msg = JSON.parse(body) as Record<string, unknown>;
        const agreementId = String(msg.agreementId ?? msg.agreement_id ?? "");
        const outcome = String(msg.outcome ?? "");
        const from = String(msg.from ?? "");
        log({ event: "dispute_resolved_inbound", agreementId, outcome, from });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ received: true, agent: config.wallet.contract_address }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_request" }));
      }
      return;
    }

    // POST /workroom/status — workroom lifecycle events
    if (pathname === "/workroom/status" && req.method === "POST") {
      const body = await readBody(req, res);
      if (body === null) return;
      try {
        const msg = JSON.parse(body) as Record<string, unknown>;
        const event = String(msg.event ?? "");
        const agentAddress = String(msg.agentAddress ?? config.wallet.contract_address);
        const jobId = msg.jobId ? String(msg.jobId) : undefined;
        const timestamp = Number(msg.timestamp ?? Date.now());
        log({ event: "workroom_lifecycle", workroom_event: event, agentAddress, jobId, timestamp });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ received: true, agent: config.wallet.contract_address }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_request" }));
      }
      return;
    }

    // GET /capabilities — agent capabilities from config
    if (pathname === "/capabilities" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        capabilities: config.policy.allowed_capabilities,
        max_price_eth: config.policy.max_price_eth,
        auto_accept: config.policy.auto_accept,
        max_concurrent_agreements: config.relay.max_concurrent_agreements,
      }));
      return;
    }

    // GET /status — health with active agreement count (sensitive counts only for authenticated)
    if (pathname === "/status" && req.method === "GET") {
      const statusAuth = (req.headers["authorization"] ?? "") as string;
      const statusToken = statusAuth.startsWith("Bearer ") ? statusAuth.slice(7) : "";
      const statusAuthed = statusToken === apiToken;
      const statusPayload: Record<string, unknown> = {
        protocol: "arc-402",
        version: "0.3.0",
        agent: config.wallet.contract_address,
        status: "online",
        uptime: Math.floor((Date.now() - ipcCtx.startTime) / 1000),
        capabilities: config.policy.allowed_capabilities,
      };
      if (statusAuthed) {
        statusPayload.active_agreements = db.listActiveHireRequests().length;
        statusPayload.pending_approval = db.listPendingHireRequests().length;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(statusPayload));
      return;
    }

    // 404
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });

  httpServer.listen(httpPort, "0.0.0.0", () => {
    log({ event: "http_server_started", port: httpPort });
  });

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
    if (rateLimitCleanupInterval) clearInterval(rateLimitCleanupInterval);

    // Close HTTP + IPC
    httpServer.close();
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
