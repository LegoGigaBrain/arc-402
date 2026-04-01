import { SessionManager } from "./session-manager";
import type { SecurityThreatEventPayload, StepUpRequiredEventPayload } from "./api";

type LogFn = (entry: Record<string, unknown>) => void;

export class AuthServer {
  constructor(
    private readonly sessions: SessionManager,
    private readonly events: {
      emitSecurityThreat: (payload: SecurityThreatEventPayload) => void;
      emitStepUpRequired: (payload: StepUpRequiredEventPayload) => void;
      emitStepUpCompleted: (payload: Record<string, unknown>) => void;
      emitEvent: (type: "exec.simulated" | "exec.executed", payload: Record<string, unknown>) => void;
    },
    private readonly log: LogFn
  ) {}

  issueLoginChallenge(wallet: string, requestedScope: string[]) {
    return this.sessions.createChallenge({
      wallet,
      requestedScope,
      purpose: "login",
    });
  }

  verifyLogin(challengeId: string, signature: string) {
    try {
      return this.sessions.verifyLoginChallenge(challengeId, signature);
    } catch (error) {
      this.recordThreat({
        severity: "warning",
        category: "auth.login",
        reason: error instanceof Error ? error.message : String(error),
        challengeId,
      });
      throw error;
    }
  }

  handleStepUp(body: {
    sessionToken: string;
    challengeId?: string;
    signature?: string;
    operation?: string;
    target?: string;
    counterparty?: string;
    valueWei?: string;
  }) {
    const session = this.sessions.requireSession(body.sessionToken);

    if (body.challengeId && body.signature) {
      try {
        const updated = this.sessions.verifyStepUp(body.sessionToken, body.challengeId, body.signature);
        this.events.emitStepUpCompleted({
          sessionId: updated.id,
          wallet: updated.wallet,
          stepUpExpiresAt: updated.step_up_expires_at,
        });
        return {
          status: "verified" as const,
          sessionId: updated.id,
          stepUpExpiresAt: updated.step_up_expires_at,
        };
      } catch (error) {
        this.recordThreat({
          severity: "critical",
          category: "auth.step_up",
          reason: error instanceof Error ? error.message : String(error),
          sessionId: session.id,
          wallet: session.wallet,
          challengeId: body.challengeId,
          operation: body.operation,
        });
        throw error;
      }
    }

    const risk = this.sessions.assessRisk(session, {
      counterparty: body.counterparty,
      valueWei: body.valueWei,
    });
    const challenge = this.sessions.createChallenge({
      wallet: session.wallet,
      requestedScope: JSON.parse(session.requested_scope) as string[],
      purpose: "step_up",
      sessionId: session.id,
      operation: body.operation,
      target: body.target,
      counterparty: body.counterparty,
      valueWei: body.valueWei,
      reasons: risk.reasons.length > 0 ? risk.reasons : ["operator_requested_step_up"],
    });

    const payload: StepUpRequiredEventPayload = {
      sessionId: session.id,
      wallet: session.wallet,
      operation: body.operation ?? "userop.execute",
      challengeId: challenge.challengeId,
      reason: challenge.reasons[0] ?? "step_up_required",
      reasons: challenge.reasons,
      expiresAt: challenge.expiresAt,
      requestedScope: challenge.requestedScope,
      target: challenge.target,
      counterparty: challenge.counterparty,
      valueWei: challenge.valueWei,
    };
    this.events.emitStepUpRequired(payload);
    this.log({ event: "step_up_challenge_issued", sessionId: session.id, challengeId: challenge.challengeId, reasons: challenge.reasons });
    return { status: "challenge_required" as const, challenge };
  }

  simulateUserOp(body: {
    sessionToken: string;
    operation: string;
    target?: string;
    counterparty?: string;
    valueWei?: string;
  }) {
    const session = this.sessions.requireSession(body.sessionToken);
    const risk = this.sessions.assessRisk(session, {
      counterparty: body.counterparty,
      valueWei: body.valueWei,
    });

    if (risk.requiresStepUp) {
      const challenge = this.handleStepUp({
        sessionToken: body.sessionToken,
        operation: body.operation,
        target: body.target,
        counterparty: body.counterparty,
        valueWei: body.valueWei,
      });
      return {
        requiresStepUp: true,
        reasons: risk.reasons,
        challenge,
      };
    }

    const simulation = this.sessions.createSimulation(session, {
      operation: body.operation,
      target: body.target,
      counterparty: body.counterparty,
      valueWei: body.valueWei,
      riskReasons: risk.reasons,
      requiresStepUp: false,
    });
    this.events.emitEvent("exec.simulated", {
      simulationId: simulation.id,
      sessionId: simulation.session_id,
      wallet: simulation.wallet,
      operation: simulation.operation,
      target: simulation.target,
      counterparty: simulation.counterparty,
      valueWei: simulation.value_wei,
    });
    return {
      requiresStepUp: false,
      simulationId: simulation.id,
      reasons: risk.reasons,
    };
  }

  executeUserOp(body: { sessionToken: string; simulationId: string }) {
    try {
      const simulation = this.sessions.executeSimulation(body.sessionToken, body.simulationId);
      this.events.emitEvent("exec.executed", {
        simulationId: simulation.id,
        sessionId: simulation.session_id,
        wallet: simulation.wallet,
        operation: simulation.operation,
        target: simulation.target,
        counterparty: simulation.counterparty,
        valueWei: simulation.value_wei,
        executedAt: simulation.executed_at,
      });
      return simulation;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (reason === "step_up_required") {
        this.recordThreat({
          severity: "warning",
          category: "auth.step_up",
          reason,
          operation: "userop.execute",
        });
      }
      throw error;
    }
  }

  listSecurityEvents(limit?: number) {
    return this.sessions.listSecurityEvents(limit);
  }

  recordThreat(input: {
    severity: "info" | "warning" | "critical";
    category: string;
    reason: string;
    sessionId?: string | null;
    wallet?: string | null;
    challengeId?: string | null;
    operation?: string | null;
    details?: Record<string, unknown>;
  }) {
    const record = this.sessions.logSecurityEvent({
      eventType: "security_threat",
      severity: input.severity,
      category: input.category,
      sessionId: input.sessionId,
      wallet: input.wallet,
      challengeId: input.challengeId,
      operation: input.operation,
      reason: input.reason,
      details: input.details,
    });
    this.events.emitSecurityThreat({
      id: record.id,
      severity: record.severity,
      category: record.category,
      reason: record.reason,
      operation: record.operation,
      wallet: record.wallet,
      sessionId: record.session_id,
      challengeId: record.challenge_id,
      details: record.details ? (JSON.parse(record.details) as Record<string, unknown>) : undefined,
      createdAt: record.created_at,
    });
    this.log({ event: "security_event_logged", id: record.id, category: record.category, severity: record.severity, reason: record.reason });
    return record;
  }
}
