/**
 * Hire listener — polls relay for incoming hire proposals,
 * evaluates against policy, and queues for approval or auto-accepts.
 */
import * as http from "http";
import * as https from "https";
import { ethers } from "ethers";
import type { DaemonConfig } from "./config";
import type { DaemonDB } from "./index";
import type { Notifier } from "./notify";

export interface HireProposal {
  messageId: string;
  hirerAddress: string;
  capability: string;
  priceEth: string;
  deadlineUnix: number;
  specHash: string;
  agreementId?: string;
  signature?: string;
  taskDescription?: string;
}

export interface PolicyResult {
  allowed: boolean;
  reason?: string;
}

function relayGet(
  relayUrl: string,
  urlPath: string
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlPath, relayUrl);
    const isHttps = parsed.protocol === "https:";
    const mod = isHttps ? https : http;
    const options: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + (parsed.search || ""),
      method: "GET",
      headers: { "Content-Type": "application/json" },
    };
    const req = mod.request(options, (res) => {
      let raw = "";
      res.on("data", (c: Buffer) => { raw += c.toString(); });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode ?? 0, data: raw });
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

export function evaluatePolicy(
  proposal: HireProposal,
  config: DaemonConfig,
  activeCount: number
): PolicyResult {
  const policy = config.policy;

  // Concurrency check
  if (activeCount >= config.relay.max_concurrent_agreements) {
    return { allowed: false, reason: "at_capacity" };
  }

  // Price check
  try {
    const priceWei = ethers.parseEther(proposal.priceEth || "0");
    const maxWei = ethers.parseEther(policy.max_price_eth);
    if (priceWei > maxWei) {
      return { allowed: false, reason: "price_exceeds_policy" };
    }
  } catch {
    return { allowed: false, reason: "invalid_price" };
  }

  // Capability check (empty list = accept all)
  if (policy.allowed_capabilities.length > 0 && proposal.capability) {
    if (!policy.allowed_capabilities.includes(proposal.capability)) {
      return { allowed: false, reason: "capability_not_allowed" };
    }
  }

  // Deadline check
  const now = Math.floor(Date.now() / 1000);
  if (proposal.deadlineUnix > 0) {
    if (proposal.deadlineUnix < now + policy.min_hire_lead_time_seconds) {
      return { allowed: false, reason: "deadline_too_soon" };
    }
  }

  return { allowed: true };
}

function parseProposal(msg: Record<string, unknown>): HireProposal | null {
  const payload = (msg.payload ?? msg) as Record<string, unknown>;
  if (!payload.hirerAddress && !payload.hirer_address && !payload.from) return null;

  const taskDesc = String(payload.task ?? payload.taskDescription ?? payload.task_description ?? "");
  return {
    messageId: String(msg.messageId ?? msg.id ?? `msg_${Date.now()}`),
    hirerAddress: String(payload.hirerAddress ?? payload.hirer_address ?? msg.from ?? ""),
    capability: String(payload.capability ?? payload.serviceType ?? ""),
    priceEth: String(payload.priceEth ?? payload.price_eth ?? "0"),
    deadlineUnix: Number(payload.deadlineUnix ?? payload.deadline ?? 0),
    specHash: String(payload.specHash ?? payload.spec_hash ?? ""),
    agreementId: payload.agreementId ? String(payload.agreementId) : undefined,
    signature: payload.signature ? String(payload.signature) : undefined,
    taskDescription: taskDesc || undefined,
  };
}

export class HireListener {
  private config: DaemonConfig;
  private db: DaemonDB;
  private notifier: Notifier;
  private walletAddress: string;
  private lastSeenMessageId: string | null = null;
  private onApprove: ((hireId: string) => Promise<void>) | null = null;

  constructor(
    config: DaemonConfig,
    db: DaemonDB,
    notifier: Notifier,
    walletAddress: string
  ) {
    this.config = config;
    this.db = db;
    this.notifier = notifier;
    this.walletAddress = walletAddress;
  }

  setApproveCallback(cb: (hireId: string) => Promise<void>): void {
    this.onApprove = cb;
  }

  async poll(): Promise<void> {
    const relayUrl = this.config.relay.relay_url;
    if (!relayUrl) return;

    try {
      const qs =
        `?address=${encodeURIComponent(this.walletAddress)}` +
        (this.lastSeenMessageId ? `&since=${encodeURIComponent(this.lastSeenMessageId)}` : "");

      const result = await relayGet(relayUrl, `/poll${qs}`);
      const data = result.data as { messages?: Array<Record<string, unknown>> };
      const messages = data.messages ?? [];

      for (const msg of messages) {
        this.lastSeenMessageId = String(msg.messageId ?? "");
        await this.handleMessage(msg);
      }
    } catch {
      // Transient relay failure — retry next poll
    }
  }

  private async handleMessage(msg: Record<string, unknown>): Promise<void> {
    const proposal = parseProposal(msg);
    if (!proposal) return;

    // Dedup — skip if already in DB
    const existing = this.db.getHireRequest(proposal.messageId);
    if (existing) return;

    // Count active agreements
    const activeCount = this.db.countActiveHireRequests();

    // Policy evaluation
    const policyResult = evaluatePolicy(proposal, this.config, activeCount);

    if (!policyResult.allowed) {
      // Reject
      const hireId = proposal.messageId;
      this.db.insertHireRequest({
        id: hireId,
        agreement_id: proposal.agreementId ?? null,
        hirer_address: proposal.hirerAddress,
        capability: proposal.capability,
        price_eth: proposal.priceEth,
        deadline_unix: proposal.deadlineUnix,
        spec_hash: proposal.specHash,
        task_description: proposal.taskDescription ?? null,
        status: "rejected",
        reject_reason: policyResult.reason ?? "policy_violation",
      });

      if (this.config.notifications.notify_on_hire_rejected) {
        await this.notifier.notifyHireRejected(hireId, policyResult.reason ?? "policy_violation");
      }
      return;
    }

    // Insert as pending_approval or auto-accept
    const hireId = proposal.messageId;
    const status = this.config.policy.auto_accept ? "accepted" : "pending_approval";

    this.db.insertHireRequest({
      id: hireId,
      agreement_id: proposal.agreementId ?? null,
      hirer_address: proposal.hirerAddress,
      capability: proposal.capability,
      price_eth: proposal.priceEth,
      deadline_unix: proposal.deadlineUnix,
      spec_hash: proposal.specHash,
      task_description: proposal.taskDescription ?? null,
      status,
      reject_reason: null,
    });

    if (status === "pending_approval") {
      if (this.config.notifications.notify_on_hire_request) {
        await this.notifier.notifyHireRequest(
          hireId,
          proposal.hirerAddress,
          proposal.priceEth,
          proposal.capability
        );
      }
    } else if (status === "accepted" && this.onApprove) {
      await this.onApprove(hireId);
    }
  }
}
