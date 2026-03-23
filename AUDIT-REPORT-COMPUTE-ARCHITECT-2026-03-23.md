# ComputeAgreement — Architect Design Review
**Auditor:** Auditor B (The Architect)
**Date:** 2026-03-23
**Contract:** `contracts/src/ComputeAgreement.sol` (post-fix, v2026-03-23)
**Scope:** Design flaws, economic invariants, architectural weaknesses — NOT exploit testing

---

## Executive Summary

The post-fix contract is structurally sound for MVP: CEI is followed, pull-payment prevents reentrancy, and the basic economic invariant (deposit == sum of credited withdrawals) holds per-session. However, ten architectural weaknesses are identified that will matter at production scale: the arbitrator is a permanent single point of failure with no rotation path, the `Active` state conflates two distinct sub-states creating friction, several event fields are missing information needed for reliable off-chain indexing, and the contract is fully isolated from the broader ARC-402 identity and reputation stack. These are not blockers for testnet, but should be addressed before mainnet.

---

## Findings

---

```
ID: CA-ARCH-1
Severity: DESIGN
Title: Arbitrator Is Immutable — No Compromise Recovery Path
Description:
  The arbitrator address is set once at construction as `immutable`. There is no
  mechanism to rotate, update, or replace it. If the arbitrator key is compromised,
  lost, or becomes untrustworthy, every pending Disputed session is at risk of
  malicious resolution — and there is no on-chain remedy short of deploying a new
  contract (stranding all active sessions).

  A compromised arbitrator can call resolveDispute(sessionId, depositAmount, 0) to
  drain any disputed deposit entirely to the provider. There is no second-signature
  requirement, no timelock, and no veto path for either party.

  Additionally, there is no check that arbitrator != provider or arbitrator != client.
  An arbitrator who is also a major compute provider has a direct financial interest
  in resolving disputes in favor of providers — a structural conflict of interest.

Recommendation:
  - Replace single EOA arbitrator with a multi-sig or DAO-controlled address.
  - Add an owner-only arbitratorRotation(address newArbitrator) with a timelock
    (e.g., 7-day announcement period) so disputes in flight are not disrupted.
  - Add invariant check: arbitrator != client && arbitrator != provider at
    resolveDispute time.
  - Consider adding a providerVeto / clientVeto mechanism for clearly malicious
    arbitrator rulings.
```

---

```
ID: CA-ARCH-2
Severity: DESIGN
Title: Client-Only Timeout for Disputed Sessions — Provider Has No Equivalent Fallback
Description:
  claimDisputeTimeout (L350) is exclusively available to the client. If the arbitrator
  is unresponsive and the dispute expires, the client can reclaim the full deposit.
  However, the provider has no symmetric fallback: if the *client* is unresponsive
  (e.g., compromised, dead address) after a dispute is filed, the provider cannot
  claim even a partial payment for work they demonstrably performed (evidenced by
  the accepted usage reports on-chain).

  Concretely: provider delivers 7 days of GPU compute, client disputes, arbitrator
  is unreachable, 7-day timeout fires → client gets 100% refund despite valid
  usage reports. Provider receives zero.

  This creates an adversarial incentive: clients can dispute late-in-session at
  negligible cost, gambling that the arbitrator will be offline within 7 days.

Recommendation:
  - Add a symmetric provider timeout: if DISPUTE_TIMEOUT passes without arbitrator
    action, default to paying the provider for minutes they can prove via usage
    reports (calculateCost logic), refunding the remainder to client.
  - Alternatively, split the timeout into two phases: Phase 1 (3 days) — arbitrator
    window; Phase 2 (4 days) — either party can claim with usage-report-based
    settlement as default.
```

---

```
ID: CA-ARCH-3
Severity: DESIGN
Title: Active State Conflates Accepted-Not-Started and Running — Two Sub-States
Description:
  SessionStatus.Active covers both of these distinct situations:
    (a) Provider accepted, startedAt == 0 (accepted, not started)
    (b) Provider accepted, startedAt > 0 (running)

  The contract handles these correctly via explicit startedAt checks, but the
  state machine is more complex than the enum expresses. The cancelSession function
  (L380) contains the special case `s.status == SessionStatus.Active && s.startedAt == 0`
  — a symptom of this conflation.

  Downstream effects:
  - Off-chain indexers receive SessionAccepted events and cannot determine from
    status alone whether the session is running.
  - disputeSession, endSession, and submitUsageReport all require Active but have
    different implicit sub-state requirements (startedAt > 0 for reports; either
    sub-state for endSession).

Recommendation:
  Add SessionStatus.Accepted to the enum. acceptSession transitions Proposed →
  Accepted; startSession transitions Accepted → Active (Running). This makes the
  state machine explicit and removes the startedAt == 0 special case from
  cancelSession:
    - Cancel from Proposed: after TTL
    - Cancel from Accepted: any time (provider hasn't started)
    - Cancel from Active: only via dispute or endSession
```

---

```
ID: CA-ARCH-4
Severity: DESIGN
Title: No Mutual Abort Path From Disputed State
Description:
  Once a session enters Disputed status, the only exits are:
    1. resolveDispute — requires arbitrator
    2. claimDisputeTimeout — requires client + 7-day wait

  If both the client and provider agree they want to settle directly (e.g., they
  reached an off-chain agreement), there is no on-chain mechanism to do so.
  They must wait for the arbitrator or the full 7-day timeout.

  This is particularly painful if the arbitrator is slow or offline, and both
  parties are cooperative and want to move on quickly.

Recommendation:
  Add mutualSettle(bytes32 sessionId, uint256 providerAmount, uint256 clientAmount)
  requiring signatures from both client AND provider. This bypasses the arbitrator
  when both parties agree and eliminates the 7-day lockup for cooperative disputes.
```

---

```
ID: CA-ARCH-5
Severity: DESIGN
Title: No Provider Relinquish Path After Acceptance
Description:
  Once a provider calls acceptSession, they are committed. They can choose not to
  call startSession (allowing the client to cancel), but they cannot explicitly
  relinquish the session. There is no rejectSession or withdrawAcceptance mechanism.

  If a provider accepts in error (wrong hardware, scheduling conflict), they must
  rely on the client to notice and cancel — with no guarantee the client will act.
  The provider's address remains associated with the session permanently.

  While the financial risk is zero (provider loses nothing from not starting), the
  operational clarity is poor: the provider's monitoring tooling sees a session in
  Active (accepted) state indefinitely until client cancels.

Recommendation:
  Add relinquishSession(bytes32 sessionId): provider-only, requires Active &&
  startedAt == 0, transitions back to Proposed (or to Cancelled with full deposit
  refund to client). This gives providers a clean exit and clients immediate
  notification that they need to find another provider.
```

---

```
ID: CA-ARCH-6
Severity: ECONOMIC
Title: Integer Division Truncation — Provider Systematically Underpaid by Up to 59 Wei
Description:
  calculateCost (L417):
    return (s.consumedMinutes * s.ratePerHour) / 60;

  Integer division truncates. For any session where (consumedMinutes * ratePerHour)
  is not divisible by 60, the provider is underpaid and the client over-refunded by
  up to 59 Wei.

  At scale: 1,000 sessions/day × 59 Wei max loss = 59,000 Wei/day ≈ negligible at
  current ETH prices, but the invariant is technically violated: the provider does
  not receive full compensation for computed work.

  If ratePerHour is denominated in very small units (e.g., sub-Wei pricing on L2s
  where ETH is ~$3000 and sessions are priced in fractional cents), the truncation
  becomes meaningful as a fraction of payment.

Recommendation:
  Round up in favor of the provider (ceiling division):
    cost = (s.consumedMinutes * s.ratePerHour + 59) / 60;
  Or explicitly document that fractional minutes are not compensated and that clients
  should use ratePerHour values divisible by 60 (i.e., price per minute directly).
```

---

```
ID: CA-ARCH-7
Severity: ECONOMIC
Title: Zero maxHours and Zero ratePerHour Sessions Are Unconstrained
Description:
  proposeSession does not validate that maxHours > 0 or ratePerHour > 0.

  Case A: maxHours == 0
    - depositAmount = 0, session is "free"
    - maxMinutes = 0, so any submitUsageReport with computeMinutes > 0 reverts
    - Session can only end with 0 cost — economically meaningless but creates
      observable state on-chain

  Case B: ratePerHour == 0
    - depositAmount = 0, free session
    - maxMinutes = maxHours * 60, potentially enormous
    - submitUsageReport works fine, accumulates minutes
    - endSession credits 0 to provider (cost = 0)
    - If maxHours is very large (e.g., type(uint256).max / 60 + 1), then
      maxHours * 60 overflows in submitUsageReport, reverting with a Solidity
      panic and permanently bricking the session (neither party can close it
      via usage reports; endSession must be called directly for 0 cost settlement)

  The overflow case (ratePerHour = 0, maxHours > type(uint256).max / 60) creates
  a permanently stuck session that can only be closed via endSession with 0 payout.

Recommendation:
  Add to proposeSession:
    if (maxHours == 0) revert InvalidSessionParameters();
    if (ratePerHour == 0) revert InvalidSessionParameters();
  This eliminates zero-deposit sessions, the overflow vector, and economically
  meaningless state.
```

---

```
ID: CA-ARCH-8
Severity: ECONOMIC
Title: resolveDispute Remainder Always Flows to Client — Arbitrator Cannot Slash Both Parties
Description:
  In resolveDispute (L340):
    uint256 remainder = s.depositAmount - providerAmount - clientAmount;
    if (remainder > 0) pendingWithdrawals[s.client] += remainder;

  If the arbitrator wants to penalize both parties (e.g., bad faith on both sides),
  they can reduce both providerAmount and clientAmount — but the remainder goes to
  the client regardless. The arbitrator cannot "burn" funds or direct remainder to
  a protocol treasury, penalty pool, or the arbitrator themselves as a fee.

  Practical effect: "slashing" in a dispute always benefits the client. The provider
  can be fully slashed to 0; the client's worst case is receiving back only their
  deposit minus whatever the arbitrator awards to the provider. The client can never
  receive LESS than (depositAmount - providerAmount).

Recommendation:
  If symmetrical slashing is desired, add a penaltyRecipient address (e.g., a
  protocol treasury) to the constructor. The remainder logic becomes:
    if (remainder > 0) pendingWithdrawals[penaltyRecipient] += remainder;
  Alternatively, explicitly document that remainder-goes-to-client is intentional
  policy (conservative: client gets benefit of doubt on unallocated funds).
```

---

```
ID: CA-ARCH-9
Severity: GAS
Title: Full UsageReport Struct Stored On-Chain Including providerSignature Bytes
Description:
  submitUsageReport stores the full UsageReport struct in usageReports[sessionId][],
  including the providerSignature (bytes, dynamic — 65 bytes = ~3 storage slots).
  The signature has already been verified on-chain; storing it primarily serves as
  an on-chain proof for dispute evidence.

  Cost per report: at minimum 3× cold SSTOREs for the signature alone (~60,000 gas)
  plus the fixed struct fields (~5 SSTOREs = ~100,000 gas). For a session with
  report every 15 minutes over 24 hours = 96 reports × ~160,000 gas = ~15.4M gas
  just for report storage. At 5 gwei base fee on Base, that is ~$0.08 at current
  ETH prices but becomes significant at higher gas prices or longer sessions.

  The signature is derivable from the emitted UsageReported event combined with the
  original signing operation — off-chain dispute systems can recover it from logs.

Recommendation:
  Emit the providerSignature in the UsageReported event but do NOT store it in the
  on-chain array. For dispute evidence, the metricsHash + event log is sufficient.
  Remove the providerSignature field from the stored UsageReport struct.
  This reduces per-report storage by ~3 slots (~60,000 gas per report).
```

---

```
ID: CA-ARCH-10
Severity: GAS
Title: require() With String Errors in submitUsageReport Instead of Custom Errors
Description:
  submitUsageReport (L237-L238) uses:
    require(s.startedAt > 0, "Session not started");
    require(avgUtilization <= 100, "Utilization out of range");

  String-based require() costs more gas than custom errors (no ABI encoding of the
  string at revert time) and is inconsistent with the rest of the contract which
  uses custom errors exclusively.

Recommendation:
  Replace with custom errors:
    error SessionNotStarted();
    error UtilizationOutOfRange();
  and:
    if (s.startedAt == 0) revert SessionNotStarted();
    if (avgUtilization > 100) revert UtilizationOutOfRange();
```

---

```
ID: CA-ARCH-11
Severity: EVENT
Title: DisputeResolved Event Does Not Distinguish Arbitrator Resolution From Client Timeout Claim
Description:
  Both resolveDispute (L343) and claimDisputeTimeout (L361) emit the same
  DisputeResolved event:
    emit DisputeResolved(sessionId, providerAmount, clientAmount);

  An off-chain indexer cannot distinguish whether the resolution was an active
  arbitrator decision or a passive client timeout claim. This matters for:
  - Dispute analytics (how often does arbitrator actually act vs. timeout?)
  - Provider dispute reputation (timeout claim looks identical to arbitrator ruling)
  - Audit trails (was there an arbitrator present for this dispute?)

Recommendation:
  Add a resolution type field, or emit a separate event:
    event DisputeTimedOut(bytes32 indexed sessionId, uint256 clientAmount);
  for claimDisputeTimeout, reserving DisputeResolved for arbitrator actions only.
```

---

```
ID: CA-ARCH-12
Severity: EVENT
Title: DisputeResolved Event Omits Remainder — Client Receives More Than clientAmount
Description:
  In resolveDispute (L340-L341):
    uint256 remainder = s.depositAmount - providerAmount - clientAmount;
    if (remainder > 0) pendingWithdrawals[s.client] += remainder;

  But the event (L343) only emits (providerAmount, clientAmount). The client's
  actual payout is clientAmount + remainder, but the event shows only clientAmount.

  Off-chain systems (dashboards, tax reporting tools, compliance monitors) that
  rely on events to reconstruct balances will show incorrect client payout amounts
  whenever the arbitrator does not allocate exactly 100% of the deposit.

Recommendation:
  Either emit (providerAmount, clientAmount + remainder) — the actual credited amounts —
  or add a third parameter to the event:
    event DisputeResolved(
      bytes32 indexed sessionId,
      uint256 providerAmount,
      uint256 clientAmount,
      uint256 remainder
    );
```

---

```
ID: CA-ARCH-13
Severity: EVENT
Title: endSession Does Not Emit Which Party Terminated the Session
Description:
  endSession allows either client or provider to call it (L283). The SessionCompleted
  event (L300) emits (sessionId, totalMinutes, totalPaid, refunded) but does not
  include msg.sender (the terminating party).

  Off-chain systems cannot distinguish provider-initiated vs. client-initiated
  termination without decoding tx.from, which is unavailable inside smart contracts
  and requires separate RPC calls by indexers. This distinction matters for:
  - Provider SLA compliance tracking (did provider end early?)
  - Reputation systems (frequent early terminations by provider are a signal)

Recommendation:
  Add terminator to the event:
    event SessionCompleted(
      bytes32 indexed sessionId,
      address indexed terminatedBy,
      uint256 totalMinutes,
      uint256 totalPaid,
      uint256 refunded
    );
```

---

```
ID: CA-ARCH-14
Severity: INTEGRATION
Title: ComputeAgreement Is Fully Isolated From ARC-402 Identity and Reputation Stack
Description:
  The ARC-402 SDK exposes AgentRegistryClient, TrustClient, ReputationOracleClient,
  and CapabilityRegistryClient. ComputeAgreement ignores all of them:

  1. Provider identity: any address can be a provider — no requirement to be a
     registered ARC-402 agent, no capability attestation checked on-chain.
  2. gpuSpecHash: agreed at proposal time but never verified against an on-chain
     hardware registry or capability attestation. A provider can commit to a
     gpuSpecHash they cannot fulfill.
  3. No post-session reputation update: SessionCompleted fires but nothing writes
     to the reputation oracle. Compute sessions do not improve or damage provider
     reputation scores.
  4. Trust-gated access: clients have no way to require a minimum trust score from
     providers at proposal time.

  This creates a class of compute agreements that are disconnected from the
  broader ARC-402 trust and quality-of-service guarantees that the rest of the
  protocol provides.

Recommendation:
  - Add optional agentRegistryAddress parameter to constructor. If non-zero, verify
    provider.isRegisteredAgent() and provider.hasCapability(gpuSpecHash) at
    acceptSession time.
  - Post-settlement, emit an event that an off-chain reputation oracle can consume
    to update provider scores.
  - For long-term integration: accept a jobId / agreementId linking ComputeAgreement
    sessions to ServiceAgreement entries in the existing ARC-402 escrow system.
```

---

```
ID: CA-ARCH-15
Severity: INTEGRATION
Title: ERC-20 Support and Upgradability Require Full Redeployment — No Migration Path
Description:
  ComputeAgreement is non-upgradeable (no proxy, no UUPS, no beacon). All payment
  is native ETH. Adding ERC-20 payment tokens (USDC, wETH, protocol tokens) requires:
  - Deploying a new contract
  - All active sessions on the old contract are unaffected / cannot be migrated
  - Client tooling must track multiple contract addresses

  The pendingWithdrawals mapping is address → uint256, which cannot track per-token
  balances. A multi-token extension would require address → address → uint256
  (recipient → token → amount), a breaking struct change.

  Similarly, batch session creation (e.g., spin up 10 sessions in one tx) is
  impossible without a wrapper or factory, costing 10× the transaction overhead.

Recommendation:
  - Document the redeployment strategy and ensure session IDs include a contract
    version prefix to prevent cross-contract replay.
  - For ERC-20: design a v2 interface now, even if not implemented, to avoid
    breaking architectural decisions in v1 (e.g., keep tokenAddress field reserved
    as address(0) = ETH in the session struct).
  - Add a ComputeSessionFactory pattern for batch creation.
  - Consider a minimal proxy (EIP-1167 clone factory) to reduce deployment cost
    while maintaining per-session isolation.
```

---

```
ID: CA-ARCH-16
Severity: INTEGRATION
Title: sessionId Is Caller-Supplied With No Collision Prevention
Description:
  proposeSession takes an arbitrary bytes32 sessionId from the caller. Collision
  prevention relies entirely on off-chain convention (e.g., keccak256 of client
  + nonce). The contract only checks sessions[sessionId].client == address(0).

  Two clients using the same collision-avoidance scheme (e.g., both computing
  keccak256 of their address + block.timestamp in the same block) could produce
  the same sessionId. The second proposal would revert with SessionAlreadyExists —
  which is safe but surprising.

  More importantly: there is no on-chain nonce registry. If the off-chain SDK has
  a bug in sessionId generation, users can silently stomp each other's sessions.
  A malicious front-runner who observes a proposeSession in the mempool can attempt
  to grief by submitting their own proposeSession with the same sessionId first.

Recommendation:
  Generate sessionId deterministically on-chain:
    sessionId = keccak256(abi.encodePacked(msg.sender, provider, nonces[msg.sender]++));
    return sessionId;
  Make proposeSession return the generated sessionId. This eliminates all collision
  and front-running risk, at the cost of slightly more complex client tooling
  (read the returned event rather than pre-computing the ID).
```

---

```
ID: CA-ARCH-17
Severity: INFO
Title: maxHours * 60 Cap Is Arithmetically Correct — No Off-By-One
Description:
  The cap check in submitUsageReport (L247):
    if (s.consumedMinutes + computeMinutes > maxMinutes) revert ExceedsMaxMinutes();

  Uses strict greater-than, allowing exact equality. When consumedMinutes == maxMinutes:
    cost = (maxHours * 60 * ratePerHour) / 60 = maxHours * ratePerHour = depositAmount

  The cost exactly equals the deposit when fully consumed, producing refund = 0.
  This is correct: no off-by-one error.

  EDGE NOTE: If maxHours == 0, maxMinutes == 0 and any computeMinutes > 0 reverts
  immediately (correct but meaningless). See CA-ARCH-7 for the zero-guard
  recommendation.

Recommendation:
  No change needed for the cap logic itself. Add the zero-guard from CA-ARCH-7
  to prevent the maxHours == 0 edge case from creating ghost sessions.
```

---

## Summary Table

| ID | Severity | Title | Action |
|----|----------|-------|--------|
| CA-ARCH-1  | DESIGN      | Arbitrator immutable — no rotation/compromise recovery | Fix before mainnet |
| CA-ARCH-2  | DESIGN      | Client-only dispute timeout — no provider fallback | Fix before mainnet |
| CA-ARCH-3  | DESIGN      | Active conflates accepted+running sub-states | Refactor for clarity |
| CA-ARCH-4  | DESIGN      | No mutual abort from Disputed state | Add mutualSettle |
| CA-ARCH-5  | DESIGN      | No provider relinquish path after acceptance | Add relinquishSession |
| CA-ARCH-6  | ECONOMIC    | Integer truncation underpays provider up to 59 Wei | Round up or document |
| CA-ARCH-7  | ECONOMIC    | Zero maxHours/ratePerHour: stuck sessions + overflow | Add zero guards |
| CA-ARCH-8  | ECONOMIC    | Arbitrator remainder always to client — cannot slash both | Document or fix |
| CA-ARCH-9  | GAS         | providerSignature stored on-chain (65 bytes per report) | Emit not store |
| CA-ARCH-10 | GAS         | require() strings in submitUsageReport — inconsistent | Custom errors |
| CA-ARCH-11 | EVENT       | DisputeResolved indistinguishable from timeout claim | Add DisputeTimedOut |
| CA-ARCH-12 | EVENT       | DisputeResolved omits remainder from client total | Add remainder to event |
| CA-ARCH-13 | EVENT       | endSession doesn't log terminating party | Add terminatedBy |
| CA-ARCH-14 | INTEGRATION | Isolated from ARC-402 identity/trust/reputation stack | Phase 2 integration |
| CA-ARCH-15 | INTEGRATION | No ERC-20 path, no upgrade mechanism | Document v2 strategy |
| CA-ARCH-16 | INTEGRATION | Caller-supplied sessionId — collision and grief risk | On-chain nonce |
| CA-ARCH-17 | INFO        | maxHours*60 cap is arithmetically correct | No action |

---

## Pre-Mainnet Blockers

The following must be resolved before mainnet deployment:

1. **CA-ARCH-1** — Compromised arbitrator can drain all disputed sessions. At minimum, require a multi-sig arbitrator.
2. **CA-ARCH-2** — Provider-griefed dispute timeout is a material economic risk for providers.
3. **CA-ARCH-7** — Zero ratePerHour + large maxHours creates permanently bricked sessions (overflow in submitUsageReport).
4. **CA-ARCH-16** — Caller-supplied sessionId is a front-running grief vector on public mempools.

## Testnet OK (with documentation)

Remaining findings are acceptable for testnet with appropriate developer documentation:
- CA-ARCH-3 through CA-ARCH-6: design clarity improvements
- CA-ARCH-8 through CA-ARCH-13: gas and event improvements
- CA-ARCH-14 and CA-ARCH-15: Phase 2 integration work, not blockers

---

*Auditor B / The Architect — 2026-03-23*
