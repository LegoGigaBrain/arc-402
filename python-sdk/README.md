# arc402

ARC-402 is a transport-agnostic coordination layer for autonomous agents: governed wallets, escrow-backed service agreements, canonical capability taxonomy for discovery, negotiated remediation, and trust/trust-adjacent signals with explicit maturity boundaries.

This SDK documents the current contract surface for controlled deployments and closed pilots. It should not be read as a claim that public-market dispute legitimacy or manipulation-resistant reputation is already complete.

This Python SDK now covers both the original wallet flows and the current v0.2 protocol direction:
- governed wallet spending
- trust registry v1/v2 reads
- service agreements with remediation + dispute evidence flows
- reputation oracle reads/interactions
- sponsorship + identity tier attestations (informational unless externally strengthened by a deployment)
- capability taxonomy reads for canonical discovery
- governance multisig reads
- heartbeat / operational trust reads through the agent registry (informational today, not strong ranking-grade truth)

> Launch-scope note: this SDK documents the current public/closed-pilot contract surface. Experimental ZK/privacy work is intentionally out of the default integration path and should be treated as roadmap-only until re-audited.

## Installation

```bash
pip install arc402
```

## Quick start: governed wallet

```python
import asyncio
import os
from arc402 import ARC402Wallet

async def main():
    wallet = ARC402Wallet(
        address=os.environ["AGENT_WALLET"],
        private_key=os.environ["AGENT_KEY"],
        network="base-sepolia",
    )

    await wallet.set_policy({
        "claims_processing": "0.1 ether",
        "research": "0.05 ether",
        "protocol_fee": "0.01 ether",
    })

    async with wallet.context("claims_processing", task_id="claim-4821"):
        await wallet.spend(
            recipient="0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
            amount="0.05 ether",
            category="claims_processing",
            reason="Medical records for claim #4821",
        )

    score = await wallet.trust_score()
    print(score)

asyncio.run(main())
```

## Service agreements: remediation-first before dispute

```python
from arc402 import (
    DisputeOutcome,
    EvidenceType,
    ProviderResponseType,
    ServiceAgreementClient,
)
from web3 import Web3

agreement = ServiceAgreementClient(
    address=os.environ["ARC402_SERVICE_AGREEMENT"],
    w3=Web3(Web3.HTTPProvider(os.environ["RPC_URL"])),
    account=my_local_account,
)

agreement_id, tx_hash = await agreement.propose(
    provider="0xProvider...",
    service_type="insurance.claims.coverage.lloyds.v1",
    description="Review claim package and produce coverage opinion",
    price=Web3.to_wei("0.05", "ether"),
    token="0x0000000000000000000000000000000000000000",
    deadline=1_800_000_000,
    deliverables_hash="0x" + "11" * 32,
)

await agreement.request_revision(
    agreement_id,
    feedback_hash="0x" + "22" * 32,
    feedback_uri="ipfs://feedback-json",
)

await agreement.respond_to_revision(
    agreement_id,
    response_type=ProviderResponseType.REVISE,
    proposed_provider_payout=0,
    response_hash="0x" + "33" * 32,
    response_uri="ipfs://provider-response",
    previous_transcript_hash=agreement.get_remediation_case(agreement_id).latest_transcript_hash,
)

await agreement.submit_dispute_evidence(
    agreement_id,
    evidence_type=EvidenceType.DELIVERABLE,
    evidence_hash="0x" + "44" * 32,
    evidence_uri="ipfs://deliverable-bundle",
)

# current contract authority path (owner-administered / designated arbiter depending on deployment)
await agreement.resolve_dispute_detailed(
    agreement_id,
    outcome=DisputeOutcome.PARTIAL_PROVIDER,
    provider_award=30_000_000_000_000_000,
    client_award=20_000_000_000_000_000,
)
```

## Reputation + sponsorship + identity tier (secondary signals)

```python
from arc402 import IdentityTier, ReputationOracleClient, SignalType, SponsorshipAttestationClient

reputation = ReputationOracleClient(os.environ["ARC402_REPUTATION_ORACLE"], w3, account=my_local_account)
sponsorship = SponsorshipAttestationClient(os.environ["ARC402_SPONSORSHIP"], w3, account=my_local_account)

await reputation.publish_signal(
    subject="0xAgent...",
    signal_type=SignalType.ENDORSE,
    capability_hash="0x" + "55" * 32,
    reason="Delivered five high-quality claim reviews",
)

attestation_id = await sponsorship.publish_with_tier(
    agent="0xAgent...",
    expires_at=0,
    tier=IdentityTier.VERIFIED_PROVIDER,
    evidence_uri="ipfs://verification-proof",
)

print(reputation.get_reputation("0xAgent..."))
print(sponsorship.get_attestation(attestation_id))
print(sponsorship.get_highest_tier("0xAgent..."))
```

## Capability taxonomy + governance + operational context

```python
from arc402 import ARC402GovernanceClient, AgentRegistryClient, CapabilityRegistryClient, Trust

agents = AgentRegistryClient(os.environ["ARC402_AGENT_REGISTRY"], w3)
capabilities = CapabilityRegistryClient(os.environ["ARC402_CAPABILITY_REGISTRY"], w3)
governance = ARC402GovernanceClient(os.environ["ARC402_GOVERNANCE"], w3)
trust = Trust(w3, os.environ["ARC402_TRUST_REGISTRY"])

print(capabilities.list_roots())
print(capabilities.get_capabilities("0xAgent..."))
print(agents.get_operational_trust("0xAgent..."))
print(await trust.get_effective_score("0xAgent..."))
print(await trust.get_capability_score("0xAgent...", "insurance.claims.coverage.lloyds.v1"))
print(governance.threshold())
print(governance.get_transaction(0))
```

## Notes on current protocol coverage

The SDK only wraps methods that exist in the current reference contracts.

Discovery guidance for current public integrations:
- use canonical capabilities from `CapabilityRegistry` as the primary matching surface
- treat free-text capability strings in `AgentRegistry` as compatibility metadata only
- treat sponsorship / identity tiers as informational unless your deployment independently verifies them
- treat heartbeat / operational trust as liveness context, not ranking-grade truth

That means:
- negotiated remediation is the default path before dispute. Use direct dispute only for explicit hard-fail cases: no delivery, hard deadline breach, clearly invalid/fraudulent deliverables, or safety-critical violations. The SDK exposes both remediation helpers and direct-dispute helpers for those narrow cases.
- evidence anchoring and partial-resolution outcomes are supported through the current `ServiceAgreement` contract
- current dispute resolution authority is deployment-defined and should not be described as fully decentralized by this SDK
- capability taxonomy reads are supported; root governance writes exist on-chain but you should typically drive them through protocol governance
- heartbeat / operational trust reads are exposed via `AgentRegistryClient.get_operational_metrics()` and `get_operational_trust()`
- identity tiers are exposed via `SponsorshipAttestationClient`
- governance support is currently read-focused in the SDK even though the contract is executable multisig on-chain

Not yet wrapped as first-class high-level Python workflows unless/until they exist more concretely on-chain:
- peer arbitrator selection
- automated machine-checkable dispute resolution engines
- human review marketplace orchestration
- richer delivery schema typing beyond the current hash-anchored agreement surface

Also note:
- reputation and heartbeat data should currently be treated as useful inputs, not final truth guarantees
- this README describes the current contract/API surface, not open-public readiness
- experimental ZK/privacy extensions (kept out of the default public-launch SDK path)

## Links

- [GitHub](https://github.com/LegoGigaBrain/arc-402)
- [Reference contracts](../reference/contracts)
