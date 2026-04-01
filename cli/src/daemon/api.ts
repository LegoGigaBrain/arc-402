import * as http from "http";

export type DaemonEventType =
  | "security_threat"
  | "auth.step_up_required"
  | "auth.step_up_completed"
  | "exec.simulated"
  | "exec.executed"
  | "handshake_received"
  | "job_started"
  | "job_completed"
  | "job_failed";

export interface SecurityThreatEventPayload {
  id?: number;
  severity: "info" | "warning" | "critical";
  category: string;
  reason: string;
  operation?: string | null;
  wallet?: string | null;
  sessionId?: string | null;
  challengeId?: string | null;
  details?: Record<string, unknown>;
  createdAt?: number;
}

export interface StepUpRequiredEventPayload {
  sessionId: string;
  wallet: string;
  operation: string;
  challengeId: string;
  reason: string;
  reasons: string[];
  expiresAt: number;
  requestedScope: string[];
  target?: string | null;
  counterparty?: string | null;
  valueWei?: string | null;
}

type LogFn = (entry: Record<string, unknown>) => void;

export function createEventBus(log: LogFn) {
  const clients = new Set<http.ServerResponse>();

  function addClient(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write(": connected\n\n");
    clients.add(res);
    req.on("close", () => {
      clients.delete(res);
    });
  }

  function emitEvent(type: DaemonEventType, data: Record<string, unknown>): void {
    const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) {
      client.write(payload);
    }
    log({ event: "sse_emit", type, listeners: clients.size });
  }

  function emitSecurityThreat(payload: SecurityThreatEventPayload): void {
    emitEvent("security_threat", payload as unknown as Record<string, unknown>);
  }

  function emitStepUpRequired(payload: StepUpRequiredEventPayload): void {
    emitEvent("auth.step_up_required", payload as unknown as Record<string, unknown>);
  }

  function emitStepUpCompleted(payload: Record<string, unknown>): void {
    emitEvent("auth.step_up_completed", payload);
  }

  return {
    addClient,
    emitEvent,
    emitSecurityThreat,
    emitStepUpRequired,
    emitStepUpCompleted,
  };
}
