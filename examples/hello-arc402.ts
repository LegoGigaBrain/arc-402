/**
 * hello-arc402.ts — ARC-402 Reference Implementation
 *
 * Two agents. One agreement. Negotiation to settlement.
 * This is the complete happy path — discovery, negotiation, hire, deliver, verify.
 *
 * Run: npx ts-node examples/hello-arc402.ts
 */

import { ARC402Client } from "@arc402/sdk";
import { ethers } from "ethers";

// ─── Setup ────────────────────────────────────────────────────────────────────

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL ?? "https://mainnet.base.org");

// Client agent — the one hiring
const clientWallet = new ethers.Wallet(process.env.CLIENT_KEY!, provider);
const client = new ARC402Client({ signer: clientWallet, ...contractAddresses });

// Provider agent — the one doing the work
const providerWallet = new ethers.Wallet(process.env.PROVIDER_KEY!, provider);
const providerClient = new ARC402Client({ signer: providerWallet, ...contractAddresses });

// ─── Step 1: Discover ─────────────────────────────────────────────────────────

const agents = await client.discover({
  capability: "data.extraction.web.v1",
  minTrustScore: 500,
  maxPriceUsd: 10,
  limit: 1,
});

const providerAddress = agents[0].address;
console.log(`Found provider: ${providerAddress} (trust: ${agents[0].trustScore})`);

// ─── Step 2: Negotiate ────────────────────────────────────────────────────────

const session = await client.negotiate.propose({
  to: providerAddress,
  capability: "data.extraction.web.v1",
  specHash: ethers.keccak256(ethers.toUtf8Bytes("Extract top 10 HN stories")),
  price: ethers.parseEther("0.005"),
  token: ethers.ZeroAddress, // ETH
  deadline: Math.floor(Date.now() / 1000) + 3600, // 1 hour
});

// Provider accepts
await providerClient.negotiate.accept({ sessionId: session.sessionId });
console.log(`Agreement negotiated: session ${session.sessionId}`);

// ─── Step 3: Hire (on-chain) ──────────────────────────────────────────────────

const { agreementId } = await client.hire({
  sessionId: session.sessionId,
  value: ethers.parseEther("0.005"),
});

console.log(`Agreement on-chain: id ${agreementId}`);

// ─── Step 4: Deliver ──────────────────────────────────────────────────────────

const result = { stories: ["Story 1", "Story 2" /* ... */] };
const deliverableHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(result)));

await providerClient.deliver({ agreementId, deliverableHash });
console.log(`Delivered: ${deliverableHash}`);

// ─── Step 5: Verify + Settle ──────────────────────────────────────────────────

await client.verify({ agreementId, deliverableHash });
console.log(`Settled. Provider paid. Trust scores updated.`);

// ─── Contract addresses (replace with deployed addresses) ─────────────────────

const contractAddresses = {
  agentRegistryAddress: process.env.AGENT_REGISTRY!,
  serviceAgreementAddress: process.env.SERVICE_AGREEMENT!,
  trustRegistryAddress: process.env.TRUST_REGISTRY!,
  capabilityRegistryAddress: process.env.CAPABILITY_REGISTRY!,
};
