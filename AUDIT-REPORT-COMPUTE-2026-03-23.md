# ComputeAgreement Security Audit Report

**Date:** 2026-03-23
**Auditor:** Claude (Sonnet 4.6) via OpenClaw
**Contract:** `contracts/src/ComputeAgreement.sol` (312 lines)
**Commit:** 75e5f63 (main branch)
**Tooling:** Forge 18 passing tests · Slither 101 detectors

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 2 |
| HIGH     | 4 |
| MEDIUM   | 3 |
| LOW      | 3 |
| INFO     | 2 |
| **Total**| **14** |

---

## Findings

---

```
ID: CA-1
Severity: CRITICAL
Title: Provider ETH transfer failure griefs client refund (permanent fund lock)
Location: ComputeAgreement.sol L213-222
Description:
  endSession performs two sequential ETH transfers: provider first, then client.
  If the provider address is a contract that reverts on receive (or has no fallback),
  the first call{value: cost} reverts, which causes TransferFailed() to be thrown and
  the entire endSession call reverts. Because the session is already marked Completed
  (L202) before the transfers, the session cannot be re-entered—yet the funds are
  locked. More critically, if the status were still Active, a malicious provider could
  deploy a toggling receive() that reverts the first time endSession is called by the
  client (blocking refund) but succeeds when the provider calls endSession later (after
  inflating usage reports). In the current code the status IS set to Completed first,
  so the revert actually rolls back the status change too, meaning the session stays
  Active—but now endSession will revert every time because the provider will always
  revert. Result: client deposit is permanently locked, client can never recover funds.
  Slither confirmed: reentrancy-events, low-level-calls detectors.
Recommendation:
  (A) Pull pattern: store owed amounts, let each party withdraw independently.
  (B) Or: wrap provider transfer in a try/catch-style check; on failure, credit the
      provider's owed amount to a claimable mapping rather than reverting the whole
      settlement. Client refund must always succeed regardless of provider.
Status: OPEN
```

---

```
ID: CA-2
Severity: CRITICAL
Title: Signature replay — same usage report can be submitted multiple times
Location: ComputeAgreement.sol L157-191
Description:
  submitUsageReport verifies the provider signature over (sessionId, periodStart,
  periodEnd, computeMinutes, avgUtilization, metricsHash) but stores no record of
  which signatures have been consumed. A provider can submit an identical report
  (same bytes) multiple times. Each submission increments consumedMinutes by
  computeMinutes, and a new UsageReport is appended to the array. Over N identical
  submissions, consumedMinutes = N * computeMinutes. This lets a dishonest provider
  multiply their payout arbitrarily up to the deposit cap. There is no on-chain
  nonce, no reportId dedup, and no period-overlap check.
Recommendation:
  Track a mapping(bytes32 => bool) of consumed report digests. Before accepting a
  report, require that the digest has not been seen. Mark it used after acceptance.
  Additionally consider enforcing that periodEnd > periodStart and that periods do
  not overlap with previously accepted periods.
Status: OPEN
```

---

```
ID: CA-3
Severity: HIGH
Title: No session timeout — Proposed/Active sessions lock client deposit indefinitely
Location: ComputeAgreement.sol L98-151
Description:
  Once a client calls proposeSession and deposits funds, the session enters Proposed
  status. If the provider never calls acceptSession, or accepts but never calls
  startSession, or starts but never calls endSession, the client's deposit is locked
  forever. There is no expiry timestamp, no client cancellation path from Proposed
  status, and no timeout after which the client can recover funds unilaterally.
  A malicious provider could accept and then go silent after the client has deposited,
  keeping the deposit hostage.
Recommendation:
  Add a proposalExpiry (e.g., block.timestamp + 48 hours) set at propose time.
  Add a cancelSession function callable by the client when status == Proposed and
  block.timestamp > proposalExpiry (or immediately if Proposed). For Active sessions
  with no usage reports and startedAt + maxHours elapsed, allow client to force-end.
Status: OPEN
```

---

```
ID: CA-4
Severity: HIGH
Title: Disputed sessions have no resolution path — funds locked permanently
Location: ComputeAgreement.sol L230-237
Description:
  disputeSession transitions the session to Disputed status. No function in the
  contract can transition away from Disputed. There is no resolveDispute, no
  arbitrator role, no timeout-based auto-resolution, and no way for either party
  to recover funds. Once disputed, the deposit is locked in the contract forever.
  The Disputed state is a permanent black hole for funds.
Recommendation:
  Add a resolveDispute function callable by a designated arbitrator address (set at
  construction or governance). The function should accept a split (providerAmount,
  clientAmount) and execute transfers. Alternatively, add a timeout: if Disputed for
  > N days with no resolution, client can claim a full refund. At minimum, ensure
  funds are not permanently locked.
Status: OPEN
```

---

```
ID: CA-5
Severity: HIGH
Title: Provider self-attestation — provider signs their own usage reports
Location: ComputeAgreement.sol L173-177
Description:
  The contract verifies that the usage report signature was made by s.provider. This
  means the provider is both the submitter (msg.sender check at L167) and the signer
  of the report. There is no client co-signature, no oracle, and no TEE attestation
  required. A dishonest provider can sign and submit arbitrarily large computeMinutes
  values (up to the deposit cap) with no on-chain verification of actual GPU usage.
  The metricsHash is stored for evidence but is never verified against any oracle or
  trusted source. The signature replay issue (CA-2) amplifies this attack.
Recommendation:
  This is partly a design tradeoff (decentralized compute has inherent oracle problems).
  Document the trust model clearly. Mitigations: (1) require client co-signature on
  each report, (2) integrate a TEE attestation scheme, (3) add a challenge period
  after submitUsageReport where the client can reject individual reports before they
  are finalized, (4) cap single-report computeMinutes to a reasonable bound
  (e.g., maxHours * 60 / expected_reports).
Status: OPEN
```

---

```
ID: CA-6
Severity: HIGH
Title: Overpayment (msg.value > required) silently accepted, excess unrefundable
Location: ComputeAgreement.sol L107-121
Description:
  proposeSession stores depositAmount = msg.value (L115), not the required minimum.
  The check at L108 only enforces msg.value >= required. If a client accidentally
  sends more ETH than ratePerHour * maxHours, the excess is stored in depositAmount
  and can only be recovered by going through a full session and getting refunded at
  endSession. If the session is disputed (CA-4), even the overpayment is permanently
  locked. There is no explicit overpayment handling or refund at proposal time.
Recommendation:
  Either (A) refund excess immediately: after storing the session, send back
  msg.value - required to the client; or (B) cap depositAmount at required and refund
  the difference. Option A is simpler. Ensure this refund is done with reentrancy
  safety (client is the caller so re-entry risk is lower, but pull pattern is safest).
Status: OPEN
```

---

```
ID: CA-7
Severity: MEDIUM
Title: Paused enum variant exists but no function transitions to it
Location: ComputeAgreement.sol L21
Description:
  SessionStatus includes Paused as a valid enum variant, but no function in the
  contract ever sets status = SessionStatus.Paused. This dead state creates confusion
  about the intended design, could indicate missing functionality, and may become a
  vulnerability if future code assumes Paused sessions are handled properly.
Recommendation:
  Either remove the Paused variant from the enum (if not needed), or implement
  pauseSession / resumeSession functions with appropriate access control and state
  transitions. Document the intended pause semantics.
Status: OPEN
```

---

```
ID: CA-8
Severity: MEDIUM
Title: consumedMinutes can exceed maxHours * 60 — cost clamped but not validated
Location: ComputeAgreement.sol L179, L209
Description:
  submitUsageReport adds computeMinutes to consumedMinutes without checking that
  the total stays within maxHours * 60. A provider can accumulate far more minutes
  than the agreed maximum (e.g., submit 10,000 minutes on a 4-hour session). The
  cost is eventually clamped to the deposit at endSession (L209), so no extra funds
  are extracted — but the inflated consumedMinutes corrupts the session record,
  emits misleading events, and in combination with signature replay (CA-2) could
  allow very rapid inflation. A single over-limit report also wastes gas for all
  subsequent reports since cost is already at cap.
Recommendation:
  In submitUsageReport, add: require(s.consumedMinutes + computeMinutes <= s.maxHours * 60,
  "Exceeds max hours"). This enforces the agreed session cap on-chain and prevents
  misleading accounting.
Status: OPEN
```

---

```
ID: CA-9
Severity: MEDIUM
Title: Self-dealing: provider == client is allowed
Location: ComputeAgreement.sol L98-124
Description:
  proposeSession places no restriction on provider == msg.sender. If a single address
  is both client and provider, it can propose a session to itself, accept it, start it,
  submit unlimited usage reports (signed by itself), and call endSession to recover
  the full deposit as "cost". While economically neutral (same address pays and
  receives), this creates accounting noise, may interfere with protocol-level metrics,
  and in systems that reward providers based on session counts could be exploited for
  metric inflation.
Recommendation:
  Add require(provider != msg.sender, "Self-dealing not allowed") in proposeSession.
Status: OPEN
```

---

```
ID: CA-10
Severity: LOW
Title: ecrecover returns address(0) on invalid signature — not explicitly handled
Location: ComputeAgreement.sol L299-311
Description:
  _recoverSigner calls ecrecover, which returns address(0) when the signature is
  malformed (e.g., v not in {27, 28}, invalid r/s values). The check at L177
  (recovered != s.provider) will catch this only if s.provider != address(0). Since
  _getSession already enforces s.client != address(0) and provider is validated at
  propose time, this is low risk — but a session with provider == address(0) would
  allow unsigned reports. Also, the assembly reads v from byte offset 96 which
  corresponds to the 33rd byte of the 96th 32-byte word; this is correct for a
  65-byte sig but should use a well-audited library.
Recommendation:
  After ecrecover, add: require(recovered != address(0), "ecrecover failed").
  Consider using OpenZeppelin's ECDSA library which handles these edge cases.
Status: OPEN
```

---

```
ID: CA-11
Severity: LOW
Title: acceptSession can be called when session is already Active (if startedAt > 0)
Location: ComputeAgreement.sol L129-136
Description:
  acceptSession correctly checks status == Proposed. However, startSession requires
  status == Active AND startedAt == 0. The startedAt == 0 check uses require() with
  a string error (L147) rather than the contract's custom error pattern (WrongStatus).
  This inconsistency is minor but affects error handling uniformity for off-chain
  tooling.
Recommendation:
  Replace require(s.startedAt == 0, "Already started") with a custom error, e.g.:
  if (s.startedAt != 0) revert AlreadyStarted();
Status: OPEN
```

---

```
ID: CA-12
Severity: LOW
Title: Solidity version pragma allows known-buggy compiler versions
Location: ComputeAgreement.sol L2
Description:
  The pragma ^0.8.20 allows any 0.8.x >= 0.8.20. Slither flagged this as containing
  known severe issues: VerbatimInvalidDeduplication, FullInlinerNonExpressionSplitArgumentEvaluationOrder,
  MissingSideEffectsOnSelectorAccess. While these bugs may not directly affect this
  contract, a fixed pragma is best practice for deployed contracts.
Recommendation:
  Pin to a specific version, e.g., pragma solidity 0.8.28; (latest stable as of audit).
Status: OPEN
```

---

```
ID: CA-13
Severity: INFO
Title: No two-step ownership / admin role for future arbitration
Location: ComputeAgreement.sol (entire file)
Description:
  The contract has no owner, admin, or arbitrator role. This is intentional for
  trustlessness but makes it impossible to add dispute resolution or emergency
  recovery without a new deployment. If an arbitrator role is added in a future
  version, a two-step transfer pattern should be used.
Recommendation:
  If governance is added, use two-step ownership transfer (Ownable2Step pattern).
Status: OPEN
```

---

```
ID: CA-14
Severity: INFO
Title: Usage report period timestamps not validated against session start/end
Location: ComputeAgreement.sol L157-191
Description:
  submitUsageReport accepts any periodStart and periodEnd values without checking
  that they fall within the session's active window (startedAt to current time).
  A provider could submit reports with future timestamps or timestamps before session
  start. While this doesn't directly enable fund theft (cost is capped by deposit),
  it pollutes the on-chain record and may mislead off-chain tooling and dispute
  arbitration.
Recommendation:
  Add: require(periodStart >= s.startedAt, "Period before session start");
       require(periodEnd <= block.timestamp, "Period end in future");
       require(periodEnd > periodStart, "Invalid period range");
Status: OPEN
```

---

## Slither Summary

| Detector | Severity | Location |
|----------|----------|----------|
| reentrancy-events | Medium | endSession L197-225 |
| timestamp | Low | startSession L147, endSession L209,213,219 |
| assembly | Informational | _recoverSigner L304-308 |
| solc-version | Informational | L2 |
| low-level-calls | Informational | endSession L214, L220 |

---

## Fix Plan

### CRITICAL fixes (CA-1, CA-2):
- **CA-1**: Add a claimable withdraw mapping (pull payment pattern). Provider and client each claim independently. Alternatively wrap provider transfer so its failure credits a pending balance rather than reverting.
- **CA-2**: Track consumed report digest hashes in a mapping. Reject duplicate digests.

### HIGH fixes (CA-3, CA-4, CA-5, CA-6):
- **CA-3**: Add `proposalDeadline` field, cancelSession for client in Proposed/unstarted Active.
- **CA-4**: Add `arbitrator` address + resolveDispute function; add dispute timeout fallback.
- **CA-5**: Add client challenge window (document trust model — full fix requires oracle).
- **CA-6**: Refund excess deposit (msg.value - required) at propose time.

### MEDIUM/LOW: Apply as part of same fix pass.
