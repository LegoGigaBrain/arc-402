import { ethers } from "ethers";
import type {
  NegotiationMessage,
  NegotiationProposal,
  NegotiationCounter,
  NegotiationAccept,
  NegotiationReject,
} from "./types";

const MAX_MESSAGE_BYTES = 64 * 1024; // 64KB

// --- Digest computation ---
// digest = keccak256(abi.encodePacked(type, from, to, nonce, timestamp))
// nonce is message.nonce (PROPOSE) or message.refNonce (COUNTER/ACCEPT/REJECT) or bytes32(0) if absent
export function computeMessageDigest(message: NegotiationMessage | (Omit<NegotiationMessage, "sig"> & { sig?: string })): string {
  const m = message as any;
  const rawNonce: string = m.nonce || m.refNonce || ethers.ZeroHash;
  // solidityPackedKeccak256 requires exactly 32 bytes for bytes32 — pad to 32 bytes
  const nonce = ethers.zeroPadValue(rawNonce, 32);

  return ethers.solidityPackedKeccak256(
    ["string", "address", "address", "bytes32", "uint256"],
    [message.type, message.from, message.to, nonce, message.timestamp]
  );
}

// --- Signing ---

export async function signNegotiationMessage<T extends NegotiationMessage>(
  message: Omit<T, "sig">,
  signer: ethers.Wallet | ethers.Signer
): Promise<T> {
  const digest = computeMessageDigest(message as any);
  const sig = await signer.signMessage(ethers.getBytes(digest));
  return { ...message, sig } as T;
}

// --- Signed factory functions ---

export async function createSignedProposal(
  input: Omit<NegotiationProposal, "type" | "nonce" | "sig" | "timestamp" | "expiresAt"> & {
    nonce?: string;
    expiresAt?: number;
  },
  signer: ethers.Wallet | ethers.Signer
): Promise<NegotiationProposal> {
  const now = Math.floor(Date.now() / 1000);
  const unsigned: Omit<NegotiationProposal, "sig"> = {
    type: "PROPOSE",
    nonce: input.nonce ?? ethers.hexlify(ethers.randomBytes(16)),
    timestamp: now,
    expiresAt: input.expiresAt ?? now + 3600,
    ...input,
  };
  return signNegotiationMessage(unsigned, signer);
}

export async function createSignedCounter(
  input: Omit<NegotiationCounter, "type" | "sig" | "timestamp">,
  signer: ethers.Wallet | ethers.Signer
): Promise<NegotiationCounter> {
  const unsigned: Omit<NegotiationCounter, "sig"> = {
    type: "COUNTER",
    timestamp: Math.floor(Date.now() / 1000),
    ...input,
  };
  return signNegotiationMessage(unsigned, signer);
}

export async function createSignedAccept(
  input: Omit<NegotiationAccept, "type" | "sig" | "timestamp">,
  signer: ethers.Wallet | ethers.Signer
): Promise<NegotiationAccept> {
  const unsigned: Omit<NegotiationAccept, "sig"> = {
    type: "ACCEPT",
    timestamp: Math.floor(Date.now() / 1000),
    ...input,
  };
  return signNegotiationMessage(unsigned, signer);
}

export async function createSignedReject(
  input: Omit<NegotiationReject, "type" | "sig" | "timestamp">,
  signer: ethers.Wallet | ethers.Signer
): Promise<NegotiationReject> {
  const unsigned: Omit<NegotiationReject, "sig"> = {
    type: "REJECT",
    timestamp: Math.floor(Date.now() / 1000),
    ...input,
  };
  return signNegotiationMessage(unsigned, signer);
}

// --- Deprecated unsigned factories (backwards compat) ---

/** @deprecated Use createSignedProposal instead */
export function createNegotiationProposal(
  input: Omit<NegotiationProposal, "type" | "nonce" | "sig" | "timestamp" | "expiresAt"> & { nonce?: string }
): NegotiationProposal {
  console.warn("createNegotiationProposal: unsigned messages are deprecated. Use createSignedProposal instead.");
  const now = Math.floor(Date.now() / 1000);
  return {
    type: "PROPOSE",
    nonce: input.nonce ?? ethers.hexlify(ethers.randomBytes(16)),
    timestamp: now,
    expiresAt: now + 3600,
    sig: "0x",
    ...input,
  };
}

/** @deprecated Use createSignedCounter instead */
export function createNegotiationCounter(input: Omit<NegotiationCounter, "type" | "sig" | "timestamp">): NegotiationCounter {
  console.warn("createNegotiationCounter: unsigned messages are deprecated. Use createSignedCounter instead.");
  return { type: "COUNTER", timestamp: Math.floor(Date.now() / 1000), sig: "0x", ...input };
}

/** @deprecated Use createSignedAccept instead */
export function createNegotiationAccept(input: Omit<NegotiationAccept, "type" | "sig" | "timestamp">): NegotiationAccept {
  console.warn("createNegotiationAccept: unsigned messages are deprecated. Use createSignedAccept instead.");
  return { type: "ACCEPT", timestamp: Math.floor(Date.now() / 1000), sig: "0x", ...input };
}

/** @deprecated Use createSignedReject instead */
export function createNegotiationReject(input: Omit<NegotiationReject, "type" | "sig" | "timestamp">): NegotiationReject {
  console.warn("createNegotiationReject: unsigned messages are deprecated. Use createSignedReject instead.");
  return { type: "REJECT", timestamp: Math.floor(Date.now() / 1000), sig: "0x", ...input };
}

export function parseNegotiationMessage(json: string): NegotiationMessage {
  if (Buffer.byteLength(json, "utf8") > MAX_MESSAGE_BYTES) {
    throw new Error("NegotiationMessage exceeds 64KB size limit");
  }
  return JSON.parse(json) as NegotiationMessage;
}
