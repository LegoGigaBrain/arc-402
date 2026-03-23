/**
 * Compute routes — POST /compute/propose, /compute/accept, /compute/end
 *                  GET /compute/status/:sessionId, /compute/sessions
 *
 * Inbound protocol messages for compute session lifecycle.
 *
 * PLG-4: All POST routes verify the sender signed the payload (EIP-191).
 * PLG-5: In-memory session store has 24h TTL eviction.
 */
import { ethers } from "ethers";
import type { PluginApi, HttpRequest, HttpResponse } from "../tools/hire.js";
import type { ResolvedConfig } from "../config.js";

export interface ComputeProposal {
  sessionId: string;
  client: string;
  gpuSpec: string;
  ratePerHourWei: string;
  maxHours: number;
  token: string;
  proposedAt: number;
}

// In-memory session store with timestamps for TTL eviction
const computeSessions = new Map<
  string,
  ComputeProposal & { status: string; startTime?: number; addedAt: number }
>();

const TTL_MS = 24 * 60 * 60 * 1000; // 24h

function pruneExpired(): void {
  const now = Date.now();
  for (const [k, v] of computeSessions.entries()) {
    if (v.status !== "active" && now - v.addedAt > TTL_MS) computeSessions.delete(k);
  }
}

/**
 * Verify the request body was signed by the claimed sender.
 */
function verifySenderSig(
  req: HttpRequest,
  body: unknown,
  expectedSender: string,
): { valid: boolean; reason?: string } {
  const sig = req.headers["x-arc402-signature"];
  const signer = req.headers["x-arc402-signer"];
  if (!sig || !signer) {
    return { valid: false, reason: "missing X-ARC402-Signature and X-ARC402-Signer headers" };
  }

  let recovered: string;
  try {
    recovered = ethers.verifyMessage(JSON.stringify(body), sig);
  } catch {
    return { valid: false, reason: "invalid_signature" };
  }

  if (recovered.toLowerCase() !== signer.toLowerCase()) {
    return { valid: false, reason: "signature_signer_mismatch" };
  }

  if (recovered.toLowerCase() !== expectedSender.toLowerCase()) {
    return { valid: false, reason: `signer ${recovered} does not match claimed sender ${expectedSender}` };
  }

  return { valid: true };
}

export function registerComputeRoutes(api: PluginApi, getConfig: () => ResolvedConfig) {
  // Inbound: another agent proposes a compute session to this node
  api.registerHttpRoute({
    method: "POST",
    path: "/compute/propose",
    handler: (req: HttpRequest, res: HttpResponse) => {
      pruneExpired();
      const cfg = getConfig();
      const body = req.body as ComputeProposal;

      if (!body?.sessionId || !body?.client) {
        res.status(400).json({ error: "Invalid compute proposal: missing sessionId or client" });
        return;
      }

      const check = verifySenderSig(req, body, body.client);
      if (!check.valid) {
        res.status(401).json({ error: "Unauthorized", reason: check.reason });
        return;
      }

      const autoAccept = cfg.daemon?.autoAcceptCompute ?? false;
      const computeEnabled = cfg.workroom?.compute ?? false;

      computeSessions.set(body.sessionId, { ...body, status: "proposed", addedAt: Date.now() });

      if (!computeEnabled) {
        res.status(503).json({ error: "Compute not enabled on this node", sessionId: body.sessionId });
        return;
      }

      if (autoAccept) {
        computeSessions.set(body.sessionId, { ...body, status: "auto_queued", addedAt: Date.now() });
        res.json({ status: "auto_queued", sessionId: body.sessionId });
      } else {
        res.json({ status: "pending_review", sessionId: body.sessionId, message: "Awaiting operator approval" });
      }
    },
  });

  // Inbound: client accepted our compute proposal response
  api.registerHttpRoute({
    method: "POST",
    path: "/compute/accept",
    handler: (req: HttpRequest, res: HttpResponse) => {
      pruneExpired();
      const body = req.body as { sessionId: string; client: string; timestamp?: number };

      if (!body?.sessionId || !body?.client) {
        res.status(400).json({ error: "Missing sessionId or client" });
        return;
      }

      const check = verifySenderSig(req, body, body.client);
      if (!check.valid) {
        res.status(401).json({ error: "Unauthorized", reason: check.reason });
        return;
      }

      const session = computeSessions.get(body.sessionId);
      if (session) {
        session.status = "accepted";
      }

      res.json({ status: "acknowledged", sessionId: body.sessionId, timestamp: new Date().toISOString() });
    },
  });

  // Inbound: session start signal
  api.registerHttpRoute({
    method: "POST",
    path: "/compute/start",
    handler: (req: HttpRequest, res: HttpResponse) => {
      pruneExpired();
      const body = req.body as { sessionId: string; client: string };

      if (!body?.sessionId || !body?.client) {
        res.status(400).json({ error: "Missing sessionId or client" });
        return;
      }

      const check = verifySenderSig(req, body, body.client);
      if (!check.valid) {
        res.status(401).json({ error: "Unauthorized", reason: check.reason });
        return;
      }

      const session = computeSessions.get(body.sessionId);
      if (session) {
        session.status = "active";
        session.startTime = Math.floor(Date.now() / 1000);
      }

      res.json({ status: "started", sessionId: body.sessionId, startTime: new Date().toISOString() });
    },
  });

  // Inbound: session end signal
  api.registerHttpRoute({
    method: "POST",
    path: "/compute/end",
    handler: (req: HttpRequest, res: HttpResponse) => {
      pruneExpired();
      const body = req.body as { sessionId: string; client: string; usageReport?: unknown };

      if (!body?.sessionId || !body?.client) {
        res.status(400).json({ error: "Missing sessionId or client" });
        return;
      }

      const check = verifySenderSig(req, body, body.client);
      if (!check.valid) {
        res.status(401).json({ error: "Unauthorized", reason: check.reason });
        return;
      }

      const session = computeSessions.get(body.sessionId);
      if (session) {
        session.status = "ended";
      }

      res.json({ status: "acknowledged", sessionId: body.sessionId, timestamp: new Date().toISOString() });
    },
  });

  // GET session status
  api.registerHttpRoute({
    method: "GET",
    path: "/compute/status/:sessionId",
    handler: (req: HttpRequest, res: HttpResponse) => {
      const sessionId = req.params["sessionId"] ?? "";
      const session = computeSessions.get(sessionId);

      if (!session) {
        res.status(404).json({ error: "Session not found", sessionId });
        return;
      }

      res.json({
        sessionId,
        client: session.client,
        gpuSpec: session.gpuSpec,
        ratePerHourWei: session.ratePerHourWei,
        maxHours: session.maxHours,
        status: session.status,
        startTime: session.startTime ? new Date(session.startTime * 1000).toISOString() : null,
      });
    },
  });

  // GET all sessions
  api.registerHttpRoute({
    method: "GET",
    path: "/compute/sessions",
    handler: (_req: HttpRequest, res: HttpResponse) => {
      const sessions = Array.from(computeSessions.entries()).map(([id, s]) => ({
        sessionId: id,
        client: s.client,
        gpuSpec: s.gpuSpec,
        status: s.status,
        startTime: s.startTime ? new Date(s.startTime * 1000).toISOString() : null,
      }));
      res.json({ sessions, count: sessions.length });
    },
  });
}
