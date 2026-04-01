import * as crypto from "crypto";
import { ethers } from "ethers";
import type Database from "better-sqlite3";

export interface SecurityEventRecord {
  id: number;
  event_type: string;
  severity: "info" | "warning" | "critical";
  category: string;
  session_id: string | null;
  wallet: string | null;
  challenge_id: string | null;
  operation: string | null;
  reason: string;
  details: string | null;
  resolved_at: number | null;
  created_at: number;
}

export interface SessionRecord {
  id: string;
  token_hash: string;
  wallet: string;
  requested_scope: string;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
  last_authenticated_at: number;
  last_step_up_at: number | null;
  step_up_expires_at: number | null;
  last_counterparty: string | null;
}

export interface AuthChallengeRecord {
  id: string;
  session_id: string | null;
  wallet: string;
  daemon_id: string;
  chain_id: number;
  requested_scope: string;
  purpose: "login" | "step_up";
  operation: string | null;
  target: string | null;
  counterparty: string | null;
  value_wei: string | null;
  risk_reasons: string;
  issued_at: number;
  expires_at: number;
  used_at: number | null;
}

export interface SimulationRecord {
  id: string;
  session_id: string;
  wallet: string;
  operation: string;
  target: string | null;
  counterparty: string | null;
  value_wei: string | null;
  risk_reasons: string;
  requires_step_up: number;
  created_at: number;
  executed_at: number | null;
}

export interface ChallengeResponse {
  challengeId: string;
  daemonId: string;
  wallet: string;
  chainId: number;
  requestedScope: string[];
  purpose: "login" | "step_up";
  operation?: string | null;
  target?: string | null;
  counterparty?: string | null;
  valueWei?: string | null;
  reasons: string[];
  issuedAt: number;
  expiresAt: number;
  message: string;
}

export interface RiskAssessment {
  requiresStepUp: boolean;
  reasons: string[];
}

export interface SessionManagerOptions {
  db: Database.Database;
  daemonId: string;
  chainId: number;
  ownerAddress: string;
}

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(16).toString("hex")}`;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function parseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function formatChallengeMessage(record: AuthChallengeRecord): string {
  return [
    "ARC-402 auth challenge",
    `challengeId:${record.id}`,
    `daemonId:${record.daemon_id}`,
    `wallet:${record.wallet}`,
    `chainId:${record.chain_id}`,
    `scope:${record.requested_scope}`,
    `purpose:${record.purpose}`,
    `operation:${record.operation ?? ""}`,
    `target:${record.target ?? ""}`,
    `counterparty:${record.counterparty ?? ""}`,
    `valueWei:${record.value_wei ?? ""}`,
    `riskReasons:${record.risk_reasons}`,
    `expiresAt:${record.expires_at}`,
  ].join("\n");
}

export function installSessionSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS remote_sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      wallet TEXT NOT NULL,
      requested_scope TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      last_authenticated_at INTEGER NOT NULL,
      last_step_up_at INTEGER,
      step_up_expires_at INTEGER,
      last_counterparty TEXT
    );

    CREATE TABLE IF NOT EXISTS auth_challenges (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      wallet TEXT NOT NULL,
      daemon_id TEXT NOT NULL,
      chain_id INTEGER NOT NULL,
      requested_scope TEXT NOT NULL,
      purpose TEXT NOT NULL,
      operation TEXT,
      target TEXT,
      counterparty TEXT,
      value_wei TEXT,
      risk_reasons TEXT NOT NULL,
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS security_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      category TEXT NOT NULL,
      session_id TEXT,
      wallet TEXT,
      challenge_id TEXT,
      operation TEXT,
      reason TEXT NOT NULL,
      details TEXT,
      resolved_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS simulated_operations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      wallet TEXT NOT NULL,
      operation TEXT NOT NULL,
      target TEXT,
      counterparty TEXT,
      value_wei TEXT,
      risk_reasons TEXT NOT NULL,
      requires_step_up INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      executed_at INTEGER
    );
  `);
}

export class SessionManager {
  private readonly db: Database.Database;
  private readonly daemonId: string;
  private readonly chainId: number;
  private readonly ownerAddress: string;

  constructor(opts: SessionManagerOptions) {
    this.db = opts.db;
    this.daemonId = opts.daemonId;
    this.chainId = opts.chainId;
    this.ownerAddress = opts.ownerAddress.toLowerCase();
  }

  createChallenge(input: {
    wallet: string;
    requestedScope: string[];
    purpose: "login" | "step_up";
    sessionId?: string | null;
    operation?: string | null;
    target?: string | null;
    counterparty?: string | null;
    valueWei?: string | null;
    reasons?: string[];
  }): ChallengeResponse {
    const now = Date.now();
    const record: AuthChallengeRecord = {
      id: randomId("ch"),
      session_id: input.sessionId ?? null,
      wallet: input.wallet,
      daemon_id: this.daemonId,
      chain_id: this.chainId,
      requested_scope: JSON.stringify(input.requestedScope),
      purpose: input.purpose,
      operation: input.operation ?? null,
      target: input.target ?? null,
      counterparty: input.counterparty ?? null,
      value_wei: input.valueWei ?? null,
      risk_reasons: JSON.stringify(input.reasons ?? []),
      issued_at: now,
      expires_at: now + 5 * 60 * 1000,
      used_at: null,
    };

    this.db
      .prepare(`
        INSERT INTO auth_challenges
          (id, session_id, wallet, daemon_id, chain_id, requested_scope, purpose, operation, target, counterparty, value_wei, risk_reasons, issued_at, expires_at, used_at)
        VALUES
          (@id, @session_id, @wallet, @daemon_id, @chain_id, @requested_scope, @purpose, @operation, @target, @counterparty, @value_wei, @risk_reasons, @issued_at, @expires_at, @used_at)
      `)
      .run(record);

    return {
      challengeId: record.id,
      daemonId: record.daemon_id,
      wallet: record.wallet,
      chainId: record.chain_id,
      requestedScope: parseJsonArray(record.requested_scope),
      purpose: record.purpose,
      operation: record.operation,
      target: record.target,
      counterparty: record.counterparty,
      valueWei: record.value_wei,
      reasons: parseJsonArray(record.risk_reasons),
      issuedAt: record.issued_at,
      expiresAt: record.expires_at,
      message: formatChallengeMessage(record),
    };
  }

  verifyLoginChallenge(challengeId: string, signature: string): { sessionToken: string; session: SessionRecord } {
    const challenge = this.getChallenge(challengeId);
    if (!challenge) {
      throw new Error("challenge_not_found");
    }
    if (challenge.purpose !== "login") {
      throw new Error("challenge_purpose_mismatch");
    }
    this.assertChallengeUsable(challenge, signature);

    const token = crypto.randomBytes(32).toString("hex");
    const now = Date.now();
    const session: SessionRecord = {
      id: randomId("sess"),
      token_hash: hashToken(token),
      wallet: challenge.wallet,
      requested_scope: challenge.requested_scope,
      created_at: now,
      expires_at: now + 24 * 60 * 60 * 1000,
      revoked_at: null,
      last_authenticated_at: now,
      last_step_up_at: null,
      step_up_expires_at: null,
      last_counterparty: null,
    };

    this.db
      .prepare(`
        INSERT INTO remote_sessions
          (id, token_hash, wallet, requested_scope, created_at, expires_at, revoked_at, last_authenticated_at, last_step_up_at, step_up_expires_at, last_counterparty)
        VALUES
          (@id, @token_hash, @wallet, @requested_scope, @created_at, @expires_at, @revoked_at, @last_authenticated_at, @last_step_up_at, @step_up_expires_at, @last_counterparty)
      `)
      .run(session);

    this.markChallengeUsed(challengeId, now);
    return { sessionToken: token, session };
  }

  verifyStepUp(sessionToken: string, challengeId: string, signature: string): SessionRecord {
    const session = this.requireSession(sessionToken);
    const challenge = this.getChallenge(challengeId);
    if (!challenge) {
      throw new Error("challenge_not_found");
    }
    if (challenge.purpose !== "step_up") {
      throw new Error("challenge_purpose_mismatch");
    }
    if (challenge.session_id !== session.id) {
      throw new Error("challenge_session_mismatch");
    }
    this.assertChallengeUsable(challenge, signature);

    const now = Date.now();
    const stepUpExpiresAt = now + 5 * 60 * 1000;
    this.db
      .prepare(`
        UPDATE remote_sessions
        SET last_step_up_at = ?, step_up_expires_at = ?, last_authenticated_at = ?
        WHERE id = ?
      `)
      .run(now, stepUpExpiresAt, now, session.id);
    this.markChallengeUsed(challengeId, now);

    return this.requireSession(sessionToken);
  }

  requireSession(sessionToken: string): SessionRecord {
    const session = this.db
      .prepare(`SELECT * FROM remote_sessions WHERE token_hash = ?`)
      .get(hashToken(sessionToken)) as SessionRecord | undefined;
    if (!session) {
      throw new Error("session_not_found");
    }
    const now = Date.now();
    if (session.revoked_at) {
      throw new Error("session_revoked");
    }
    if (session.expires_at <= now) {
      throw new Error("session_expired");
    }
    return session;
  }

  assessRisk(session: SessionRecord, input: { counterparty?: string | null; valueWei?: string | null }): RiskAssessment {
    const reasons: string[] = [];
    const now = Date.now();
    const valueWei = input.valueWei ? BigInt(input.valueWei) : 0n;
    const highValueThresholdWei = 50_000_000_000_000_000n;

    if (valueWei >= highValueThresholdWei) {
      reasons.push("value_exceeds_step_up_threshold");
    }
    if (input.counterparty && session.last_counterparty && input.counterparty.toLowerCase() !== session.last_counterparty.toLowerCase()) {
      reasons.push("new_counterparty");
    }
    if (input.counterparty && !session.last_counterparty) {
      reasons.push("first_counterparty");
    }
    if (valueWei > 0n && now - session.last_authenticated_at > 5 * 60 * 1000) {
      reasons.push("stale_session_for_value_operation");
    }

    const hasFreshStepUp = !!session.step_up_expires_at && session.step_up_expires_at > now;
    return {
      requiresStepUp: reasons.length > 0 && !hasFreshStepUp,
      reasons,
    };
  }

  createSimulation(session: SessionRecord, input: {
    operation: string;
    target?: string | null;
    counterparty?: string | null;
    valueWei?: string | null;
    riskReasons: string[];
    requiresStepUp: boolean;
  }): SimulationRecord {
    const record: SimulationRecord = {
      id: randomId("sim"),
      session_id: session.id,
      wallet: session.wallet,
      operation: input.operation,
      target: input.target ?? null,
      counterparty: input.counterparty ?? null,
      value_wei: input.valueWei ?? null,
      risk_reasons: JSON.stringify(input.riskReasons),
      requires_step_up: input.requiresStepUp ? 1 : 0,
      created_at: Date.now(),
      executed_at: null,
    };

    this.db
      .prepare(`
        INSERT INTO simulated_operations
          (id, session_id, wallet, operation, target, counterparty, value_wei, risk_reasons, requires_step_up, created_at, executed_at)
        VALUES
          (@id, @session_id, @wallet, @operation, @target, @counterparty, @value_wei, @risk_reasons, @requires_step_up, @created_at, @executed_at)
      `)
      .run(record);
    return record;
  }

  executeSimulation(sessionToken: string, simulationId: string): SimulationRecord {
    const session = this.requireSession(sessionToken);
    const simulation = this.db
      .prepare(`SELECT * FROM simulated_operations WHERE id = ?`)
      .get(simulationId) as SimulationRecord | undefined;
    if (!simulation) {
      throw new Error("simulation_not_found");
    }
    if (simulation.session_id !== session.id) {
      throw new Error("simulation_session_mismatch");
    }
    if (simulation.executed_at) {
      throw new Error("simulation_already_executed");
    }
    if (simulation.requires_step_up) {
      const now = Date.now();
      if (!session.step_up_expires_at || session.step_up_expires_at <= now) {
        throw new Error("step_up_required");
      }
    }

    const executedAt = Date.now();
    this.db
      .prepare(`UPDATE simulated_operations SET executed_at = ? WHERE id = ?`)
      .run(executedAt, simulationId);
    if (simulation.counterparty) {
      this.db
        .prepare(`UPDATE remote_sessions SET last_counterparty = ? WHERE id = ?`)
        .run(simulation.counterparty, session.id);
    }

    return this.db
      .prepare(`SELECT * FROM simulated_operations WHERE id = ?`)
      .get(simulationId) as SimulationRecord;
  }

  logSecurityEvent(input: {
    eventType: string;
    severity: "info" | "warning" | "critical";
    category: string;
    sessionId?: string | null;
    wallet?: string | null;
    challengeId?: string | null;
    operation?: string | null;
    reason: string;
    details?: Record<string, unknown>;
  }): SecurityEventRecord {
    const createdAt = Date.now();
    const result = this.db
      .prepare(`
        INSERT INTO security_events
          (event_type, severity, category, session_id, wallet, challenge_id, operation, reason, details, resolved_at, created_at)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
      `)
      .run(
        input.eventType,
        input.severity,
        input.category,
        input.sessionId ?? null,
        input.wallet ?? null,
        input.challengeId ?? null,
        input.operation ?? null,
        input.reason,
        input.details ? JSON.stringify(input.details) : null,
        createdAt
      );
    return this.db
      .prepare(`SELECT * FROM security_events WHERE id = ?`)
      .get(result.lastInsertRowid) as SecurityEventRecord;
  }

  listSecurityEvents(limit = 50): SecurityEventRecord[] {
    return this.db
      .prepare(`SELECT * FROM security_events ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as SecurityEventRecord[];
  }

  private getChallenge(challengeId: string): AuthChallengeRecord | undefined {
    return this.db
      .prepare(`SELECT * FROM auth_challenges WHERE id = ?`)
      .get(challengeId) as AuthChallengeRecord | undefined;
  }

  private assertChallengeUsable(challenge: AuthChallengeRecord, signature: string): void {
    const now = Date.now();
    if (challenge.used_at) {
      throw new Error("challenge_already_used");
    }
    if (challenge.expires_at <= now) {
      throw new Error("challenge_expired");
    }
    const recovered = ethers.verifyMessage(formatChallengeMessage(challenge), signature).toLowerCase();
    if (recovered !== this.ownerAddress) {
      throw new Error("signature_owner_mismatch");
    }
  }

  private markChallengeUsed(challengeId: string, usedAt: number): void {
    this.db.prepare(`UPDATE auth_challenges SET used_at = ? WHERE id = ?`).run(usedAt, challengeId);
  }
}
