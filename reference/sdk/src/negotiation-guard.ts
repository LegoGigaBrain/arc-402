import { ethers } from "ethers";
import type { ContractRunner } from "ethers";
import type { NegotiationMessage, NegotiationVerificationResult } from "./types";
import { computeMessageDigest } from "./negotiation";

const AGENT_REGISTRY_ABI = [
  "function isRegistered(address wallet) view returns (bool)",
];

export interface NegotiationGuardOptions {
  agentRegistryAddress: string;
  runner: ContractRunner;
  timestampToleranceSeconds?: number; // default 60
  nonceCacheTtlMs?: number;           // default 24h
  maxMessageBytes?: number;           // default 64KB
}

export class NegotiationGuard {
  private registry: ethers.Contract;
  private nonceCache = new Map<string, number>(); // nonceKey -> expiry timestamp (ms)
  private opts: Required<NegotiationGuardOptions>;

  constructor(options: NegotiationGuardOptions) {
    this.opts = {
      timestampToleranceSeconds: 60,
      nonceCacheTtlMs: 24 * 60 * 60 * 1000,
      maxMessageBytes: 64 * 1024,
      ...options,
    };
    this.registry = new ethers.Contract(
      options.agentRegistryAddress,
      AGENT_REGISTRY_ABI,
      options.runner
    );
  }

  async verify(rawJson: string): Promise<NegotiationVerificationResult> {
    // 1. Size check
    if (Buffer.byteLength(rawJson, "utf8") > this.opts.maxMessageBytes) {
      return { valid: false, error: "MESSAGE_TOO_LARGE" };
    }

    // 2. Parse
    let message: NegotiationMessage;
    try {
      message = JSON.parse(rawJson);
    } catch {
      return { valid: false, error: "SCHEMA_INVALID" };
    }

    // 3. Required fields
    if (!message.sig || message.timestamp == null || !message.from) {
      return { valid: false, error: "SCHEMA_INVALID" };
    }

    // 4. Timestamp check
    const now = Math.floor(Date.now() / 1000);
    const delta = now - message.timestamp;
    if (Math.abs(delta) > this.opts.timestampToleranceSeconds) {
      return { valid: false, error: delta < 0 ? "TIMESTAMP_IN_FUTURE" : "TIMESTAMP_TOO_OLD" };
    }

    // 5. Expiry check (PROPOSE only)
    if (message.type === "PROPOSE" && message.expiresAt != null && now > message.expiresAt) {
      return { valid: false, error: "MESSAGE_EXPIRED" };
    }

    // 6. Signature recovery
    let recoveredSigner: string;
    try {
      const digest = computeMessageDigest(message);
      recoveredSigner = ethers.recoverAddress(
        ethers.hashMessage(ethers.getBytes(digest)),
        message.sig
      );
    } catch {
      return { valid: false, error: "INVALID_SIGNATURE" };
    }

    // 7. Signer must match from
    if (recoveredSigner.toLowerCase() !== message.from.toLowerCase()) {
      return { valid: false, error: "INVALID_SIGNATURE" };
    }

    // 8. Registry check (fail open on registry downtime)
    try {
      const registered = await this.registry.isRegistered(recoveredSigner);
      if (!registered) {
        return { valid: false, error: "SIGNER_NOT_REGISTERED" };
      }
    } catch {
      console.warn(
        "NegotiationGuard: AgentRegistry check failed — proceeding with signature-only verification"
      );
    }

    // 9. Nonce replay check
    const nonceVal =
      "nonce" in message && message.nonce
        ? message.nonce
        : "refNonce" in message && message.refNonce
        ? message.refNonce
        : "";
    const nonceKey = `${message.from.toLowerCase()}:${nonceVal}:${message.timestamp}`;
    this.pruneNonceCache();
    if (this.nonceCache.has(nonceKey)) {
      return { valid: false, error: "NONCE_REPLAYED" };
    }
    this.nonceCache.set(nonceKey, Date.now() + this.opts.nonceCacheTtlMs);

    return { valid: true, recoveredSigner: recoveredSigner as any };
  }

  private pruneNonceCache(): void {
    const now = Date.now();
    for (const [key, expiry] of this.nonceCache) {
      if (now > expiry) this.nonceCache.delete(key);
    }
  }

  /** Reset nonce cache (testing / restart) */
  clearNonceCache(): void {
    this.nonceCache.clear();
  }
}
