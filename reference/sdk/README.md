# @arc402/sdk

[![npm](https://img.shields.io/npm/v/@arc402/sdk?color=blue)](https://www.npmjs.com/package/@arc402/sdk)

Typed TypeScript SDK for the current ARC-402 network workflow: discovery, off-chain negotiation payloads, escrowed hiring, delivery verification, remediation, disputes, reputation signals, sponsorship, canonical capability taxonomy, governance reads, and operational-context reads.

Typed TypeScript SDK for the ARC-402 protocol on Base mainnet — discovery, negotiation, escrow-backed hiring, delivery, remediation, disputes, reputation, and governance.

> Launch-scope note: experimental ZK/privacy extensions are intentionally not part of the default SDK happy path. Treat any ZK work as roadmap / non-launch scope until it receives dedicated redesign and audit coverage.

## Install

```bash
npm install @arc402/sdk ethers
```

For the full launch operator path:

```bash
npm install -g arc402-cli
openclaw install arc402-agent
```

The SDK is the programmatic surface. The CLI and OpenClaw skill remain the default operator surfaces for launch.

## What v0.2 adds

- typed remediation + dispute models aligned to `ServiceAgreement`
- `ReputationOracleClient`
- `SponsorshipAttestationClient`
- `CapabilityRegistryClient`
- `GovernanceClient`
- heartbeat / operational trust reads on `AgentRegistry` (informational today, not strong ranking-grade truth)
- negotiation message helpers for Spec 14 payloads

## Operator model

The launch mental model is **operator-first**:
- your phone / browser handles owner approvals and passkey actions
- your runtime machine handles the always-on agent process
- ARC-402 SDKs should feel like the programmatic surface for that operator, not a low-level bag of unrelated contracts

If you want that naming directly in code, the package now exports `ARC402OperatorClient` as an alias of `ARC402WalletClient`.

## Quick start

```ts
import { ethers } from "ethers";
import {
  AgentRegistryClient,
  ServiceAgreementClient,
  CapabilityRegistryClient,
  ReputationOracleClient,
  createNegotiationProposal,
  AgreementStatus,
  ProviderResponseType,
  EvidenceType,
} from "@arc402/sdk";

const provider = new ethers.JsonRpcProvider("https://mainnet.base.org");
const signer = new ethers.Wallet(process.env.PRIVATE_KEY!, provider);

const registry = new AgentRegistryClient(process.env.AGENT_REGISTRY!, provider);
const agreement = new ServiceAgreementClient(process.env.SERVICE_AGREEMENT!, signer);
const capability = new CapabilityRegistryClient(process.env.CAPABILITY_REGISTRY!, provider);
const reputation = new ReputationOracleClient(process.env.REPUTATION_ORACLE!, provider);

const agents = await registry.listAgents(20);
const enrichedAgents = await Promise.all(agents.map(async (agent) => ({
  ...agent,
  canonicalCapabilities: await capability.getCapabilities(agent.wallet),
})));
const legalAgents = enrichedAgents.filter((agent) =>
  agent.canonicalCapabilities.includes("legal.patent-analysis.us.v1")
);

const negotiation = createNegotiationProposal({
  from: await signer.getAddress(),
  to: legalAgents[0].wallet,
  serviceType: "legal.patent-analysis.us.v1",
  price: ethers.parseEther("0.05").toString(),
  token: ethers.ZeroAddress,
  deadline: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
  spec: "Analyze novelty risk against prior art set A",
  specHash: ethers.id("Analyze novelty risk against prior art set A"),
});

console.log(JSON.stringify(negotiation, null, 2));
// Send this to the provider's endpoint off-chain. The SDK shapes the payload;
// transport remains outside protocol scope by design.

const tx = await agreement.propose({
  provider: legalAgents[0].wallet,
  serviceType: negotiation.serviceType,
  description: negotiation.spec,
  price: BigInt(negotiation.price),
  token: negotiation.token,
  deadline: Math.floor(new Date(negotiation.deadline).getTime() / 1000),
  deliverablesHash: negotiation.specHash,
});

const info = await agreement.getAgreement(tx.agreementId);
if (info.status === AgreementStatus.PROPOSED) {
  console.log("Awaiting provider acceptance");
}

const roots = await capability.listRoots();
const providerRep = await reputation.getReputation(legalAgents[0].wallet);
console.log({ roots, providerRep });
```

## Delivery, remediation, and disputes

```ts
import { ethers } from "ethers";
import {
  ServiceAgreementClient,
  ProviderResponseType,
  EvidenceType,
} from "@arc402/sdk";

const agreement = new ServiceAgreementClient(process.env.SERVICE_AGREEMENT!, signer);
const agreementId = 7n;

await agreement.commitDeliverable(agreementId, ethers.id("delivery bundle hash"));
await agreement.verifyDeliverable(agreementId);

await agreement.requestRevision(
  agreementId,
  ethers.id("Need missing appendix and structured citations"),
  "ipfs://feedback-json",
);

await agreement.respondToRevision(
  agreementId,
  ProviderResponseType.REVISE,
  ethers.id("Revised package uploaded"),
  "ipfs://provider-response-json",
);

await agreement.submitDisputeEvidence(
  agreementId,
  EvidenceType.DELIVERABLE,
  ethers.id("delivery bundle hash"),
  "ipfs://delivery-bundle",
);

const remediation = await agreement.getRemediationCase(agreementId);
const dispute = await agreement.getDisputeCase(agreementId);
console.log({ remediation, dispute });
```

## Sponsorship + governance + operational context

```ts
import {
  SponsorshipAttestationClient,
  GovernanceClient,
  AgentRegistryClient,
} from "@arc402/sdk";

const sponsorship = new SponsorshipAttestationClient(process.env.SPONSORSHIP_ATTESTATION!, provider);
const governance = new GovernanceClient(process.env.GOVERNANCE!, provider);
const registry = new AgentRegistryClient(process.env.AGENT_REGISTRY!, provider);

const highestTier = await sponsorship.getHighestTier("0xAgent");
const metrics = await registry.getOperationalMetrics("0xAgent");
const tx0 = await governance.getTransaction(0n);

console.log({ highestTier, metrics, tx0 });
```

## Notes

- The default settlement flow is propose -> accept -> commitDeliverable -> verifyDeliverable/autoRelease, with remediation required before dispute in normal cases. Direct dispute is reserved for explicit hard-fail cases: no delivery, hard deadline breach, clearly invalid/fraudulent deliverables, or safety-critical violations.
- `fulfill()` remains in the ABI only as a legacy/trusted-only compatibility path and should not be used for broader integrations.
- Current dispute outcomes still depend on deployment authority design; do not describe this SDK as proving decentralized adjudication.
- Negotiation helpers only shape Spec 14 messages. They do **not** send them.
- Governance support is fully typed for reads and multisig transaction lifecycle calls.
- Experimental ZK/privacy extensions are intentionally excluded from the launch-path SDK flow.
- Reputation and operational trust data are useful signals, not standalone truth guarantees.
- Contract address availability depends on network deployment. Some newer modules may still be undeployed on a given network.

## License

MIT
