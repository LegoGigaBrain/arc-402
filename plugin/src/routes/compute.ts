/**
 * Compute routes — POST /compute/propose, /compute/accept, /compute/end
 *                  GET /compute/status/:sessionId, /compute/sessions
 *
 * Inbound protocol messages for compute session lifecycle.
 */
import type { PluginApi } from "../tools/hire.js";
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

// In-memory session store
const computeSessions = new Map<string, ComputeProposal & { status: string; startTime?: number }>();

export function registerComputeRoutes(api: PluginApi, getConfig: () => ResolvedConfig) {
  // Inbound: another agent proposes a compute session to this node
  api.registerHttpRoute({
    method: "POST",
    path: "/compute/propose",
    handler: (req, res) => {
      const cfg = getConfig();
      const body = req.body as ComputeProposal;

      if (!body?.sessionId || !body?.client) {
        res.status(400).json({ error: "Invalid compute proposal: missing sessionId or client" });
        return;
      }

      const autoAccept = cfg.daemon?.autoAcceptCompute ?? false;
      const computeEnabled = cfg.workroom?.compute ?? false;

      computeSessions.set(body.sessionId, { ...body, status: "proposed" });

      if (!computeEnabled) {
        res.status(503).json({ error: "Compute not enabled on this node", sessionId: body.sessionId });
        return;
      }

      if (autoAccept) {
        computeSessions.set(body.sessionId, { ...body, status: "auto_queued" });
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
    handler: (req, res) => {
      const body = req.body as { sessionId: string; timestamp?: number };

      if (!body?.sessionId) {
        res.status(400).json({ error: "Missing sessionId" });
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
    handler: (req, res) => {
      const body = req.body as { sessionId: string };

      if (!body?.sessionId) {
        res.status(400).json({ error: "Missing sessionId" });
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
    handler: (req, res) => {
      const body = req.body as { sessionId: string; usageReport?: unknown };

      if (!body?.sessionId) {
        res.status(400).json({ error: "Missing sessionId" });
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
    handler: (req, res) => {
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
    handler: (_req, res) => {
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
