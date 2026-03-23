/**
 * Dispute routes — POST /dispute, /dispute/resolved
 * Inbound dispute notifications.
 */
import type { PluginApi } from "../tools/hire.js";

export interface DisputeNotification {
  agreementId: string;
  raisedBy: string;
  reason: string;
  timestamp: number;
  evidence?: string;
}

const disputes = new Map<string, DisputeNotification & { resolved: boolean }>();

export function registerDisputeRoutes(api: PluginApi) {
  api.registerHttpRoute({
    method: "POST",
    path: "/dispute",
    handler: (req, res) => {
      const body = req.body as DisputeNotification;

      if (!body?.agreementId || !body?.raisedBy) {
        res.status(400).json({ error: "Invalid dispute: missing agreementId or raisedBy" });
        return;
      }

      disputes.set(body.agreementId, { ...body, resolved: false });

      res.json({
        status: "received",
        agreementId: body.agreementId,
        message: "Dispute notification received — escalating to arbitration",
        timestamp: new Date().toISOString(),
      });
    },
  });

  api.registerHttpRoute({
    method: "POST",
    path: "/dispute/resolved",
    handler: (req, res) => {
      const body = req.body as { agreementId: string; outcome: string; timestamp?: number };

      if (!body?.agreementId) {
        res.status(400).json({ error: "Missing agreementId" });
        return;
      }

      const dispute = disputes.get(body.agreementId);
      if (dispute) {
        dispute.resolved = true;
      }

      res.json({
        status: "acknowledged",
        agreementId: body.agreementId,
        outcome: body.outcome,
        timestamp: new Date().toISOString(),
      });
    },
  });

  api.registerHttpRoute({
    method: "GET",
    path: "/disputes",
    handler: (_req, res) => {
      const all = Array.from(disputes.entries()).map(([id, d]) => ({
        agreementId: id,
        raisedBy: d.raisedBy,
        reason: d.reason,
        resolved: d.resolved,
        timestamp: new Date(d.timestamp * 1000).toISOString(),
      }));
      res.json({ disputes: all, count: all.length });
    },
  });
}
