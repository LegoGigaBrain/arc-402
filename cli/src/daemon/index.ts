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
import * as os from "os";
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
import { ComputeMetering } from "./compute-metering";
import { ComputeSessionManager } from "./compute-session";
import { verifyWallet, getWalletBalance } from "./wallet-monitor";
import { buildNotifier } from "./notify";
import { HireListener } from "./hire-listener";
import { UserOpsManager, buildAcceptCalldata, buildFulfillCalldata } from "./userops";
import { generateReceipt, extractLearnings, createJobDirectory, cleanJobDirectory } from "./job-lifecycle";
import { FileDeliveryManager } from "./file-delivery";
import { DeliveryClient } from "./delivery-client";
import { COMPUTE_AGREEMENT_ABI, SERVICE_AGREEMENT_ABI } from "../abis";
import { HandshakeWatcher } from "./handshake-watcher.js";
import { WorkerExecutor } from "./worker-executor.js";

// ─── State DB ─────────────────────────────────────────────────────────────────

export interface HireRequestRow {
  id: string;
  agreement_id: string | null;
  hirer_address: string;
  capability: string;
  price_eth: string;
  deadline_unix: number;
  spec_hash: string;
  task_description: string | null;
  status: string; // pending_approval | accepted | rejected | delivered | complete
  created_at: number;
  updated_at: number;
  reject_reason: string | null;
}

export interface DaemonDB {
  insertHireRequest(row: Omit<HireRequestRow, "created_at" | "updated_at">): void;
  getHireRequest(id: string): HireRequestRow | undefined;
  getHireRequestByAgreementId(agreementId: string): HireRequestRow | undefined;
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
      task_description TEXT,
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

  // Migration: add task_description column to existing DBs that predate this field
  try { db.exec(`ALTER TABLE hire_requests ADD COLUMN task_description TEXT`); } catch { /* already exists */ }

  const insertHireRequest = db.prepare(`
    INSERT OR IGNORE INTO hire_requests
      (id, agreement_id, hirer_address, capability, price_eth, deadline_unix, spec_hash, task_description, status, created_at, updated_at, reject_reason)
    VALUES
      (@id, @agreement_id, @hirer_address, @capability, @price_eth, @deadline_unix, @spec_hash, @task_description, @status, @created_at, @updated_at, @reject_reason)
  `);

  const getHireRequest = db.prepare(`SELECT * FROM hire_requests WHERE id = ?`);
  const getHireRequestByAgreementId = db.prepare(`SELECT * FROM hire_requests WHERE agreement_id = ? ORDER BY created_at DESC LIMIT 1`);
  const updateStatus = db.prepare(`UPDATE hire_requests SET status = ?, reject_reason = ?, updated_at = ? WHERE id = ?`);
  const listPending = db.prepare(`SELECT * FROM hire_requests WHERE status = 'pending_approval' ORDER BY created_at ASC`);
  const listActive = db.prepare(`SELECT * FROM hire_requests WHERE status IN ('accepted') ORDER BY created_at ASC`);
  const countActive = db.prepare(`SELECT COUNT(*) as n FROM hire_requests WHERE status IN ('accepted')`);

  return {
    insertHireRequest(row) {
      const now = Date.now();
      insertHireRequest.run({ ...row, created_at: now, updated_at: now });
    },
    getHireRequest(id) {
      return getHireRequest.get(id) as HireRequestRow | undefined;
    },
    getHireRequestByAgreementId(agreementId) {
      return getHireRequestByAgreementId.get(agreementId) as HireRequestRow | undefined;
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
  workerExecutor: WorkerExecutor | null;
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

    case "worker-status": {
      if (!ctx.workerExecutor) return { ok: true, data: { jobs: [], executor: "disabled" } };
      return { ok: true, data: { jobs: ctx.workerExecutor.listAll() } };
    }

    case "worker-logs": {
      if (!cmd.id) return { ok: false, error: "id required" };
      if (!ctx.workerExecutor) return { ok: false, error: "worker executor not running" };
      const tail = typeof (cmd as { tail?: number }).tail === "number" ? (cmd as { tail?: number }).tail : 100;
      return { ok: true, data: { log: ctx.workerExecutor.readLog(cmd.id, tail) } };
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

// serviceAgreementAddress is now part of DaemonConfig directly (see config.ts)

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

  // Machine key signer — used for UserOp signatures and on-chain compute contract calls
  const machineKeySigner = new ethers.Wallet(machinePrivateKey, provider);

  // ── Step 6: Connect bundler ──────────────────────────────────────────────
  const userOps = new UserOpsManager(config, provider, machineKeySigner);
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
  const notifier = buildNotifier(config);

  // ── File delivery subsystem ──────────────────────────────────────────────
  const fileDelivery = new FileDeliveryManager({
    maxFileSizeMb: config.delivery.max_file_size_mb,
    maxJobSizeMb:  config.delivery.max_job_size_mb,
  });
  fileDelivery.setPartyResolver((agreementId) => {
    const row = db.getHireRequestByAgreementId(agreementId);
    if (!row) return null;
    return {
      hirerAddress:    row.hirer_address,
      providerAddress: config.wallet.contract_address,
    };
  });
  const deliveryClient = new DeliveryClient({ autoDownload: config.delivery.auto_download });
  deliveryClient.log = log;
  log({ event: "file_delivery_ready", serve_files: config.delivery.serve_files, auto_download: config.delivery.auto_download });

  // ── Compute rental subsystem ─────────────────────────────────────────────
  let computeMetering: ComputeMetering | null = null;
  let computeSessions: ComputeSessionManager | null = null;

  if (config.compute.enabled) {
    computeMetering = new ComputeMetering(
      machinePrivateKey,
      config.network.chain_id,
      config.compute.compute_agreement_address || config.wallet.contract_address,
      config.compute.metering_interval_seconds,
      config.compute.report_interval_minutes,
      config.compute.compute_agreement_address ? provider : undefined,
    );
    computeSessions = new ComputeSessionManager(computeMetering);
    log({ event: "compute_enabled", gpu_spec: config.compute.gpu_spec, rate_wei: config.compute.rate_per_hour_wei });
  }

  // ── Worker executor ──────────────────────────────────────────────────────
  const workerExecutor = new WorkerExecutor({
    maxConcurrentJobs: config.worker?.max_concurrent_jobs ?? 2,
    jobTimeoutSeconds: config.worker?.job_timeout_seconds ?? 3600,
    agentType: (config.worker?.agent_type as import("./worker-executor").AgentType | undefined) ?? "claude-code",
    autoExecute: config.worker?.auto_execute ?? true,
    delivery: fileDelivery,
    signer: machineKeySigner,
    serviceAgreementAddress: config.serviceAgreementAddress ?? null,
  });
  workerExecutor.log = log;

  // onJobCompleted: worker finished — submit fulfill UserOp on-chain, update DB, notify
  workerExecutor.onJobCompleted = (agreementId, rootHash) => {
    log({ event: "worker_job_completed", agreement_id: agreementId, root_hash: rootHash });
    const hire = db.getHireRequestByAgreementId(agreementId);
    if (!hire) {
      log({ event: "worker_complete_no_hire", agreement_id: agreementId });
      return;
    }

    // Mark delivered in DB
    db.updateHireRequestStatus(hire.id, "delivered");

    // Submit fulfill UserOp
    if (config.serviceAgreementAddress) {
      const callData = buildFulfillCalldata(
        config.serviceAgreementAddress,
        agreementId,
        rootHash,
        config.wallet.contract_address
      );
      userOps.submit(callData, config.wallet.contract_address)
        .then((hash) => {
          log({ event: "fulfill_userop_submitted", agreement_id: agreementId, userop_hash: hash, root_hash: rootHash });
          // Generate receipt + extract learnings
          const now = new Date().toISOString();
          const startedAt = new Date(hire.created_at).toISOString();
          const receipt = generateReceipt({
            agreementId,
            deliverableHash: rootHash,
            walletAddress: config.wallet.contract_address,
            startedAt,
            completedAt: now,
          });
          extractLearnings({
            agreementId,
            taskDescription: hire.capability ?? "unknown",
            deliverableHash: rootHash,
            priceEth: hire.price_eth ?? "0",
            capability: hire.capability ?? "general",
            wallClockSeconds: receipt.metrics.wall_clock_seconds,
            success: true,
          });
          db.updateHireRequestStatus(hire.id, "complete");
          log({ event: "job_lifecycle_complete", agreement_id: agreementId, receipt_hash: receipt.receipt_hash });
          if (config.notifications.notify_on_delivery) {
            void notifier.notifyDelivery(agreementId, rootHash, "");
          }
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          log({ event: "fulfill_userop_failed", agreement_id: agreementId, error: msg });
          log({ event: "MANUAL_ACCEPT_REQUIRED", agreement_id: agreementId, message: `Run: arc402 deliver ${agreementId} --hash ${rootHash}` });
        });
    }
  };

  // onJobFailed: worker failed — log, update DB, notify operator
  workerExecutor.onJobFailed = (agreementId, error) => {
    log({ event: "worker_job_failed", agreement_id: agreementId, error });
    const hire = db.getHireRequestByAgreementId(agreementId);
    if (hire) {
      db.updateHireRequestStatus(hire.id, "rejected", `worker_failed: ${error}`);
    }
    void notifier.send("hire_rejected", "Job Execution Failed", [
      `Agreement: ${agreementId}`,
      `Error: ${error}`,
      ``,
      `Manual deliver: arc402 deliver ${agreementId} --hash <hash>`,
    ].join("\n")).catch(() => {});
  };

  log({ event: "worker_executor_ready", agent_type: workerExecutor["agentType"], max_concurrent: workerExecutor["maxConcurrentJobs"] });

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
    workerExecutor,
    activeAgreements: 0,
    bundlerMode: config.bundler.mode,
    bundlerEndpoint,
  };

  // Wire approve callback — submits UserOp when hire is auto-accepted, then enqueues execution
  hireListener.setApproveCallback(async (hireId) => {
    const hire = db.getHireRequest(hireId);
    if (!hire || !hire.agreement_id || !config.serviceAgreementAddress) return;

    // Submit accept on-chain via UserOp; if it fails, require manual accept.
    try {
      const callData = buildAcceptCalldata(
        config.serviceAgreementAddress,
        hire.agreement_id,
        config.wallet.contract_address
      );
      const hash = await userOps.submit(callData, config.wallet.contract_address);
      log({ event: "hire_auto_accepted_userop", id: hireId, userop_hash: hash });
      if (config.notifications.notify_on_hire_accepted) {
        await notifier.notifyHireAccepted(hireId, hire.agreement_id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log({ event: "accept_userop_failed", id: hireId, error: msg });
      log({ event: "MANUAL_ACCEPT_REQUIRED", agreement_id: hire.agreement_id, message: `Run: arc402 accept ${hire.agreement_id}` });
    }

    // Enqueue task execution — worker runs the job, then delivers on completion
    workerExecutor.enqueue({
      agreementId: hire.agreement_id,
      capability: hire.capability ?? "general",
      specHash: hire.spec_hash ?? "0x0",
      taskDescription: hire.task_description ?? hire.capability ?? undefined,
    });
    log({ event: "job_enqueued", id: hireId, agreement_id: hire.agreement_id, capability: hire.capability });

    // Seed staged deliverables if configured for this capability
    const stagedDir = config.delivery.staged_dir;
    const capCfg = config.delivery.capabilities?.find(c => c.name === hire.capability);
    if (stagedDir && capCfg) {
      const srcDir = path.join(stagedDir, capCfg.path);
      const jobDir = path.join(os.homedir(), ".arc402", "jobs", `agreement-${hire.agreement_id}`);
      if (fs.existsSync(srcDir)) {
        fs.mkdirSync(jobDir, { recursive: true });
        const files = fs.readdirSync(srcDir);
        for (const file of files) {
          fs.copyFileSync(path.join(srcDir, file), path.join(jobDir, file));
        }
        log({ event: "staged_files_seeded", agreement_id: hire.agreement_id, capability: hire.capability, count: files.length });
      }
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

  // ── Handshake watcher ────────────────────────────────────────────────────
  const handshakeWatcher = new HandshakeWatcher(
    provider,
    '0x4F5A38Bb746d7E5d49d8fd26CA6beD141Ec2DDb3',
    config.wallet.contract_address,
    async (event) => {
      log({ event: "handshake_received", ...event, amount: event.amount.toString() });
    },
    path.join(os.homedir(), '.arc402', 'processed-handshakes.json')
  );
  await handshakeWatcher.start();
  log({ event: "handshake_watcher_started", address: config.wallet.contract_address });

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

  // Protocol POST endpoints — open to external agents (no daemon token required).
  // These are inbound P2P messages: hire proposals, handshakes, delivery notifications, etc.
  // EIP-191 signature in the request body is the trust mechanism, not the daemon bearer token.
  // The bearer token is for operator/admin actions only (approve, reject, status).
  const PUBLIC_POST_PATHS = new Set([
    "/hire",
    "/hire/accepted",
    "/handshake",
    "/message",
    "/delivery",
    "/delivery/accepted",
    "/dispute",
    "/dispute/resolved",
    "/workroom/status",
  ]);

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

    // Auth: protocol POST endpoints are open (P2P — external agents have no daemon token).
    //       Operator GET paths and all non-protocol POSTs require the daemon bearer token.
    //       /job/* GET routes use party-based EIP-191 auth (verifyPartyAccess), not bearer token.
    const isPublicPost = req.method === "POST" && PUBLIC_POST_PATHS.has(pathname);
    const isPublicGet = req.method === "GET" && (PUBLIC_GET_PATHS.has(pathname) || pathname.startsWith("/job/"));
    if (!isPublicPost && !isPublicGet) {
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

          // Resolve hirer address — prefer the on-chain smart wallet client field
          let resolvedHirerAddress = String(msg.hirerAddress ?? msg.hirer_address ?? msg.from ?? "");
          const rawAgreementId = msg.agreementId ? String(msg.agreementId) : undefined;
          if (rawAgreementId && config.serviceAgreementAddress) {
            try {
              const sa = new ethers.Contract(config.serviceAgreementAddress, SERVICE_AGREEMENT_ABI, provider);
              const ag = await sa.getAgreement(BigInt(rawAgreementId)) as { client: string };
              if (ag.client && ag.client !== ethers.ZeroAddress) {
                resolvedHirerAddress = ag.client;
              }
            } catch { /* use fallback */ }
          }

          const taskDescription = String(msg.task ?? msg.taskDescription ?? "");

          // Feed into the hire listener's message handler
          const proposal = {
            messageId: String(msg.messageId ?? msg.id ?? `http_${Date.now()}`),
            hirerAddress: resolvedHirerAddress,
            capability: String(msg.capability ?? msg.serviceType ?? ""),
            priceEth: String(msg.priceEth ?? msg.price_eth ?? "0"),
            deadlineUnix: Number(msg.deadlineUnix ?? msg.deadline ?? 0),
            specHash: String(msg.specHash ?? msg.spec_hash ?? ""),
            agreementId: rawAgreementId,
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
              task_description: taskDescription || null,
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
            task_description: taskDescription || null,
            status,
            reject_reason: null,
          });

          log({ event: "http_hire_received", id: proposal.messageId, hirer: proposal.hirerAddress, status });

          if (config.notifications.notify_on_hire_request) {
            await notifier.notifyHireRequest(proposal.messageId, proposal.hirerAddress, proposal.priceEth, proposal.capability);
          }

          // If auto-accepted, enqueue job for execution immediately, then try to
          // submit accept UserOp on-chain (best-effort — may already be accepted).
          if (status === "accepted" && proposal.agreementId) {
            // Enqueue first — job execution is independent of whether the on-chain
            // accept succeeds (it may already be accepted from a prior call).
            workerExecutor.enqueue({
              agreementId: proposal.agreementId,
              capability: proposal.capability,
              specHash: proposal.specHash,
              taskDescription: taskDescription || undefined,
            });
            log({ event: "http_job_enqueued", id: proposal.messageId, agreement_id: proposal.agreementId });

            // Seed staged deliverables if configured for this capability
            const httpStagedDir = config.delivery.staged_dir;
            const httpCapCfg = config.delivery.capabilities?.find(c => c.name === proposal.capability);
            if (httpStagedDir && httpCapCfg) {
              const srcDir = path.join(httpStagedDir, httpCapCfg.path);
              const jobDir = path.join(os.homedir(), ".arc402", "jobs", `agreement-${proposal.agreementId}`);
              if (fs.existsSync(srcDir)) {
                fs.mkdirSync(jobDir, { recursive: true });
                const files = fs.readdirSync(srcDir);
                for (const file of files) {
                  fs.copyFileSync(path.join(srcDir, file), path.join(jobDir, file));
                }
                log({ event: "staged_files_seeded", agreement_id: proposal.agreementId, capability: proposal.capability, count: files.length });
              }
            }

            // Try to submit accept UserOp (non-blocking, best-effort). If it fails,
            // manual accept is required because ServiceAgreement only accepts the smart wallet.
            if (config.serviceAgreementAddress) {
              void (async () => {
                try {
                  const callData = buildAcceptCalldata(
                    config.serviceAgreementAddress!,
                    proposal.agreementId!,
                    config.wallet.contract_address
                  );
                  const hash = await userOps.submit(callData, config.wallet.contract_address);
                  log({ event: "http_accept_userop_submitted", id: proposal.messageId, hash });
                  if (config.notifications.notify_on_hire_accepted) {
                    await notifier.notifyHireAccepted(proposal.messageId, proposal.agreementId!);
                  }
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  log({ event: "http_accept_userop_failed", id: proposal.messageId, error: msg });
                  log({ event: "MANUAL_ACCEPT_REQUIRED", agreement_id: proposal.agreementId, message: `Run: arc402 accept ${proposal.agreementId}` });
                }
              })();
            }
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
        const filesUrl = String(msg.files_url ?? msg.filesUrl ?? "");
        const from = String(msg.from ?? "");
        log({ event: "delivery_received", agreementId, deliverableHash, from, has_files_url: !!filesUrl });
        // Update DB: mark delivered
        const active = db.listActiveHireRequests();
        const found = active.find(r => r.agreement_id === agreementId);
        if (found) db.updateHireRequestStatus(found.id, "delivered");
        if (config.notifications.notify_on_delivery) {
          await notifier.notifyDelivery(agreementId, deliverableHash, "");
        }
        // Auto-download and verify if files_url provided and auto_download enabled
        if (filesUrl && config.delivery.auto_download) {
          void deliveryClient.handleDeliveryNotification({ agreementId, deliverableHash, filesUrl })
            .then(result => {
              if (result) log({ event: "delivery_auto_downloaded", agreementId, ok: result.ok, root_hash_match: result.rootHashMatch, files: result.fileResults.length });
            })
            .catch(err => log({ event: "delivery_download_error", agreementId, error: String(err) }));
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
        if (config.delivery.serve_files) {
          const deliveriesDir = path.join(DAEMON_DIR, "deliveries");
          let totalDeliveries = 0, totalFiles = 0;
          if (fs.existsSync(deliveriesDir)) {
            const entries = fs.readdirSync(deliveriesDir);
            totalDeliveries = entries.length;
            for (const entry of entries) {
              const entryPath = path.join(deliveriesDir, entry);
              if (fs.statSync(entryPath).isDirectory()) {
                totalFiles += fs.readdirSync(entryPath).filter(f => f !== "_manifest.json").length;
              }
            }
          }
          statusPayload.file_delivery = { total_deliveries: totalDeliveries, total_files: totalFiles };
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(statusPayload));
      return;
    }

    // ── Compute rental routes ─────────────────────────────────────────────

    // POST /compute/propose — client proposes a compute session
    if (pathname === "/compute/propose" && req.method === "POST") {
      const body = await readBody(req, res);
      if (body === null) return;
      try {
        const msg = JSON.parse(body) as Record<string, unknown>;
        if (!computeSessions) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "compute_disabled" }));
          return;
        }
        const proposal = {
          sessionId:           String(msg.sessionId ?? ""),
          clientAddress:       String(msg.clientAddress ?? msg.client ?? ""),
          providerAddress:     config.wallet.contract_address,
          ratePerHourWei:      config.compute.rate_per_hour_wei,
          maxHours:            Number(msg.maxHours ?? 1),
          gpuSpecHash:         String(msg.gpuSpecHash ?? "0x0000000000000000000000000000000000000000000000000000000000000000"),
          workloadDescription: String(msg.workloadDescription ?? ""),
          depositAmount:       String(msg.depositAmount ?? "0"),
          proposedAt:          Math.floor(Date.now() / 1000),
        };
        if (!proposal.sessionId) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "sessionId required" }));
          return;
        }
        // Check capacity
        const activeSessions = computeSessions.countByStatus("active");
        if (activeSessions >= config.compute.max_concurrent_sessions) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "rejected", reason: "at_capacity" }));
          return;
        }
        const result = computeSessions.handleProposal(proposal);
        if (!result.ok) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: result.error }));
          return;
        }
        log({ event: "compute_proposed", sessionId: proposal.sessionId, client: proposal.clientAddress });
        // Auto-accept if configured
        if (config.compute.auto_accept_compute) {
          computeSessions.acceptSession(proposal.sessionId);
          log({ event: "compute_auto_accepted", sessionId: proposal.sessionId });
          // Wire to on-chain: provider calls acceptSession
          if (config.compute.compute_agreement_address) {
            try {
              const caContract = new ethers.Contract(config.compute.compute_agreement_address, COMPUTE_AGREEMENT_ABI, machineKeySigner);
              const tx = await caContract.acceptSession(proposal.sessionId);
              await tx.wait();
              log({ event: "compute_accept_onchain", sessionId: proposal.sessionId, txHash: tx.hash });
            } catch (onchainErr) {
              log({ event: "compute_accept_onchain_error", sessionId: proposal.sessionId, error: String(onchainErr) });
            }
          }
        }
        const status = config.compute.auto_accept_compute ? "accepted" : "proposed";
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status, sessionId: proposal.sessionId }));
      } catch (err) {
        log({ event: "compute_propose_error", error: String(err) });
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_request" }));
      }
      return;
    }

    // POST /compute/accept — provider accepts a proposed session
    if (pathname === "/compute/accept" && req.method === "POST") {
      const body = await readBody(req, res);
      if (body === null) return;
      try {
        const msg = JSON.parse(body) as Record<string, unknown>;
        const sessionId = String(msg.sessionId ?? "");
        if (!computeSessions) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "compute_disabled" }));
          return;
        }
        const result = computeSessions.acceptSession(sessionId);
        if (!result.ok) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: result.error }));
          return;
        }
        log({ event: "compute_accepted", sessionId });
        // Wire to on-chain: provider calls acceptSession
        if (config.compute.compute_agreement_address) {
          try {
            const caContract = new ethers.Contract(config.compute.compute_agreement_address, COMPUTE_AGREEMENT_ABI, machineKeySigner);
            const tx = await caContract.acceptSession(sessionId);
            await tx.wait();
            log({ event: "compute_accept_onchain", sessionId, txHash: tx.hash });
          } catch (onchainErr) {
            log({ event: "compute_accept_onchain_error", sessionId, error: String(onchainErr) });
          }
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "accepted", sessionId }));
      } catch (err) {
        log({ event: "compute_accept_error", error: String(err) });
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_request" }));
      }
      return;
    }

    // POST /compute/started — provider marks session as started
    if (pathname === "/compute/started" && req.method === "POST") {
      const body = await readBody(req, res);
      if (body === null) return;
      try {
        const msg = JSON.parse(body) as Record<string, unknown>;
        const sessionId      = String(msg.sessionId ?? "");
        const accessEndpoint = msg.accessEndpoint ? String(msg.accessEndpoint) : undefined;
        if (!computeSessions) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "compute_disabled" }));
          return;
        }
        const result = computeSessions.startSession(sessionId, accessEndpoint);
        if (!result.ok) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: result.error }));
          return;
        }
        log({ event: "compute_started", sessionId });
        // Wire to on-chain: provider calls startSession
        if (config.compute.compute_agreement_address) {
          try {
            const caContract = new ethers.Contract(config.compute.compute_agreement_address, COMPUTE_AGREEMENT_ABI, machineKeySigner);
            const tx = await caContract.startSession(sessionId);
            await tx.wait();
            log({ event: "compute_start_onchain", sessionId, txHash: tx.hash });
          } catch (onchainErr) {
            log({ event: "compute_start_onchain_error", sessionId, error: String(onchainErr) });
          }
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "active", sessionId }));
      } catch (err) {
        log({ event: "compute_started_error", error: String(err) });
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_request" }));
      }
      return;
    }

    // POST /compute/metrics — get current metrics (polling endpoint)
    if (pathname === "/compute/metrics" && req.method === "POST") {
      const body = await readBody(req, res);
      if (body === null) return;
      try {
        const msg = JSON.parse(body) as Record<string, unknown>;
        const sessionId = String(msg.sessionId ?? "");
        if (!computeMetering || !computeSessions) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "compute_disabled" }));
          return;
        }
        const session = computeSessions.getSession(sessionId);
        if (!session) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "session_not_found" }));
          return;
        }
        const current = computeMetering.getCurrentMetrics(sessionId);
        const reports = computeMetering.getUsageReports(sessionId);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ sessionId, current, reports, consumedMinutes: session.consumedMinutes }));
      } catch (err) {
        log({ event: "compute_metrics_error", error: String(err) });
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_request" }));
      }
      return;
    }

    // POST /compute/end — either party ends the session
    if (pathname === "/compute/end" && req.method === "POST") {
      const body = await readBody(req, res);
      if (body === null) return;
      try {
        const msg = JSON.parse(body) as Record<string, unknown>;
        const sessionId = String(msg.sessionId ?? "");
        if (!computeSessions) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "compute_disabled" }));
          return;
        }
        const endResult = await computeSessions.endSession(sessionId);
        if (!endResult.ok) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: endResult.error }));
          return;
        }
        const r = endResult.result!;
        log({
          event: "compute_ended",
          sessionId,
          consumedMinutes: r.consumedMinutes,
          costWei: r.costWei.toString(),
          refundWei: r.refundWei.toString(),
        });
        // Wire to on-chain: call endSession
        if (config.compute.compute_agreement_address) {
          try {
            const caContract = new ethers.Contract(config.compute.compute_agreement_address, COMPUTE_AGREEMENT_ABI, machineKeySigner);
            const tx = await caContract.endSession(sessionId);
            await tx.wait();
            log({ event: "compute_end_onchain", sessionId, txHash: tx.hash });
          } catch (onchainErr) {
            log({ event: "compute_end_onchain_error", sessionId, error: String(onchainErr) });
          }
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status:          "completed",
          sessionId,
          consumedMinutes: r.consumedMinutes,
          costWei:         r.costWei.toString(),
          refundWei:       r.refundWei.toString(),
          reports:         r.reports,
        }));
      } catch (err) {
        log({ event: "compute_end_error", error: String(err) });
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_request" }));
      }
      return;
    }

    // POST /compute/dispute — client disputes a session
    if (pathname === "/compute/dispute" && req.method === "POST") {
      const body = await readBody(req, res);
      if (body === null) return;
      try {
        const msg = JSON.parse(body) as Record<string, unknown>;
        const sessionId = String(msg.sessionId ?? "");
        if (!computeSessions) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "compute_disabled" }));
          return;
        }
        const result = computeSessions.disputeSession(sessionId);
        if (!result.ok) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: result.error }));
          return;
        }
        log({ event: "compute_disputed", sessionId });
        if (config.notifications.notify_on_dispute) {
          await notifier.notifyDispute(sessionId, String(msg.from ?? "client"));
        }
        // Wire to on-chain: call disputeSession
        if (config.compute.compute_agreement_address) {
          try {
            const caContract = new ethers.Contract(config.compute.compute_agreement_address, COMPUTE_AGREEMENT_ABI, machineKeySigner);
            const tx = await caContract.disputeSession(sessionId);
            await tx.wait();
            log({ event: "compute_dispute_onchain", sessionId, txHash: tx.hash });
          } catch (onchainErr) {
            log({ event: "compute_dispute_onchain_error", sessionId, error: String(onchainErr) });
          }
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "disputed", sessionId }));
      } catch (err) {
        log({ event: "compute_dispute_error", error: String(err) });
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid_request" }));
      }
      return;
    }

    // GET /compute/session/:id — session details
    if (pathname.startsWith("/compute/session/") && req.method === "GET") {
      const sessionId = pathname.slice("/compute/session/".length);
      if (!computeSessions) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "compute_disabled" }));
        return;
      }
      const session = computeSessions.getSession(sessionId);
      if (!session) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "session_not_found" }));
        return;
      }
      const current = computeMetering ? computeMetering.getCurrentMetrics(sessionId) : null;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ session, current }));
      return;
    }

    // GET /compute/sessions — list all sessions
    if (pathname === "/compute/sessions" && req.method === "GET") {
      if (!computeSessions) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "compute_disabled" }));
        return;
      }
      const sessions = computeSessions.listSessions();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sessions, count: sessions.length }));
      return;
    }

    // ── File delivery routes ──────────────────────────────────────────────
    // POST /job/:id/upload — store a file (daemon auth required via global gate above)
    if (pathname.startsWith("/job/") && req.method === "POST") {
      const parts = pathname.split("/");
      // /job/<id>/upload → ["", "job", "<id>", "upload"]
      if (parts.length === 4 && parts[3] === "upload") {
        const agreementId = parts[2];
        if (!config.delivery.serve_files) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "file_delivery_disabled" }));
          return;
        }
        await fileDelivery.handleUpload(req, res, agreementId, log);
        return;
      }
    }

    // GET /job/:id/files, GET /job/:id/files/:name, GET /job/:id/manifest — party-gated
    if (pathname.startsWith("/job/") && req.method === "GET") {
      const parts = pathname.split("/");
      // /job/<id>/files/<name> → ["", "job", "<id>", "files", "<name>"]
      if (parts.length === 5 && parts[3] === "files") {
        const agreementId = parts[2];
        const filename = decodeURIComponent(parts[4]);
        if (!config.delivery.serve_files) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "file_delivery_disabled" }));
          return;
        }
        fileDelivery.handleDownloadFile(req, res, agreementId, filename, apiToken, log);
        return;
      }
      // /job/<id>/files → ["", "job", "<id>", "files"]
      if (parts.length === 4 && parts[3] === "files") {
        const agreementId = parts[2];
        if (!config.delivery.serve_files) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "file_delivery_disabled" }));
          return;
        }
        fileDelivery.handleListFiles(req, res, agreementId, apiToken, log);
        return;
      }
      // /job/<id>/manifest → ["", "job", "<id>", "manifest"]
      if (parts.length === 4 && parts[3] === "manifest") {
        const agreementId = parts[2];
        if (!config.delivery.serve_files) {
          res.writeHead(503, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "file_delivery_disabled" }));
          return;
        }
        fileDelivery.handleManifest(req, res, agreementId, apiToken, log);
        return;
      }
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

    // Stop on-chain watchers
    await handshakeWatcher.stop();

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
