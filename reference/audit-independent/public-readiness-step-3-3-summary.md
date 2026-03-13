# ARC-402 Public Readiness Step 3.3 — Dispute Legitimacy / Arbitration Authority

Implemented a minimal but real layered dispute authority model so ARC-402 no longer collapses in practice to owner-led adjudication.

## What changed

### 1. Tiered authority model now exists on-chain
- **Tier 1 — machine-verifiable path** remains for explicit hard-fail cases through `directDispute(...)`:
  - no delivery
  - hard deadline breach
  - invalid/fraudulent deliverable
  - safety-critical violation
- **Tier 2 — peer arbitration** added:
  - approved arbitrators can be nominated by agreement parties
  - a 3-member panel is formed
  - arbitrators cast votes
  - 2-of-3 majority can finalize:
    - provider wins
    - client refund
    - exact split / partial outcome
    - escalate to human review
- **Tier 3 — human backstop** constrained:
  - owner/admin resolution is now gated to `ESCALATED_TO_HUMAN`
  - human resolution requires `humanReviewRequested == true`
  - human resolution also requires submitted evidence
  - owner is no longer the default live dispute authority

### 2. Evidence-first process hardened
- dispute evidence remains a first-class structure
- human backstop resolution now requires evidence to exist
- dispute case tracks evidence count and human-review intent

### 3. Timeouts / no-show behavior clarified
- arbitration selection window added
- arbitration decision window added
- parties can request human escalation when arbitration stalls or times out
- legacy dispute timeout refund path still exists as client-safe backstop

### 4. Partial resolution remains exact
- peer arbitration can finalize an exact provider/client split
- split votes require matching exact payout values before majority settlement is applied
- payout math remains bounded to escrow total

## Files changed
- `contracts/IServiceAgreement.sol`
- `contracts/ServiceAgreement.sol`
- `test/ServiceAgreement.t.sol`
- `test/ServiceAgreement.track1.t.sol`
- `test/ServiceAgreement.v2.t.sol`
- `test/ServiceAgreement.attack.t.sol`
- `sdk/src/types.ts`
- `sdk/src/agreement.ts`
- `sdk/src/contracts.ts`
- `sdk/test/sdk.test.js`
- `cli/src/abis.ts`
- `cli/README.md`
- regenerated SDK dist via `npm run build`

## What is implemented now vs later

### Implemented now
- approved arbitrator registry
- party nomination of arbitrators
- 3-seat panel
- majority vote resolution
- exact split voting for partial outcomes
- explicit human escalation path / backstop gating
- evidence requirement for human resolution

### Not yet implemented / future extension
- decentralized arbitrator incentives / staking / slashing
- cryptoeconomic arbitrator selection
- challengeable arbitrator conflicts and recusals
- richer machine-verifiable Tier 1 outcome proofs beyond current explicit hard-fail gates
- governance-controlled arbitrator rotation and reputation markets

## Verification
- `forge test --match-path 'test/ServiceAgreement*.t.sol'`
- `cd sdk && npm run build && npm test`

All passed after updates.
