import { useEffect } from "react";

export type DaemonEventType =
  | "security_threat"
  | "auth.step_up_required"
  | "auth.step_up_completed"
  | "exec.simulated"
  | "exec.executed"
  | "job_started"
  | "job_completed"
  | "job_failed"
  | "handshake_received";

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

type DaemonEventPayload = Record<string, unknown>;
type DaemonEventHandler = (type: DaemonEventType, data: DaemonEventPayload) => void;

const HEALTH_URL = "http://127.0.0.1:4402/health";
const EVENTS_URL = "http://127.0.0.1:4402/events";

function parseSseChunk(chunk: string): Array<{ type: string; data: string }> {
  const records: Array<{ type: string; data: string }> = [];
  for (const rawEvent of chunk.split("\n\n")) {
    const lines = rawEvent.split("\n");
    let type = "message";
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event:")) {
        type = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trim());
      }
    }
    if (dataLines.length > 0) {
      records.push({ type, data: dataLines.join("\n") });
    }
  }
  return records;
}

export function useDaemonEvents(onEvent: DaemonEventHandler): void {
  useEffect(() => {
    let cancelled = false;
    let reconnectTimer: NodeJS.Timeout | null = null;
    let controller: AbortController | null = null;

    const scheduleReconnect = () => {
      if (cancelled || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, 5000);
    };

    const connect = async () => {
      if (cancelled) return;

      try {
        const healthResponse = await fetch(HEALTH_URL, {
          signal: AbortSignal.timeout(700),
        });
        if (!healthResponse.ok) {
          scheduleReconnect();
          return;
        }
      } catch {
        scheduleReconnect();
        return;
      }

      controller = new AbortController();

      try {
        const response = await fetch(EVENTS_URL, {
          headers: { Accept: "text/event-stream" },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          scheduleReconnect();
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let delimiterIndex = buffer.indexOf("\n\n");
          while (delimiterIndex >= 0) {
            const eventChunk = buffer.slice(0, delimiterIndex);
            buffer = buffer.slice(delimiterIndex + 2);
            for (const eventRecord of parseSseChunk(eventChunk)) {
              try {
                onEvent(eventRecord.type as DaemonEventType, JSON.parse(eventRecord.data) as DaemonEventPayload);
              } catch {
                // Ignore malformed payloads from older daemons.
              }
            }
            delimiterIndex = buffer.indexOf("\n\n");
          }
        }
      } catch {
        if (!cancelled) {
          scheduleReconnect();
        }
      }
    };

    void connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      controller?.abort();
    };
  }, [onEvent]);
}
