/**
 * Dispute routes — POST /dispute, /dispute/resolved
 * Inbound dispute notifications.
 *
 * PLG-4: All POST routes verify the sender signed the payload (EIP-191).
 * PLG-5: In-memory store has 24h TTL eviction.
 */
import { ethers } from "ethers";
import type { PluginApi, HttpRequest, HttpResponse } from "../tools/hire.js";

export interface DisputeNotification {
  agreementId: string;
  raisedBy: string;
  reason: string;
  timestamp: number;
  evidence?: string;
}

const disputes = new Map<string, DisputeNotification & { resolved: boolean; addedAt: number }>();

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — disputes live longer

function pruneExpired(): void {
  const now = Date.now();
  for (const [k, v] of disputes.entries()) {
    if (v.resolved && now - v.addedAt > TTL_MS) disputes.delete(k);
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

export function registerDisputeRoutes(api: PluginApi) {
  api.registerHttpRoute({
    method: "POST",
    path: "/dispute",
    handler: (req: HttpRequest, res: HttpResponse) => {
      pruneExpired();
      const body = req.body as DisputeNotification;

      if (!body?.agreementId || !body?.raisedBy) {
        res.status(400).json({ error: "Invalid dispute: missing agreementId or raisedBy" });
        return;
      }

      const check = verifySenderSig(req, body, body.raisedBy);
      if (!check.valid) {
        res.status(401).json({ error: "Unauthorized", reason: check.reason });
        return;
      }

      disputes.set(body.agreementId, { ...body, resolved: false, addedAt: Date.now() });

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
    handler: (req: HttpRequest, res: HttpResponse) => {
      pruneExpired();
      const body = req.body as { agreementId: string; outcome: string; resolvedBy: string; timestamp?: number };

      if (!body?.agreementId || !body?.resolvedBy) {
        res.status(400).json({ error: "Missing agreementId or resolvedBy" });
        return;
      }

      const check = verifySenderSig(req, body, body.resolvedBy);
      if (!check.valid) {
        res.status(401).json({ error: "Unauthorized", reason: check.reason });
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
    handler: (_req: HttpRequest, res: HttpResponse) => {
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
