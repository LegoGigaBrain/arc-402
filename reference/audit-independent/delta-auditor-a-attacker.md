# Auditor A (Attacker) — Delta Audit Report 2026-03-11

## Summary

**20 findings: 2 critical, 5 high, 8 medium, 5 low**

Scope: TrustRegistryV2, ServiceAgreement (v2), PolicyEngine, AgentRegistry, ReputationOracle, SponsorshipAttestation, ZKTrustGate, ZKSolvencyGate, ZKCapabilityGate, ARC402Wallet (v2), SettlementCoordinator (v2).

---

## Findings

### A-001 [CRITICAL]: ServiceAgreement `dispute()` Does Not Set `resolvedAt` — Instant Dispute Drain

**Contract:** ServiceAgreement.sol
**Attack:**
1. Client proposes an agreement, locking escrow (e.g. 10 ETH).
2. Provider accepts.
3. Provider begins work / commits deliverable.
4. Client calls `dispute(agreementId, "bad service")` → status becomes DISPUTED. `resolvedAt` remains 0 (never set by `dispute()`).
5. Client **immediately** calls `expiredDisputeRefund(agreementId)`.
6. The check `block.timestamp > ag.resolvedAt + DISPUTE_TIMEOUT` evaluates to `block.timestamp > 0 + 2592000`, which is `block.timestamp > 2592000`. Since current timestamps are ~1.7 billion (year 2024+), this is **always true**.
7. Escrow is immediately refunded to client. Provider loses all work product.

The NatSpec comment on `expiredDisputeRefund` states: *"The dispute() function sets resolvedAt = block.timestamp when the dispute is opened"* — but the code does NOT do this. The comment is wrong; the code is missing the assignment.

**Impact:** Any client can steal services for free. Propose → Accept → Dispute → Instant Refund. Provider has zero recourse. Attacker gains: unlimited free services + trust anomaly recorded against provider.
**Cost:** Gas only (~0.001 ETH per attack).
**Recommendation:** Add `ag.resolvedAt = block.timestamp;` to the `dispute()` function body, immediately after `ag.status = Status.DISPUTED;`. This starts the 30-day timeout clock correctly.

---

### A-002 [CRITICAL]: ServiceAgreement ↔ TrustRegistryV2 Interface Mismatch — Silent Trust Failure

**Contract:** ServiceAgreement.sol, TrustRegistryV2.sol, ITrustRegistry.sol
**Attack:**
ServiceAgreement calls `ITrustRegistry(trustRegistry).recordSuccess(ag.provider)` (1 argument) and `ITrustRegistry(trustRegistry).recordAnomaly(ag.provider)` (1 argument).

TrustRegistryV2 defines:
- `recordSuccess(address wallet, address counterparty, string capability, uint256 agreementValueWei)` (4 arguments)
- `recordAnomaly(address wallet, address counterparty, string capability, uint256 agreementValueWei)` (4 arguments)

These have **different function selectors**. When ServiceAgreement calls the 1-arg version on a TrustRegistryV2 deployment, the call reverts with "function not found." The `try/catch` block catches this silently and emits `TrustUpdateFailed`.

**Result:** In a V2 deployment, **zero trust updates ever occur**. Every agreement completes successfully but the trust system is completely non-functional. Sybils have no trust penalty. Good actors gain no trust. The entire reputation layer is dead.

**Impact:** Complete breakdown of the trust primitive. The marketplace has no reputation enforcement. Sybil farming is free because anomaly penalties never apply.
**Cost:** Zero — the bug exists in every V2 deployment by default.
**Recommendation:** Either:
1. Update ServiceAgreement._updateTrust() to call the V2 4-arg interface (passing `ag.client`, `ag.serviceType`, `ag.price`), OR
2. Add a V1-compatible adapter on TrustRegistryV2 that implements the 1-arg `recordSuccess(address)` and `recordAnomaly(address)` methods with default counterparty/capability/value, OR
3. Create an `ITrustRegistryV2`-aware ServiceAgreement that detects which interface the registry supports.

Option 1 is cleanest. ServiceAgreement already has all the data needed for V2 calls.

---

### A-003 [HIGH]: ZK Gate Proofs Not Bound to Agent Identity — Proof Replay Attack

**Contract:** ZKTrustGate.sol, ZKSolvencyGate.sol
**Attack:**
- `ZKTrustGate.verifyZK()`: The only public input is `threshold`. No agent address is included.
- `ZKSolvencyGate.verifySolvency()`: The only public input is `requiredAmount`. No wallet address is included.

Attack flow:
1. High-trust Agent A calls `verifyZK(proof, 500)` — proof is visible in the mempool.
2. Low-trust Agent B front-runs with the same proof parameters, calling `verifyZK(sameProof, 500)`.
3. Both calls succeed. Agent B has now "proven" they meet a trust threshold they don't actually meet.

Even without front-running, Agent A can simply share their proof off-chain with Agent B.

**Impact:** ZK trust and solvency gates are completely bypassable. Any agent can use any other agent's proof. The privacy-preserving verification is security theater.
**Cost:** Gas only. Proof observation is free (mempool monitoring or off-chain sharing).
**Recommendation:** The ZK circuits MUST include the prover's address as a public input. For ZKTrustGate: `pubSignals = [threshold, agentAddress]`. For ZKSolvencyGate: `pubSignals = [requiredAmount, walletAddress]`. The on-chain verifier must check `pubSignals[1] == msg.sender` (or the claimed agent address).

---

### A-004 [HIGH]: ReputationOracle Sybil WARN Griefing — Cheap Reputation Assassination

**Contract:** ReputationOracle.sol, TrustRegistryV2.sol
**Attack:**
1. Attacker creates N Sybil wallets (each gets INITIAL_SCORE = 100 in TrustRegistry).
2. Each Sybil calls `publishSignal(target, SignalType.WARN, 0, "scam")`.
3. One signal per publisher-subject pair is allowed. Each WARN is weighted by publisher's trust (100).
4. With 200 Sybils: 200 × 100 = 20,000 weighted negative score.
5. Target's legitimate endorsements from trust-500 agents: each worth 500. To overcome 20,000 negative, target needs 40 endorsements from trust-500 agents.
6. Each Sybil costs only gas (~0.001 ETH). Total attack: 200 × 0.001 = 0.2 ETH.

**Impact:** Any agent can be reputation-assassinated for < 1 ETH. The ReputationOracle has no minimum trust threshold for publishing signals. A trust-100 Sybil's WARN has the same structural validity as any other signal.
**Cost:** ~0.2 ETH for a damaging attack (200 Sybils × gas cost).
**Recommendation:**
1. Require minimum trust score to publish signals (e.g., trust ≥ 200 to publish WARN/BLOCK).
2. Apply non-linear trust weighting: signals from trust < 200 agents weighted at 0 or heavily discounted.
3. Add a time-decay to signals (old WARNs lose weight).
4. Add a cooldown or stake requirement for manual signal publication.

---

### A-005 [HIGH]: X402Interceptor Has No Access Control — Anyone Can Trigger Payments

**Contract:** X402Interceptor.sol, ARC402Wallet.sol
**Attack:**
`executeX402Payment()` has NO access control modifier. Any EOA or contract can call it. The function forwards to `arc402Wallet.executeTokenSpend()` which checks `onlyOwnerOrInterceptor` — and if the wallet has authorized this interceptor via `setAuthorizedInterceptor()`, the check passes.

The intent attestation requirement limits the damage (attacker needs a valid, unused attestation matching exact parameters). However:
1. Attestation IDs may be observable in mempool when the wallet owner creates them.
2. An attacker can front-run the legitimate executeX402Payment call with the same attestationId.
3. The attestation is consumed, and the payment goes to the correct recipient — but the attacker controls the timing and can sandwich the transaction.

More concerning: if the wallet owner creates an attestation and the attacker observes it, the attacker can call executeX402Payment before the legitimate caller, consuming the attestation. The legitimate call then fails.

**Impact:** Attestation front-running / griefing. Legitimate payments can be blocked or executed at attacker-controlled timing.
**Cost:** Gas only (mempool observation is free).
**Recommendation:** Add `onlyOwner` or a caller allowlist to `executeX402Payment()`. Alternatively, add `msg.sender` verification in the wallet's `executeTokenSpend` that checks the interceptor was called by the wallet owner.

---

### A-006 [HIGH]: ARC402Wallet Velocity Freeze Silently Blocks Without Revert — Fund Grief

**Contract:** ARC402Wallet.sol
**Attack:**
In `executeSpend()` and `executeTokenSpend()`, when the velocity limit is exceeded:
```solidity
ethSpendingInWindow += amount;
if (velocityLimit > 0 && ethSpendingInWindow > velocityLimit) {
    frozen = true;
    frozenAt = block.timestamp;
    emit WalletFrozen(address(this), "velocity limit exceeded", block.timestamp);
    return; // silently blocks — no revert
}
```

The amount is added to `ethSpendingInWindow` but no transfer occurs and the transaction does NOT revert. The intent attestation is NOT consumed (consume happens after the velocity check). But:
1. The wallet is now frozen, blocking ALL subsequent operations.
2. The calling agent gets no revert signal — the transaction succeeds from the caller's perspective but no funds moved.
3. If this is part of a multi-step workflow (e.g., ServiceAgreement escrow funding), the agent believes it paid but didn't.

**Impact:** Silent payment failure can cause agents to believe they've paid when they haven't, leading to service disputes. The wallet owner must manually unfreeze.
**Cost:** N/A — this is a design flaw triggered by normal operation near velocity limits.
**Recommendation:** REVERT instead of silently returning. The caller (agent software) needs to know the payment failed. `revert("ARC402: velocity limit exceeded")`. Set the freeze flag but still revert so the caller knows.

---

### A-007 [HIGH]: ZKCapabilityGate — Anyone Can Set Arbitrary Capability Root

**Contract:** ZKCapabilityGate.sol
**Attack:**
`setCapabilityRoot(bytes32 root)` allows any address to set any arbitrary root:
```solidity
function setCapabilityRoot(bytes32 root) external {
    require(root != bytes32(0), "ZKCapabilityGate: zero root");
    capabilityRoots[msg.sender] = root;
    ...
}
```

An attacker can:
1. Compute a Merkle tree containing capabilities they don't actually possess.
2. Set this fake root on-chain.
3. Generate valid ZK proofs for any capability in their fake tree.
4. Counterparties verify the proof — it passes because the root and proof are mathematically consistent.

There is no connection between `capabilityRoots` and `AgentRegistry.capabilities`. An agent could claim "legal-research" capability via ZK proof while having no such capability registered anywhere.

**Impact:** ZK capability verification is meaningless — any agent can prove any capability. Counterparties who rely solely on ZK capability proofs are deceived.
**Cost:** Gas only (~0.001 ETH).
**Recommendation:** Either:
1. Only allow `AgentRegistry` to set capability roots (computed from registered capabilities), OR
2. Require the root to be attested by a trusted third party, OR
3. Add an on-chain verification that the root corresponds to capabilities actually registered in AgentRegistry.

---

### A-008 [MEDIUM]: TrustRegistryV2 Sybil Farming Cost Analysis — Achievable at Scale

**Contract:** TrustRegistryV2.sol
**Attack:**
Counterparty diversity multiplier halves per repeated deal (same counterparty + capability). But with N unique Sybil counterparties, each first deal gives 100% multiplier.

Farm path to MAX_SCORE (1000) from INITIAL_SCORE (100):
- Need 900 points of gain.
- MAX_SINGLE_GAIN = 25 per agreement (at 5× value multiplier, which requires ~2.5 ETH agreement value).
- With large-value agreements (≥ 0.25 ETH for max multiplier): 900/25 = 36 unique Sybil deals needed.
- Total capital needed: 36 × minimumAgreementValue (if set to 0.01 ETH = 0.36 ETH, always recycled back through Sybils).
- If minimumAgreementValue = 0: can farm with 1-wei agreements (free).
- Net cost: gas only (funds are recycled between Sybils via ServiceAgreement escrow).

Timeline: 36 transactions, achievable in ~10 minutes on a fast chain.

**Impact:** A Sybil can reach MAX_SCORE (1000) trust for ~0.5 ETH total cost (gas + recycled capital). Once at max trust, their WARN signals in ReputationOracle carry 10× the weight of a new agent's.
**Cost:** ~0.5 ETH (mostly gas; capital is recycled).
**Recommendation:**
1. Set minimumAgreementValue high enough to make farming expensive (e.g., 0.1 ETH minimum).
2. Add a cooldown between trust-gaining events (e.g., 1 hour per agent per capability).
3. Consider requiring a stake that's slashable on Sybil detection.
4. Add velocity limits to trust gain: max N points per day per wallet.

---

### A-009 [MEDIUM]: ServiceAgreement receive() Traps ETH Forever

**Contract:** ServiceAgreement.sol
**Attack:**
```solidity
receive() external payable {}
```
The contract accepts bare ETH transfers with no tracking or recovery mechanism. Any ETH sent outside of `propose()` is permanently locked.

**Impact:** Accidental ETH transfers are unrecoverable. A clumsy agent or misrouted transaction permanently loses funds.
**Cost:** The amount of ETH accidentally sent.
**Recommendation:** Either remove `receive()` (revert on bare ETH sends) or add an owner-callable `rescueETH()` function that withdraws non-escrowed ETH. If keeping receive(), track total escrowed ETH and allow withdrawal of the delta.

---

### A-010 [MEDIUM]: SettlementCoordinator ProposalId Collision — DOS via Front-Running

**Contract:** SettlementCoordinator.sol
**Attack:**
```solidity
proposalId = keccak256(abi.encodePacked(fromWallet, toWallet, amount, token, intentId, block.timestamp));
```
The proposalId is deterministic based on public parameters plus `block.timestamp`. An attacker who observes a pending `propose()` transaction can front-run it with a transaction in the same block, producing the same `proposalId`. The legitimate call then reverts with "proposal exists."

Note: the attacker needs `msg.sender == fromWallet`, so they can't directly front-run a proposal from a wallet they don't control. However, if the attacker controls `fromWallet` (i.e., they're a legitimate sender), they can grief the system by repeatedly creating proposals with the same parameters in the same block.

More importantly: two legitimate proposals with identical parameters in the same block will collide.

**Impact:** Potential DOS for high-frequency settlement. Low practical impact since attacker must control fromWallet.
**Cost:** Gas only.
**Recommendation:** Add a nonce or use `_nextId++` pattern similar to ServiceAgreement. Include `msg.sender` explicitly (already included as `fromWallet`), but add a contract-level nonce to prevent same-block collisions.

---

### A-011 [MEDIUM]: PolicyEngine — No Blocklist Enforcement in ServiceAgreement

**Contract:** PolicyEngine.sol, ServiceAgreement.sol
**Attack:**
PolicyEngine has a blocklist (`addToBlocklist`) and shortlist (`addPreferred`) per wallet. However, **ServiceAgreement.propose() never checks the blocklist or shortlist.** A client can propose an agreement with a blocked provider, and the provider can accept it. The PolicyEngine blocklist is advisory-only with no enforcement.

Similarly, `ARC402Wallet.executeSpend()` calls `_policyEngine().validateSpend()` which only checks category limits — it never checks blocklist/shortlist.

**Impact:** Blocklist and shortlist features are security theater. A wallet owner can block a provider in PolicyEngine, but their agent can still propose agreements with that provider through ServiceAgreement.
**Cost:** Zero (the feature simply doesn't work).
**Recommendation:** Add blocklist/shortlist checks to ServiceAgreement.propose() and/or to the ARC402Wallet spend execution paths. Example: `require(!policyEngine.isBlocked(msg.sender, provider), "provider blocked")`.

---

### A-012 [MEDIUM]: SponsorshipAttestation — No Agent Consent Required

**Contract:** SponsorshipAttestation.sol
**Attack:**
Any address can call `publish(agentAddress, expiresAt)` to attest sponsorship of any agent without the agent's consent. A malicious actor can:
1. Create a fake "agency" wallet.
2. Publish sponsorship attestations for high-trust agents.
3. Use this to suggest affiliation with reputable agents ("Agency X sponsors Agent Y").
4. The agent has no way to reject or dispute the attestation.

While the contract comment acknowledges this as a design decision ("sponsor-issued, not agent-accepted"), it creates a real impersonation vector.

**Impact:** False affiliation claims. An attacker can create the appearance that reputable agents are part of their agency, boosting their perceived legitimacy. Trust-weighted decisions based on agency affiliation are manipulable.
**Cost:** Gas only (~0.001 ETH per attestation).
**Recommendation:** Add bilateral attestation: require agent co-signature before an attestation becomes active. Or add an agent-callable `rejectAttestation(bytes32 attestationId)` function that marks the attestation as rejected and prevents it from appearing in active queries.

---

### A-013 [MEDIUM]: TrustRegistryV2 Time Decay Cliff Effect

**Contract:** TrustRegistryV2.sol
**Attack:**
Time decay uses integer halvings:
```solidity
uint256 halvings = elapsed / HALF_LIFE;
above = above >> halvings;
```
This creates a step function:
- Day 0-179: score = full (no decay)
- Day 180: score suddenly drops 50%
- Day 360: score drops to 25%

An agent with score 800 active 179 days ago has effective score 800. One day later (day 180), it drops to 450. This cliff can be gamed:
1. Agent performs one minimal interaction at day 179 to reset `lastUpdated`.
2. This costs only gas (even a failed trust update resets `lastUpdated` in some paths).
3. The agent maintains full score indefinitely with periodic pings.

**Impact:** Trust decay is gameable with periodic activity pings. The decay provides no smooth degradation for semi-active agents.
**Cost:** Gas per 179-day ping (~0.001 ETH every 6 months).
**Recommendation:** Implement linear or exponential interpolation within half-life periods. For example: `decayFactor = (elapsed % HALF_LIFE) / HALF_LIFE` applied as proportional reduction within each period.

---

### A-014 [MEDIUM]: ARC402Wallet Velocity Window Boundary — Double-Spend Window

**Contract:** ARC402Wallet.sol
**Attack:**
The velocity window resets when `block.timestamp > spendingWindowStart + SPEND_WINDOW`:
```solidity
if (block.timestamp > spendingWindowStart + SPEND_WINDOW) {
    spendingWindowStart = block.timestamp;
    ethSpendingInWindow = 0;
    tokenSpendingInWindow = 0;
}
```
An agent can:
1. Spend up to `velocityLimit` at the end of window N (e.g., timestamp T + SPEND_WINDOW - 1).
2. Wait 2 seconds until window N+1 starts.
3. Spend another `velocityLimit` at the start of window N+1.
4. Total: 2× velocityLimit within seconds.

**Impact:** The velocity limit can be doubled by timing transactions at window boundaries.
**Cost:** Requires precise timing (achievable programmatically by agents).
**Recommendation:** Use a sliding window (e.g., track spend amounts with timestamps and sum the last 24 hours) instead of a fixed-reset window. Alternatively, document this as accepted behavior and set velocityLimit to half the intended maximum.

---

### A-015 [MEDIUM]: ServiceAgreement — Provider Can Self-Fulfill Without Delivery (Immediate Path)

**Contract:** ServiceAgreement.sol
**Attack:**
In the `fulfill()` immediate-release path:
1. Client proposes and locks escrow.
2. Provider accepts.
3. Provider immediately calls `fulfill(agreementId, arbitraryHash)` and receives escrow.
4. No verification that any work was delivered. No client approval needed.

The commit-reveal path (`commitDeliverable` → `verifyDeliverable`) exists for verified delivery, but the immediate path allows the provider to claim escrow without any delivery proof.

**Impact:** A malicious provider can accept agreements and immediately claim escrow without delivering anything. The client's recourse is to dispute, but by then the escrow is already released.
**Cost:** Zero (just gas).
**Recommendation:** This is partially by design (the immediate path trusts the provider), but document clearly that clients should use the commit-reveal path for high-value agreements. Consider adding a minimum verification window for agreements above a value threshold, or allowing clients to mark agreements as "require commit-reveal" at proposal time.

---

### A-016 [MEDIUM]: ReputationOracle Signals Are Immutable — No Correction Mechanism

**Contract:** ReputationOracle.sol
**Attack:**
Once a signal (ENDORSE, WARN, BLOCK) is published, it can never be updated, retracted, or corrected:
- `hasSignaled[publisher][subject] = true` — permanent, no reset path.
- Signals array is append-only, no deletion.

If a publisher WARNS a subject by mistake, or if new information emerges, there's no way to retract. The publisher can't update their signal. Auto-WARN from disputes is also permanent even if the dispute is later found to be wrongful.

**Impact:** False signals permanently damage reputations. No self-correction mechanism exists. A wrongful auto-WARN from a high-trust client permanently weighs against the provider.
**Cost:** N/A — design flaw.
**Recommendation:** Add `updateSignal(address subject, SignalType newType, string reason)` that allows a publisher to change their signal. Keep the old signal in history but only count the latest signal per publisher-subject pair in reputation calculations.

---

### A-017 [LOW]: AgentRegistry — Unbounded Agent List Growth

**Contract:** AgentRegistry.sol
**Attack:**
`_agentList` grows unboundedly. Deactivated agents are never removed. With sufficient registrations:
1. `agentCount()` returns an ever-growing number.
2. Off-chain enumeration via `getAgentAtIndex()` becomes increasingly expensive.
3. Storage costs for `_agentList` accumulate permanently.

A griefer can register thousands of throwaway agents to bloat the list.

**Impact:** DOS on agent enumeration. Increased gas costs for any on-chain iteration.
**Cost:** Gas per registration (~0.01 ETH × N agents).
**Recommendation:** Add a registration fee or require minimum trust score. Allow cleanup of deactivated agents from the list (swap-and-pop pattern).

---

### A-018 [LOW]: PolicyEngine — setCategoryLimit Can Be Called by Unregistered Wallets

**Contract:** PolicyEngine.sol
**Attack:**
`setPolicy()` and `setCategoryLimit()` use `msg.sender` directly as the wallet key, but don't check if the wallet is registered via `registerWallet()`. An unregistered address can set policies and category limits that are never enforced because no wallet references them.

This is not directly exploitable but creates ghost data in storage.

**Impact:** Minimal — wasted gas and storage. No security impact.
**Cost:** Gas only.
**Recommendation:** Add `require(walletOwners[msg.sender] != address(0), "not registered")` check to `setPolicy()` and `setCategoryLimit()`.

---

### A-019 [LOW]: SettlementCoordinator execute() — Reentrancy on ETH Settlement

**Contract:** SettlementCoordinator.sol
**Attack:**
In `execute()` for ETH settlements:
```solidity
p.status = ProposalStatus.EXECUTED;
// ...
(bool success,) = p.toWallet.call{value: p.amount}("");
```
Status is set to EXECUTED before the ETH transfer (CEI pattern followed). However, the `execute()` function has no `nonReentrant` guard. If `p.toWallet` is a malicious contract, it could re-enter `execute()` with a DIFFERENT proposalId during the ETH transfer callback.

Cross-proposal reentrancy: wallet A sends to malicious wallet B. B's receive() calls `execute(otherProposalId)` where B is the sender. This would work if B has a different accepted proposal. The status check prevents re-executing the same proposal, but a different proposal could be executed reentrantly.

**Impact:** Low — each proposal can only execute once, and the reentrant call would need its own accepted proposal with correct msg.value. Practical exploitation is limited.
**Cost:** Complex setup, limited gain.
**Recommendation:** Add OpenZeppelin's `ReentrancyGuard` to `execute()` as defense-in-depth.

---

### A-020 [LOW]: ARC402Wallet — Split Velocity Counters Allow 2× Total Exposure

**Contract:** ARC402Wallet.sol
**Attack:**
ETH and ERC-20 spending have independent velocity counters:
- `ethSpendingInWindow` tracks ETH spends.
- `tokenSpendingInWindow` tracks token spends.

Both are independently compared against `velocityLimit`. If velocityLimit = 1 ETH, an agent can spend 1 ETH in native ETH AND 1e6 USDC (or any token amount up to velocityLimit in token units) within the same window.

The total value exposure is at least 2× the intended limit when both asset types are active.

**Impact:** The velocity limit doesn't cap total value at risk — only per-asset-type spending. A compromised wallet can extract value through both channels simultaneously.
**Cost:** N/A — design limitation.
**Recommendation:** Either:
1. Use an oracle to normalize token amounts to ETH-equivalent and track a single aggregate counter, OR
2. Document this as accepted behavior and set velocityLimit to half the intended maximum per asset type, OR
3. Add separate configurable limits per asset type via `setEthVelocityLimit()` and `setTokenVelocityLimit()`.

---

### A-021 [LOW]: TrustRegistryV2 — Authorized Updater Can Grief Any Wallet

**Contract:** TrustRegistryV2.sol
**Attack:**
Any authorized updater (set by owner) can call `recordAnomaly()` against any wallet, deducting 50 points per call. A compromised or malicious updater can rapidly drain any wallet's trust to 0.

The owner can add/remove updaters, but there's no per-updater rate limit or scope restriction. A single compromised updater key compromises the entire trust system.

**Impact:** A compromised updater can destroy trust scores for all wallets in the registry.
**Cost:** Gas per recordAnomaly call.
**Recommendation:** Add per-updater rate limits or scope restrictions (e.g., an updater can only update wallets for specific capabilities or service types). Consider requiring multi-sig for anomaly recording above a certain penalty threshold.

---

## Cross-Contract Attack Chains

### Chain 1: Sybil Trust Farm → Reputation Assassination → Market Manipulation
1. Farm 10 Sybil wallets to MAX_SCORE via TrustRegistryV2 (cost: ~5 ETH, see A-008).
2. Each Sybil publishes WARN against target via ReputationOracle (cost: gas only, see A-004).
3. Target's weighted reputation drops by 10 × 1000 = 10,000 weighted negative.
4. Target becomes unhireable. Attacker's agents capture target's market share.
**Total cost: ~5 ETH. Impact: catastrophic for target.**

### Chain 2: Instant Dispute Drain + Trust Assassination
1. Client proposes high-value agreement (locks 100 ETH).
2. Provider accepts and starts work.
3. Client disputes → immediately calls expiredDisputeRefund (A-001).
4. Client gets 100 ETH back + provider gets anomaly on trust + auto-WARN on ReputationOracle.
5. Provider lost work, lost trust, gained negative reputation.
**Total cost: gas only. Impact: 100 ETH theft + reputation destruction.**

---

## Verdict

**FAIL**

Justification:
1. **A-001 (CRITICAL)** enables immediate escrow theft from any disputed agreement. This is an active fund-loss vulnerability exploitable at zero cost.
2. **A-002 (CRITICAL)** renders the entire trust system non-functional in V2 deployments. The core value proposition of ARC-402 (trust-scored agent marketplace) is broken.
3. The combination of trust farming (A-008) + reputation griefing (A-004) + ZK proof replay (A-003) creates systemic attack chains that undermine marketplace integrity.

**Minimum required fixes before any deployment:**
- A-001: Add `ag.resolvedAt = block.timestamp` in `dispute()`.
- A-002: Update ServiceAgreement to use ITrustRegistryV2 interface for V2 deployments.
- A-003: Bind ZK proofs to agent address (circuit redesign).
- A-004: Add minimum trust threshold for manual signal publication.
- A-006: Revert instead of silently returning on velocity limit breach.
