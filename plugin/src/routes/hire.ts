/**
 * Hire routes — POST /hire, /hire/accepted, /delivery, /delivery/accepted
 * These receive inbound protocol messages from other agents' daemons/plugins.
 *
 * PLG-4: All POST routes verify the sender signed the payload (EIP-191).
 * PLG-5: In-memory stores have 24h TTL eviction.
 */
import { ethers } from "ethers";
import type { PluginApi, HttpRequest, HttpResponse } from "../tools/hire.js";
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

// In-memory stores with timestamps for TTL eviction
const pendingHires = new Map<string, HireProposal & { addedAt: number }>();
const deliveries = new Map<string, DeliveryNotification & { addedAt: number }>();

const TTL_MS = 24 * 60 * 60 * 1000; // 24h

function pruneExpired(): void {
  const now = Date.now();
  for (const [k, v] of pendingHires.entries()) {
    if (now - v.addedAt > TTL_MS) pendingHires.delete(k);
  }
  for (const [k, v] of deliveries.entries()) {
    if (now - v.addedAt > TTL_MS) deliveries.delete(k);
  }
}

/**
 * Verify the request body was signed by the claimed sender.
 * Expects X-ARC402-Signature (EIP-191 sig of JSON.stringify(body)) and
 * X-ARC402-Signer (the sender's address).
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

export function registerHireRoutes(api: PluginApi, getConfig: () => ResolvedConfig) {
  // Inbound: another agent wants to hire this agent
  api.registerHttpRoute({
    method: "POST",
    path: "/hire",
    handler: async (req: HttpRequest, res: HttpResponse) => {
      pruneExpired();
      const cfg = getConfig();
      const body = req.body as HireProposal;

      if (!body?.agreementId || !body?.client) {
        res.status(400).json({ error: "Invalid hire proposal: missing agreementId or client" });
        return;
      }

      const check = verifySenderSig(req, body, body.client);
      if (!check.valid) {
        res.status(401).json({ error: "Unauthorized", reason: check.reason });
        return;
      }

      pendingHires.set(body.agreementId, { ...body, addedAt: Date.now() });

      const autoAccept = cfg.daemon?.autoAcceptHire ?? false;
      if (autoAccept) {
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
    handler: async (req: HttpRequest, res: HttpResponse) => {
      pruneExpired();
      const body = req.body as { agreementId: string; provider: string; timestamp?: number };

      if (!body?.agreementId || !body?.provider) {
        res.status(400).json({ error: "Missing agreementId or provider" });
        return;
      }

      const check = verifySenderSig(req, body, body.provider);
      if (!check.valid) {
        res.status(401).json({ error: "Unauthorized", reason: check.reason });
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
    handler: async (req: HttpRequest, res: HttpResponse) => {
      pruneExpired();
      const body = req.body as DeliveryNotification & { provider?: string };

      if (!body?.agreementId || !body?.deliverableHash) {
        res.status(400).json({ error: "Invalid delivery: missing agreementId or deliverableHash" });
        return;
      }

      // Require signer header even without provider field — verify self-consistency
      const sig = req.headers["x-arc402-signature"];
      const signer = req.headers["x-arc402-signer"];
      if (!sig || !signer) {
        res.status(401).json({ error: "Unauthorized", reason: "missing X-ARC402-Signature and X-ARC402-Signer headers" });
        return;
      }
      let recovered: string;
      try {
        recovered = ethers.verifyMessage(JSON.stringify(body), sig);
      } catch {
        res.status(401).json({ error: "Unauthorized", reason: "invalid_signature" });
        return;
      }
      if (recovered.toLowerCase() !== signer.toLowerCase()) {
        res.status(401).json({ error: "Unauthorized", reason: "signature_signer_mismatch" });
        return;
      }

      deliveries.set(body.agreementId, { ...body, addedAt: Date.now() });

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
    handler: async (req: HttpRequest, res: HttpResponse) => {
      pruneExpired();
      const body = req.body as { agreementId: string; client: string; timestamp?: number };

      if (!body?.agreementId || !body?.client) {
        res.status(400).json({ error: "Missing agreementId or client" });
        return;
      }

      const check = verifySenderSig(req, body, body.client);
      if (!check.valid) {
        res.status(401).json({ error: "Unauthorized", reason: check.reason });
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
    handler: (_req: HttpRequest, res: HttpResponse) => {
      pruneExpired();
      const pending = Array.from(pendingHires.values()).map(({ addedAt: _a, ...p }) => p);
      res.json({ pending, count: pending.length });
    },
  });
}
