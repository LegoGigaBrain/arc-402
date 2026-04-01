/**
 * arc402-api — public HTTP process (Spec 46 §16 Pattern 1).
 *
 * Handles all external HTTPS requests. Has NO access to the machine key.
 * Routes execution intents to arc402-signer via Unix socket.
 *
 * Responsibilities:
 *   - Session validation middleware
 *   - Auth endpoints (challenge/session/revoke)
 *   - SSE event stream
 *   - Commerce endpoints (proxied to signer for signing)
 *   - Read-only endpoints (agreements, workroom status)
 *
 * The machine key env var is explicitly excluded when this process is
 * forked by index.ts — see index.ts.
 */
import express, { Request, Response, NextFunction } from "express";
import * as net from "net";
import * as crypto from "crypto";
import * as path from "path";
import * as os from "os";
import * as http from "http";
import Database from "better-sqlite3";
import { loadDaemonConfig } from "./config";
import { registerAuthRoutes, type AuthServerConfig } from "./auth-server";
import { SESSION_FORBIDDEN, isCapabilityAllowed } from "./capabilities";
import { SIGNER_SOCKET_PATH, type SignRequest, type SignResponse } from "./signer";
import { EndpointPolicy, hasExplicitCommerceDelegation, resolveJobId } from "./endpoint-policy";
import { guardTaskContent } from "./prompt-guard";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionRow {
  id: string;
  token_hash: string;
  wallet: string;
  scope: string;
  expires_at: number;
  issued_at: number;
  revoked: number;
}

interface AuthenticatedRequest extends Request {
  session: SessionRow;
}

// ─── Capability routing ───────────────────────────────────────────────────────

function routeToCapability(method: string, urlPath: string): string {
  if (method === "POST" && urlPath === "/hire")               return "agreement.propose";
  if (method === "POST" && urlPath === "/deliver")            return "agreement.deliver";
  if (method === "POST" && urlPath === "/verify")             return "agreement.verify";
  if (method === "POST" && urlPath === "/subscribe")          return "subscribe";
  if (method === "GET"  && urlPath === "/agreements")         return "agreement.read";
  if (method === "GET"  && urlPath === "/workroom/status")    return "workroom.status";
  if (method === "POST" && urlPath === "/auth/revoke")        return "session.revoke:self";
  if (urlPath.startsWith("/arena/"))                          return `arena.${urlPath.slice(7)}`;
  return `${method.toLowerCase()}${urlPath.replace(/\//g, ".")}`;
}

// ─── Signer IPC ───────────────────────────────────────────────────────────────

async function callSigner(request: SignRequest): Promise<SignResponse> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(SIGNER_SOCKET_PATH);
    let buf = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error("signer timeout (10s)"));
      }
    }, 10_000);

    socket.once("connect", () => {
      socket.write(JSON.stringify(request) + "\n");
    });

    socket.on("data", (chunk) => {
      buf += chunk.toString();
      const newlineIdx = buf.indexOf("\n");
      if (newlineIdx >= 0 && !settled) {
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        const line = buf.slice(0, newlineIdx).trim();
        try {
          resolve(JSON.parse(line) as SignResponse);
        } catch {
          reject(new Error("invalid signer response JSON"));
        }
      }
    });

    socket.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(err);
      }
    });
  });
}

// ─── Session middleware ───────────────────────────────────────────────────────

function createSessionMiddleware(db: Database.Database) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers["authorization"];
    const token = authHeader?.replace("Bearer ", "");
    if (!token) {
      res.status(401).json({ error: "no_session" });
      return;
    }

    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const session = db.prepare(
      "SELECT * FROM sessions WHERE token_hash = ? AND expires_at > ? AND revoked = 0"
    ).get(hash, Date.now()) as SessionRow | undefined;

    if (!session) {
      res.status(401).json({ error: "invalid_session" });
      return;
    }

    const capability = routeToCapability(req.method, req.path);
    if (SESSION_FORBIDDEN.has(capability)) {
      res.status(403).json({ error: "AUTHZ_DENIED", capability });
      return;
    }
    if (!isCapabilityAllowed(capability)) {
      res.status(403).json({ error: "AUTHZ_DENIED", capability });
      return;
    }

    (req as AuthenticatedRequest).session = session;
    next();
  };
}

// ─── SSE event stream ─────────────────────────────────────────────────────────

const sseClients = new Set<Response>();

function sseHandler(req: Request, res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  sseClients.add(res);

  const keepalive = setInterval(() => {
    res.write(": keepalive\n\n");
  }, 30_000);

  req.on("close", () => {
    clearInterval(keepalive);
    sseClients.delete(res);
  });
}

export function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

// ─── Commerce handler helper ──────────────────────────────────────────────────

function makeCommerceHandler(
  category: string,
  policyEngineAddress: string,
  rpcUrl: string
) {
  return async (req: Request, res: Response): Promise<void> => {
    const session = (req as AuthenticatedRequest).session;
    const { target, value, data } = req.body as {
      target?: string;
      value?: string;
      data?: string;
    };
    if (!target || !data) {
      res.status(400).json({ error: "target and data required" });
      return;
    }

    const signReq: SignRequest = {
      requestId: crypto.randomBytes(16).toString("hex"),
      sessionId: session.id,
      wallet: session.wallet,
      target,
      value: value ?? "0",
      data,
      category,
      policyEngineAddress,
      rpcUrl,
    };

    try {
      const result = await callSigner(signReq);
      if (!result.ok) {
        res.status(403).json({ error: result.error });
        return;
      }
      broadcast(`${category}.submitted`, { requestId: signReq.requestId, wallet: session.wallet });
      res.json({ ok: true, requestId: signReq.requestId, signedUserOp: result.signedUserOp });
    } catch (err: unknown) {
      res.status(503).json({
        error: "signer_unavailable",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  };
}

// ─── Server factory ───────────────────────────────────────────────────────────

export interface ApiConfig {
  port: number;
  daemonId: string;
  rpcUrl: string;
  chainId: number;
  walletAddress: string;
  policyEngineAddress: string;
  db: Database.Database;
}

function collectInboundTaskTexts(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const record = body as Record<string, unknown>;
  const values = [
    record.task,
    record.taskDescription,
    record.task_description,
    record.content,
    record.prompt,
    record.workloadDescription,
    record.workload_description,
  ];
  return values.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

export function createApiServer(apiConfig: ApiConfig): express.Express {
  const app = express();
  const { db, rpcUrl, policyEngineAddress } = apiConfig;
  const sessionMiddleware = createSessionMiddleware(db);
  const endpointPolicy = new EndpointPolicy();

  app.use(express.json({ limit: "1mb" }));
  app.use((req: Request, res: Response, next: NextFunction): void => {
    const jobId = resolveJobId(req.headers);
    if (jobId) {
      endpointPolicy.lockForJob(jobId);
      if (hasExplicitCommerceDelegation(req.body, req.path)) {
        endpointPolicy.grantCommerceDelegate(jobId);
      }
      if (!endpointPolicy.isAllowed(jobId, req.path)) {
        res.status(403).json({
          error: "commerce_delegation_required",
          reason: "This job was not granted commerce delegation. The worker agent cannot initiate hires or subscriptions.",
        });
        return;
      }
    }

    for (const text of collectInboundTaskTexts(req.body)) {
      const guardResult = guardTaskContent(text);
      if (!guardResult.safe) {
        res.status(400).json({
          error: "task_rejected",
          reason: "Task content failed security screening",
          code: "PROMPT_INJECTION_DETECTED",
          category: guardResult.category,
        });
        return;
      }
    }
    next();
  });

  // ── Health ──────────────────────────────────────────────────────────────────
  app.get("/health", (_req, res) => {
    res.json({ ok: true, wallet: apiConfig.walletAddress });
  });

  // ── SSE ─────────────────────────────────────────────────────────────────────
  app.get("/events", sseHandler);

  // ── Auth ─────────────────────────────────────────────────────────────────────
  const authCfg: AuthServerConfig = {
    daemonId: apiConfig.daemonId,
    rpcUrl,
    chainId: apiConfig.chainId,
    walletAddress: apiConfig.walletAddress,
  };
  registerAuthRoutes(app, db, authCfg);

  // ── Commerce (execution — proxied to signer) ─────────────────────────────────
  app.post("/hire",      sessionMiddleware, makeCommerceHandler("hire",      policyEngineAddress, rpcUrl));
  app.post("/deliver",   sessionMiddleware, makeCommerceHandler("deliver",   policyEngineAddress, rpcUrl));
  app.post("/verify",    sessionMiddleware, makeCommerceHandler("verify",    policyEngineAddress, rpcUrl));
  app.post("/subscribe", sessionMiddleware, makeCommerceHandler("subscribe", policyEngineAddress, rpcUrl));

  // ── Read endpoints (no signer needed) ───────────────────────────────────────
  app.get("/agreements", sessionMiddleware, (req: Request, res: Response): void => {
    const session = (req as AuthenticatedRequest).session;
    // hire_requests table uses hirer_address; include both sides
    const rows = db.prepare(
      `SELECT * FROM hire_requests
       WHERE hirer_address = ? OR (agreement_id IS NOT NULL)
       ORDER BY created_at DESC LIMIT 50`
    ).all(session.wallet);
    res.json({ ok: true, agreements: rows });
  });

  app.get("/workroom/status", sessionMiddleware, (_req: Request, res: Response): void => {
    res.json({ ok: true, status: "running" });
  });

  return app;
}

// ─── Standalone process entrypoint ───────────────────────────────────────────

async function main(): Promise<void> {
  const config = loadDaemonConfig();

  const dbPath = path.join(os.homedir(), ".arc402", "daemon.db");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  // Ensure session + challenge tables exist (idempotent)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      token_hash  TEXT NOT NULL UNIQUE,
      wallet      TEXT NOT NULL,
      scope       TEXT NOT NULL,
      expires_at  INTEGER NOT NULL,
      issued_at   INTEGER NOT NULL,
      revoked     INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS auth_challenges (
      challenge_id  TEXT PRIMARY KEY,
      daemon_id     TEXT NOT NULL,
      wallet        TEXT NOT NULL,
      chain_id      INTEGER NOT NULL,
      scope         TEXT NOT NULL,
      expires_at    INTEGER NOT NULL,
      used          INTEGER DEFAULT 0
    );
  `);

  const apiConfig: ApiConfig = {
    port: (config.relay.listen_port ?? 4402) + 1, // 4403 — separate from legacy HTTP port
    daemonId: config.wallet.contract_address,
    rpcUrl: config.network.rpc_url,
    chainId: config.network.chain_id,
    walletAddress: config.wallet.contract_address,
    policyEngineAddress: config.policyEngineAddress ?? process.env.ARC402_POLICY_ENGINE ?? "",
    db,
  };

  const app = createApiServer(apiConfig);
  const server = http.createServer(app);

  server.listen(apiConfig.port, "0.0.0.0", () => {
    process.stdout.write(`[api] HTTP server ready on port ${apiConfig.port}\n`);
  });

  process.on("SIGTERM", () => { server.close(); db.close(); process.exit(0); });
  process.on("SIGINT",  () => { server.close(); db.close(); process.exit(0); });
}

main().catch((err: unknown) => {
  process.stderr.write(
    `[api] Fatal: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
