/**
 * Hire routes — POST /hire, /hire/accepted, /delivery, /delivery/accepted
 * These receive inbound protocol messages from other agents' daemons/plugins.
 */
import type { PluginApi } from "../tools/hire.js";
import type { ResolvedConfig } from "../config.js";

export interface HireProposal {
  agreementId: string;
  client: string;
  serviceType: string;
  capability?: string;
  specHash: string;
  price: string;
  token: string;
  deadline: number;
  metadata?: Record<string, unknown>;
}

export interface DeliveryNotification {
  agreementId: string;
  deliverableHash: string;
  manifestUrl?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

// Shared job store (in-memory — persisted by host process)
const pendingHires = new Map<string, HireProposal>();
const deliveries = new Map<string, DeliveryNotification>();

export function registerHireRoutes(api: PluginApi, getConfig: () => ResolvedConfig) {
  // Inbound: another agent wants to hire this agent
  api.registerHttpRoute({
    method: "POST",
    path: "/hire",
    handler: async (req, res) => {
      const cfg = getConfig();
      const body = req.body as HireProposal;

      if (!body?.agreementId || !body?.client) {
        res.status(400).json({ error: "Invalid hire proposal: missing agreementId or client" });
        return;
      }

      pendingHires.set(body.agreementId, body);

      const autoAccept = cfg.daemon?.autoAcceptHire ?? false;
      if (autoAccept) {
        // Signal acceptance — actual on-chain accept happens via arc402_accept tool
        res.json({ status: "auto_queued", agreementId: body.agreementId, message: "Queued for auto-acceptance" });
      } else {
        res.json({ status: "pending_review", agreementId: body.agreementId, message: "Awaiting operator approval" });
      }
    },
  });

  // Inbound: another agent accepted our hire proposal
  api.registerHttpRoute({
    method: "POST",
    path: "/hire/accepted",
    handler: async (req, res) => {
      const body = req.body as { agreementId: string; provider: string; timestamp?: number };

      if (!body?.agreementId) {
        res.status(400).json({ error: "Missing agreementId" });
        return;
      }

      res.json({
        status: "acknowledged",
        agreementId: body.agreementId,
        message: "Hire acceptance received",
        timestamp: new Date().toISOString(),
      });
    },
  });

  // Inbound: delivery notification from provider
  api.registerHttpRoute({
    method: "POST",
    path: "/delivery",
    handler: async (req, res) => {
      const body = req.body as DeliveryNotification;

      if (!body?.agreementId || !body?.deliverableHash) {
        res.status(400).json({ error: "Invalid delivery: missing agreementId or deliverableHash" });
        return;
      }

      deliveries.set(body.agreementId, body);

      res.json({
        status: "received",
        agreementId: body.agreementId,
        deliverableHash: body.deliverableHash,
        message: "Delivery notification received — awaiting verification",
        timestamp: new Date().toISOString(),
      });
    },
  });

  // Inbound: client accepted the delivery
  api.registerHttpRoute({
    method: "POST",
    path: "/delivery/accepted",
    handler: async (req, res) => {
      const body = req.body as { agreementId: string; client: string; timestamp?: number };

      if (!body?.agreementId) {
        res.status(400).json({ error: "Missing agreementId" });
        return;
      }

      deliveries.delete(body.agreementId);

      res.json({
        status: "acknowledged",
        agreementId: body.agreementId,
        message: "Delivery acceptance received — payment released",
        timestamp: new Date().toISOString(),
      });
    },
  });

  // GET pending hire proposals
  api.registerHttpRoute({
    method: "GET",
    path: "/hire/pending",
    handler: (_req, res) => {
      const pending = Array.from(pendingHires.values());
      res.json({ pending, count: pending.length });
    },
  });
}
