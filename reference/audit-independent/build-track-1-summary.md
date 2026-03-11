# ARC-402 Track 0 + Track 1 implementation summary

Implemented the requested Track 0 and Track 1 remediation/dispute work in the ARC-402 reference repo.

## What changed

### Critical fixes
- `ServiceAgreement.dispute()` now sets `resolvedAt` when a dispute is opened, preserving the existing dispute-timeout path.
- `TrustRegistryV2` now exposes a v1-compatible `getScore()` alias and explicitly implements the shared trust-registry surface so `ServiceAgreement` / wallet consumers can point at V2 safely.
- Added a regression test proving `ARC402Wallet.proposeRegistryUpdate()` rejects a second registry proposal while one is already pending.

### Negotiated remediation layer
- Added bounded pre-dispute remediation to `ServiceAgreement`:
  - 24 hour remediation window
  - maximum 2 client feedback cycles
  - structured client feedback records (`feedbackHash`, `feedbackURI`)
  - structured provider responses with options for `REVISE`, `DEFEND`, `COUNTER`, `PARTIAL_SETTLEMENT`, `REQUEST_HUMAN_REVIEW`, and `ESCALATE`
  - transcript chaining via `previousTranscriptHash` + computed `transcriptHash`
- Added getters for remediation case / feedback / response records.

### Formal dispute scaffolding
- Added explicit dispute data structures for evidence and resolution metadata.
- Added evidence submission with typed evidence records (`EvidenceType`, hash, URI, timestamp).
- Added richer dispute outcomes via `DisputeOutcome` and `resolveDisputeDetailed()` with partial award support.
- Preserved legacy `resolveDispute(id, favorProvider)` as a compatibility wrapper.
- Added escalation path from remediation into formal dispute / human-review scaffolding.

### Extra cleanup required to keep the repo green
- Restored compatibility across older trust-registry tests/callers using the newer multi-argument trust update flow.
- Removed duplicated `SponsorshipAttestation.getAttestation()` declarations and fixed its `publishWithTier` string parameter shape.
- Updated/fixed impacted tests and legacy call sites so the full Foundry suite compiles and passes.

## Verification
- Ran full `forge test`
- Result: **272 passed, 0 failed**
