# Auditor B (Architect) — Delta Audit Report 2026-03-11

**Protocol:** ARC-402 (Agent Resource Control)  
**Auditor Role:** Auditor B — Defensive Architect  
**Mandate:** Architectural soundness, economic design correctness, invariant violations, systemic risks at scale  
**Scope:** Delta review — NEW contracts and v2 changes since prior audit  
**Date:** 2026-03-11  
**Status:** DRAFT — independent cold review  

---

## Summary

ARC-402 v2 introduces significant architectural surface area: a richer trust model (TrustRegistryV2), commit-reveal service delivery (ServiceAgreement v2), a policy enforcement layer with blocklisting (PolicyEngine), social reputation signals (ReputationOracle), agency-agent attestations (SponsorshipAttestation), and ZK proof gates. These components each work in reasonable isolation. The architectural failure is at the **seams**: critical new features are not wired together, enforcement of new policies doesn't reach the spending path, and at least one state machine has a broken clock that makes its primary safety property trivially bypassable.

**Four systemic failures require remediation before any production deployment:**

1. **The dispute timeout clock is broken.** `dispute()` never sets `resolvedAt`. `expiredDisputeRefund()` is immediately callable on any disputed agreement. The 30-day arbiter window is a fiction.

2. **TrustRegistryV2 is an island.** ServiceAgreement calls the v1 `ITrustRegistry` interface. TrustRegistryV2's entire capability-specific, value-weighted, counterparty-diverse trust model is never populated by actual agreement activity.

3. **ZK proofs are not identity-bound.** ZKTrustGate and ZKSolvencyGate proofs can be stolen and replayed by any address. The prover's identity is not a public signal in either circuit.

4. **The blocklist cannot enforce.** PolicyEngine's blocklist feature is never consulted in the spending path — `validateSpend()` lacks a `recipient` parameter. The blocklist is advisory data with no teeth.

These are not edge cases. They are structural gaps that will be exploited in a live system with autonomous agents.

---

## Findings

---

### B-001 [CRITICAL]: Dispute Timeout Clock Never Starts — Immediate Bypass of 30-Day Arbiter Window

**Contracts:** `ServiceAgreement.sol`  
**Functions:** `dispute()`, `expiredDisputeRefund()`

**Issue:**  
`dispute()` transitions status to `DISPUTED` but does NOT set `ag.resolvedAt`. The NatSpec comment on `expiredDisputeRefund()` states: _"The dispute() function sets resolvedAt = block.timestamp when the dispute is opened"_ — this is false. The code does not do this.

```solidity
// dispute() — the bug:
ag.status = Status.DISPUTED;
emit AgreementDisputed(agreementId, msg.sender, reason);
// resolvedAt is NEVER SET HERE

// expiredDisputeRefund() — assumes resolvedAt was set:
require(
    block.timestamp > ag.resolvedAt + DISPUTE_TIMEOUT,
    "ServiceAgreement: dispute timeout not reached"
);
```

When `dispute()` is called on a PROPOSED or ACCEPTED agreement, `resolvedAt` remains 0 (default). The check becomes `block.timestamp > 0 + 30 days = 2,592,000`. In 2026, `block.timestamp ≈ 1.75 × 10⁹` — always greater than 2,592,000. The timeout check passes immediately.

**Attack path:**
1. Client proposes agreement, provider accepts (escrow locked)
2. Client calls `dispute()` (any reason)
3. Client immediately calls `expiredDisputeRefund()`
4. Escrow refunded to client — no 30-day wait, no arbiter needed

The provider loses both the escrow and any trust implications, with zero recourse. Any ACCEPTED agreement can be nullified by the client in a single block.

**Invariant Violated:**  
`∀ agreement in DISPUTED: expiredDisputeRefund() callable only after (disputedAt + DISPUTE_TIMEOUT)`  
Currently: `expiredDisputeRefund()` callable at any time after `dispute()`.

**Impact at Scale:**  
With 1,000 agents, any client-provider pair becomes adversarial. Providers will stop accepting agreements entirely once this is discovered on-chain. The service marketplace collapses — a single well-publicized exploit drains provider confidence system-wide. At 10,000 agents, this becomes a coordinated griefing vector: bots proposing agreements to specific providers, disputing immediately, and draining their operational funds.

**Recommendation:**  
Add `ag.resolvedAt = block.timestamp;` to `dispute()`. This is a one-line fix but must be validated against all other uses of `resolvedAt` in the state machine.

```solidity
function dispute(uint256 agreementId, string calldata reason) external {
    // ... validation ...
    ag.status = Status.DISPUTED;
    ag.resolvedAt = block.timestamp;  // ← ADD THIS
    emit AgreementDisputed(agreementId, msg.sender, reason);
}
```

---

### B-002 [CRITICAL]: TrustRegistryV2 Is Never Populated — v1/v2 Interface Mismatch

**Contracts:** `ServiceAgreement.sol`, `TrustRegistryV2.sol`, `ITrustRegistry.sol`, `ITrustRegistryV2.sol`

**Issue:**  
`ServiceAgreement._updateTrust()` calls `ITrustRegistry(trustRegistry).recordSuccess(ag.provider)` — the v1 interface signature (single `address` argument). `TrustRegistryV2` implements the v2 interface: `recordSuccess(address wallet, address counterparty, string calldata capability, uint256 agreementValueWei)`.

These interfaces are incompatible. If `ServiceAgreement.trustRegistry` points to TrustRegistryV2, every call to `recordSuccess()` or `recordAnomaly()` will revert with a function selector mismatch, silently caught by the `try/catch`, and `TrustUpdateFailed` will be emitted. TrustRegistryV2 will never accumulate any data.

The entire v2 trust model — capability-specific scoring, counterparty diversity, value-weighted gains, time decay, ANOMALY_PENALTY of 50 instead of 20 — is architecturally inert. The system continues on v1 semantics (flat +5/−20) regardless of which registry is deployed.

**Invariant Violated:**  
`∀ fulfilled agreement: trustRegistry.recordSuccess(provider, client, serviceType, price) called with v2 semantics`  
Currently: v1 single-argument call is made; v2 registry discards it.

**Impact at Scale:**  
TrustRegistryV2 adds significant sophistication: Sybil resistance via diversity decay, capability-specific reputation, value-weighted gains. None of this activates. The system operates on v1 flat scoring forever, regardless of which registry contract is active. At 10,000 agents, the trust signal becomes meaninglessly flat — every agent who completes enough minimum-value agreements converges to MAX_SCORE=1000 without any capability discrimination.

**Recommendation:**  
ServiceAgreement must be upgraded to call the v2 interface:

```solidity
// Replace ITrustRegistry with ITrustRegistryV2 in ServiceAgreement
ITrustRegistryV2(trustRegistry).recordSuccess(
    ag.provider,
    ag.client,
    ag.serviceType,
    ag.price
);

ITrustRegistryV2(trustRegistry).recordAnomaly(
    ag.provider,
    ag.client,
    ag.serviceType,
    ag.price
);
```

The `trustRegistry` address type in ServiceAgreement must be updated to `ITrustRegistryV2`. Deploy a fresh ServiceAgreement targeting TrustRegistryV2 and register it as an authorized updater.

---

### B-003 [CRITICAL]: ZK Proofs Are Not Address-Bound — Identity Theft Attack

**Contracts:** `ZKTrustGate.sol`, `ZKSolvencyGate.sol`  
**Functions:** `verifyZK()`, `verifySolvency()`

**Issue:**  
The ZKTrustGate circuit has one public signal: `threshold`. The ZKSolvencyGate circuit has one public signal: `requiredAmount`. Neither circuit binds the proof to the prover's address.

```solidity
// ZKTrustGate.verifyZK()
uint[1] memory pubSignals;
pubSignals[0] = threshold;  // ← ONLY threshold is public input
bool valid = verifier.verifyProof(pA, pB, pC, pubSignals);
if (valid) {
    emit TrustProofVerified(msg.sender, threshold, true);  // logs msg.sender but doesn't verify it
}
```

A valid proof proves: _"I know a witness such that score ≥ threshold."_ It does NOT prove: _"msg.sender's score ≥ threshold."_

**Attack path:**
1. Agent A (trust score 900) generates a valid ZK proof for threshold=800
2. Agent B (trust score 100) intercepts or purchases this proof (proofs are public EVM calldata)
3. Agent B calls `ZKTrustGate.verifyZK()` with Agent A's proof, receives `true`
4. Agent B is now indistinguishable from a trust-900 agent to any on-chain consumer of this gate

The proof is valid for any threshold ≤ 900 regardless of who calls `verifyZK()`. Proofs are replayable indefinitely (no nullifier), against any threshold (caller selects threshold), by any address (no identity commitment).

**Contrast with ZKCapabilityGate (correct):**  
`ZKCapabilityGate.verifyCapability()` includes `capabilityRoots[msg.sender]` in the public signals — the root is registered on-chain by the agent, tying the proof to `msg.sender`. This is the correct pattern. ZKTrustGate and ZKSolvencyGate lack this binding.

**Invariant Violated:**  
`∀ ZK verification: proof validates identity(msg.sender) ∧ claim`  
Currently: proof validates only the claim; identity is asserted but not proven.

**Impact at Scale:**  
ZK gates are designed to preserve privacy at scale. At 1,000 agents, one valid high-trust proof could be resold to thousands of low-trust agents. The trust gating mechanism becomes a market for proof resale rather than a signal of genuine reputation.

**Recommendation:**  
Include the prover's address (or a wallet commitment derived from it) as a public signal in the circuit. For TrustTrustGate, the circuit public signals should be `[threshold, keccak256(prover_address)]` or similar. The on-chain verifier should pass `uint256(uint160(msg.sender))` as the identity public signal and the circuit should verify commitment to this identity.

---

### B-004 [CRITICAL]: PolicyEngine Blocklist Cannot Enforce — Missing Recipient in Validation Path

**Contracts:** `PolicyEngine.sol`, `ARC402Wallet.sol`  
**Functions:** `validateSpend()`, `executeSpend()`, `executeTokenSpend()`

**Issue:**  
`PolicyEngine.validateSpend()` signature:

```solidity
function validateSpend(
    address wallet,
    string calldata category,
    uint256 amount,
    bytes32 /*contextId*/
) external view returns (bool valid, string memory reason)
```

The recipient address is not a parameter. The blocklist (`_blocklist[wallet][provider]`) and shortlist (`_shortlist[wallet][cap][...]`) cannot be consulted. `validateSpend()` only checks category limits.

`ARC402Wallet.executeSpend()` calls `_policyEngine().validateSpend(address(this), category, amount, activeContextId)` — the recipient is known at the call site but never passed to the policy engine.

An agent can:
1. Call `PolicyEngine.addToBlocklist(walletAddr, providerAddr)` — blocklist set
2. Call `ARC402Wallet.executeSpend(blockedProvider, amount, category, attestId)` — spend succeeds
3. Funds flow to the blocklisted provider — the blocklist did nothing

**Invariant Violated:**  
`∀ spend execution: !policyEngine.isBlocked(wallet, recipient)`  
Currently: blocklist state exists but is never read during spend execution.

**Impact at Scale:**  
Blocklisting is the primary defense against known-bad actors at the agent level. If an agent is blacklisted for fraud but the wallet still pays them, the protection is theater. At 10,000 agents, adversarial providers evicted from shortlists and placed in blocklists continue to collect payments regardless. The enforcement gap makes the entire reputation-based filtering architecture advisory-only.

**Recommendation:**  
Add `recipient` to the `validateSpend()` interface and enforce it:

```solidity
// IPolicyEngine.sol
function validateSpend(
    address wallet,
    string calldata category,
    uint256 amount,
    bytes32 contextId,
    address recipient  // ← ADD
) external view returns (bool valid, string memory reason);

// PolicyEngine.sol implementation
if (_blocklist[wallet][recipient]) {
    return (false, "PolicyEngine: recipient is blocklisted");
}
```

Update `ARC402Wallet` to pass the recipient at both call sites. Update `IServiceAgreement` if it consults the policy engine.

---

### B-005 [HIGH]: Time Decay Fully Resets on Any Activity — Dormant Wallets Can Instantly Restore Score

**Contracts:** `TrustRegistryV2.sol`  
**Functions:** `recordSuccess()`, `_ensureInitialized()`, `getEffectiveScore()`

**Issue:**  
The 6-month half-life time decay is designed to prevent long-dormant agents from retaining high effective trust. The mechanism: `getEffectiveScore()` applies `above >> halvings` to decay the stored score. But `recordSuccess()` updates `p.lastUpdated = block.timestamp` regardless of gain size.

A wallet dormant for 3 years with stored score 900 has effective score ≈ 100+((900-100)>>6) = 100+12 ≈ 112. If it then records success for a minimum-value deal:
- `minimumAgreementValue` check passes (deal is at or above threshold)
- `gain` may be as low as 1 (due to diversity multiplier saturation)
- `p.globalScore` becomes 901, `p.lastUpdated = block.timestamp`
- **Effective score immediately: 901** (no halvings since just updated)

The 3-year decay is completely undone by a single micro-deal. This is not an edge case — it's the expected behavior given the current architecture.

**Invariant Violated:**  
`effective_score(wallet) should reflect recent activity, not historical maximum`  
Currently: any qualifying activity teleports `lastUpdated` to now, instantly restoring the full stored score.

**Impact at Scale:**  
A dormant wallet marketplace emerges. Wallets with high historical scores are traded as "pre-loaded" assets. Buyers activate them with a single minimum-value deal to restore their effective score. At 10,000 agents, the trust score stops being a measure of current reliability and becomes a snapshot of historical peak performance.

**Recommendation:**  
On trust updates, apply the current decay BEFORE adding the gain. Compute the effective score and use that as the base:

```solidity
function _applyDecayedUpdate(TrustProfile storage p, uint256 gain) internal {
    // Re-anchor: compute current effective score and use as new base
    uint256 elapsed = block.timestamp - p.lastUpdated;
    uint256 above = p.globalScore > DECAY_FLOOR ? p.globalScore - DECAY_FLOOR : 0;
    uint256 halvings = elapsed / HALF_LIFE;
    uint256 decayedBase = halvings >= 10 ? DECAY_FLOOR : DECAY_FLOOR + (above >> halvings);
    
    // Apply gain to the decayed base, not the stored historical max
    p.globalScore = decayedBase + gain > MAX_SCORE ? MAX_SCORE : decayedBase + gain;
    p.lastUpdated = block.timestamp;
}
```

This means honest long-active agents aren't penalized (their lastUpdated is recent), but dormant-then-reactivated wallets are re-anchored to their actual current standing.

---

### B-006 [HIGH]: ReputationOracle Signals Are Permanent — No Signal Update or Retraction

**Contracts:** `ReputationOracle.sol`  
**Functions:** `publishSignal()`, `autoWarn()`

**Issue:**  
`hasSignaled[publisher][subject]` is set `true` on first signal and can never be cleared. A publisher cannot:
- Upgrade their WARN to a BLOCK as a subject's behavior worsens
- Retract an ENDORSE when a previously trusted agent turns adversarial
- Re-signal after relationships evolve over time

The signal carries `publisherTrustAtTime` — a snapshot of trust at publication time. If a trust-900 publisher endorses a subject, that endorsement forever carries 900-weight even if the publisher later drops to trust-50 (meaning their endorsement no longer reflects reliable judgment).

**Invariant Violated:**  
`signal(publisher, subject) should reflect current relationship state, not historical opinion`  
Currently: signals are immutable inscriptions with historical trust weights.

**Impact at Scale:**  
At 1,000 agents, the signal graph ossifies within months of launch. Early high-trust endorsers create a permanent "founding tier" of favored agents that cannot be displaced by new information. At 10,000 agents, the reputation layer stops reflecting real-world trust and becomes an artifact of initial network conditions. Adversarial agents who earned early endorsements are effectively immune to signal-based filtering.

**Recommendation:**  
Allow publishers to update their signal for a given subject (overwrite, not append):

```solidity
mapping(address => mapping(address => uint256)) public signalIndex; // publisher → subject → signal array index + 1

function updateSignal(address subject, SignalType newType, bytes32 capabilityHash, string calldata reason) external {
    require(hasSignaled[msg.sender][subject], "ReputationOracle: no existing signal to update");
    uint256 idx = signalIndex[msg.sender][subject] - 1;
    Signal storage s = _signals[subject][idx];
    s.signalType = newType;
    s.capabilityHash = capabilityHash;
    s.reason = reason;
    s.publisherTrustAtTime = _getTrust(msg.sender); // refresh weight at update time
    s.timestamp = block.timestamp;
    emit SignalUpdated(msg.sender, subject, newType, capabilityHash);
}
```

---

### B-007 [HIGH]: ARC402Wallet Velocity Limit Applies Single Threshold to Incommensurable Units

**Contracts:** `ARC402Wallet.sol`  
**State:** `velocityLimit`, `ethSpendingInWindow`, `tokenSpendingInWindow`

**Issue:**  
`velocityLimit` is a single `uint256` checked against both `ethSpendingInWindow` (in wei, 10⁻¹⁸ ETH) and `tokenSpendingInWindow` (in token-native units, e.g., USDC at 10⁻⁶).

```solidity
ethSpendingInWindow += amount;
if (velocityLimit > 0 && ethSpendingInWindow > velocityLimit) { ... }

// — same velocityLimit —

tokenSpendingInWindow += amount;
if (velocityLimit > 0 && tokenSpendingInWindow > velocityLimit) { ... }
```

If an operator sets `velocityLimit = 1_000_000` (1 USDC-equivalent at 6 decimals), the ETH path triggers at 1,000,000 wei = 0.000001 ETH (meaninglessly restrictive). If they set it for ETH (e.g., 1 ETH = 10¹⁸ wei), the token path triggers at 10¹⁸ USDC (effectively unlimited). There is no setting that makes sense for both paths simultaneously.

**Invariant Violated:**  
`velocityLimit should enforce a meaningful maximum spend rate per currency`  
Currently: `velocityLimit` is meaningless for at least one of the two token paths at any given setting.

**Impact at Scale:**  
At 1,000 wallets with mixed ETH/ERC-20 usage, operators either over-restrict ETH transactions or leave token spending velocity uncapped. The circuit breaker designed to limit runaway autonomous spending is miscalibrated by design. A compromised or malfunctioning agent can drain its ERC-20 holdings at unlimited speed if the velocity limit is set for ETH.

**Recommendation:**  
Separate limits by currency:

```solidity
uint256 public ethVelocityLimit;    // in wei
uint256 public tokenVelocityLimit;  // in token-native units (set per-token or for all tokens)
```

Or, normalize both to a common unit (e.g., USD-equivalent) using oracle pricing — though oracle dependency introduces its own risks. Simplest safe fix: separate limits with separate setters.

---

### B-008 [HIGH]: SponsorshipAttestation Is Unilateral — Agents Cannot Opt Out

**Contracts:** `SponsorshipAttestation.sol`  
**Functions:** `publish()`, `revoke()`

**Issue:**  
Any address can attest any other address as their "agent" without the subject's consent. The subject has no mechanism to:
- Reject or dispute an attestation they didn't agree to
- Remove an attestation from their `_agentAttestations` history (even revoked ones remain in the array)
- Signal non-consent on-chain

The design acknowledges this is intentional ("sponsor-issued, not agent-accepted") but does not provide a defensive mechanism for agents.

**Attack scenarios:**
1. A disgraced agency attests a reputable independent agent to borrow their reputation signal
2. A competitor attests a target agent as their "employee" to harm the target's perceived independence
3. A defunct agency's active attestations continue to associate its brand with agents who have moved on
4. Historical attestation arrays grow unboundedly (attestation spam with no on-chain cleanup path)

**Invariant Violated:**  
`∀ active attestation: agent.hasConsented = true`  
Currently: agent consent is never required or recorded.

**Impact at Scale:**  
With 10,000 agents, attestation spam becomes a cheap (gas-only) reputational attack. At $0.01/attestation, an attacker can associate 10,000 agents with a tainted agency for $100. Agent attestation arrays become polluted with adversarial entries. Discovery queries that count attestations (`getAgentAttestations()`) return noise.

**Recommendation:**  
Implement a bilateral consent model for new attestations:

```solidity
// Step 1: sponsor proposes
function propose(address agent, uint256 expiresAt) external returns (bytes32 proposalId);

// Step 2: agent accepts (or ignores/expires)
function accept(bytes32 proposalId) external;

// Agent can also reject active attestations
function rejectAttestation(bytes32 attestationId) external {
    require(attestations[attestationId].agent == msg.sender, "not your attestation");
    attestations[attestationId].revoked = true; // agent-initiated revocation
    activeAttestation[attestations[attestationId].sponsor][msg.sender] = bytes32(0);
}
```

---

### B-009 [MEDIUM]: ReputationOracle.successStreak Is Per-Provider Only — Auto-Endorse Misfires Across Capabilities

**Contracts:** `ReputationOracle.sol`  
**Functions:** `autoRecordSuccess()`, `autoWarn()`

**Issue:**  
`successStreak[provider]` is a single counter with no capability or client breakdown. Five successful deliveries across five different capabilities increment the same counter. When the streak reaches `ENDORSE_STREAK_THRESHOLD = 5`, the auto-ENDORSE is published with the capabilityHash of the **fifth deal only**.

```solidity
// provider does: legal-research(+1), data-analysis(+1), translation(+1),
//                code-review(+1), legal-research(+1) → streak = 5
// Auto-ENDORSE published: capabilityHash = legal-research (last deal)
// But the endorsement was earned across 5 different capabilities
```

The endorsement claims "consecutive successful deliveries (auto-endorsed)" but the capability hash is arbitrary — whatever the 5th deal happened to be. This creates a false capability-specific reputation signal.

Further: `autoWarn()` resets `successStreak[provider] = 0` regardless of capability. A WARN on a provider's "data-analysis" work resets their "legal-research" streak. This cross-capability contamination is architecturally incorrect.

**Invariant Violated:**  
`auto-endorse(provider, capabilityHash) should reflect N consecutive successes IN capabilityHash`  
Currently: reflects N successes across all capabilities; capabilityHash is the accident of the 5th deal.

**Impact at Scale:**  
At 1,000 providers each offering 5 capabilities, auto-endorsements will systematically mislabel capability competence. Agents making discovery decisions based on `getCapabilityReputation()` receive noisy signals. High-volume providers receive capability endorsements for domains they barely operate in.

**Recommendation:**  
Track streaks per `(provider, capabilityHash)`:

```solidity
mapping(address => mapping(bytes32 => uint256)) public successStreak;
// provider → capabilityHash → consecutive successes

// In autoRecordSuccess:
successStreak[provider][capabilityHash] += 1;
if (successStreak[provider][capabilityHash] >= ENDORSE_STREAK_THRESHOLD) {
    // auto-endorse is correctly scoped to this capability
    successStreak[provider][capabilityHash] = 0;
}
```

---

### B-010 [MEDIUM]: AgentRegistry Endpoint Stability Penalty Is Permanent — No Recovery Path

**Contracts:** `AgentRegistry.sol`  
**Functions:** `getEndpointStability()`

**Issue:**  
`endpointChangeCount` is a monotonically increasing counter. The stability scoring formula applies `score /= 2` for each extra change:

```solidity
uint256 extra = info.endpointChangeCount > 1 ? info.endpointChangeCount - 1 : 0;
for (uint256 i = 0; i < extra && score > 5; i++) {
    score = score / 2;
}
if (score < 5) score = 5;
```

An agent who changed endpoints 10 times (even 5 years ago, all fully stable since) has: `extra = 9`, halved 9 times from base 70 → ≈ 70/512 < 1, floored to 5. Permanent score of 5/100 forever.

There is no mechanism for an agent to "earn back" stability through sustained reliable behavior. A legitimate agent who changed endpoints during infrastructure migrations gets permanently penalized at the same rate as a flaky agent.

**Invariant Violated:**  
`endpoint_stability(agent) should reflect CURRENT stability, not lifetime change count`  
Currently: lifetime change count creates an irreversible stability floor.

**Impact at Scale:**  
Infrastructure migrations, cloud provider changes, or protocol upgrades cause legitimate endpoint changes. Older agents with more history are penalized more harshly than newer agents. At 10,000 agents over 3+ years, the stability score diverges from actual stability signal — agents with 2020-era endpoint churn rate are scored lower than agents that registered in 2025.

**Recommendation:**  
Apply time-based decay to `endpointChangeCount` or cap penalty weight by recency:

```solidity
// Count only changes in the last 90 days for the penalty calculation
uint256 recentChanges = _recentEndpointChanges(wallet, 90 days);
uint256 extra = recentChanges > 1 ? recentChanges - 1 : 0;
```

Or implement a "stability recovery" mechanism: if `daysSinceChange >= 365`, cap the extra-change penalty at a maximum of 2 halvings.

---

### B-011 [MEDIUM]: SettlementCoordinator ERC-20 Execute Path Is Non-Functional

**Contracts:** `SettlementCoordinator.sol`, `ARC402Wallet.sol`  
**Functions:** `execute()`, `proposeMASSettlement()`

**Issue:**  
Two compounding problems make ERC-20 multi-agent settlements impossible:

**Problem 1 — Missing execute wrapper in ARC402Wallet:**  
`ARC402Wallet.proposeMASSettlement()` calls `_settlementCoordinator().propose(address(this), ...)`. `SettlementCoordinator.execute()` requires `msg.sender == p.fromWallet`. Since `fromWallet == address(ARC402Wallet)`, only the ARC402Wallet contract can call `execute()`. But there is no `executeMASSettlement()` function on `ARC402Wallet`. Once proposed and accepted, the settlement has no call path for execution.

**Problem 2 — Missing token approval for ERC-20 path:**  
`SettlementCoordinator.execute()` for ERC-20 calls:
```solidity
IERC20(p.token).safeTransferFrom(msg.sender, p.toWallet, p.amount);
// msg.sender == p.fromWallet == ARC402Wallet
```
This requires ARC402Wallet to have pre-approved SettlementCoordinator for the token. ARC402Wallet has no `approve()` or `increaseAllowance()` function. ERC-20 settlements can never execute regardless of Problem 1.

**Invariant Violated:**  
`∀ ACCEPTED settlement proposal: execute() is callable by fromWallet`  
Currently: no mechanism exists for the fromWallet to call execute(), and the ERC-20 path lacks token approval infrastructure.

**Impact at Scale:**  
Multi-agent settlement is a core primitive. At 1,000 agents using USDC as the primary payment token, the MAS feature is completely non-functional. ETH settlements would also be broken by Problem 1 alone. The settlement state machine has ACCEPTED and EXECUTED states with no reachable transition between them for ARC402Wallet participants.

**Recommendation:**  
Add to ARC402Wallet:
```solidity
function executeMASSettlement(bytes32 proposalId) external onlyOwner notFrozen {
    _settlementCoordinator().execute{value: 0}(proposalId);
}
```
For ERC-20 settlements, add token approval management:
```solidity
function approveSettlementCoordinator(address token, uint256 amount) external onlyOwner {
    IERC20(token).approve(address(_settlementCoordinator()), amount);
}
```

---

### B-012 [MEDIUM]: ReputationOracle.serviceAgreement Is Immutable — Upgrade Path Breaks Auto-Signals

**Contracts:** `ReputationOracle.sol`, `ServiceAgreement.sol`

**Issue:**  
`address public immutable serviceAgreement` — only one ServiceAgreement contract can ever auto-publish to a given ReputationOracle. When ServiceAgreement is upgraded (new deployment, as required by B-002 fix), the new SA cannot auto-publish to the existing Oracle (its address doesn't match the immutable `serviceAgreement`). A new Oracle must be deployed for each ServiceAgreement upgrade.

But the new Oracle starts with empty state — all historical WARN and ENDORSE signals are lost. The reputation graph must be rebuilt from scratch for every SA upgrade.

**Invariant Violated:**  
`reputation signals should be persistent across ServiceAgreement upgrades`  
Currently: each ServiceAgreement upgrade requires an Oracle redeployment, resetting all trust signals.

**Impact at Scale:**  
With 10,000 agents and months of accumulated signal history, an Oracle reset is catastrophic. The reputation layer loses all Sybil history. Previously identified bad actors receive a clean slate. The "marketplace immune system" is erased by a routine contract upgrade.

**Recommendation:**  
Make `serviceAgreement` governance-mutable with an authorized caller list, or implement a multi-SA authorization pattern:

```solidity
mapping(address => bool) public authorizedServiceAgreements;

modifier onlyServiceAgreement() {
    require(authorizedServiceAgreements[msg.sender], "not authorized");
    _;
}

function setServiceAgreementAuthorized(address sa, bool authorized) external onlyOwner {
    authorizedServiceAgreements[sa] = authorized;
}
```

---

### B-013 [MEDIUM]: TrustRegistryV2 Lazy Migration Inherits Potentially Stale v1 Scores

**Contracts:** `TrustRegistryV2.sol`  
**Functions:** `_ensureInitialized()`

**Issue:**  
When a wallet first interacts with TrustRegistryV2, `_ensureInitialized()` calls `v1Registry.getScore(wallet)` and uses the raw v1 score as the v2 initial `globalScore`. This migration:

1. **Ignores v1 time context.** A v1 score of 800 earned 3 years ago is treated identically to one earned yesterday. The migrated score carries no `lastUpdated` anchoring to v1 activity — it's set to `block.timestamp` of migration. An inactive v1 agent migrates with a high starting score and a fresh `lastUpdated`, defeating the v2 time decay immediately.

2. **Has no migration cap.** A v1 score of 1000 migrates as 1000 (the MAX_SCORE). There is no discount for "this score was earned under a weaker v1 model."

3. **Is not reversible.** Once migrated, the v1 score is baked in. If the v1 registry is compromised or had inflated scores, those inflations are permanently imported.

**Invariant Violated:**  
`v2.initialScore(wallet) should discount for time elapsed since v1 activity`  
Currently: v1 score migrates at face value with a fresh lastUpdated timestamp.

**Impact at Scale:**  
The v1→v2 migration is the initial state of the entire trust graph. If v1 scores are stale, inflated, or manipulated, TrustRegistryV2 inherits those problems at scale. 1,000 legacy agents with stale high v1 scores instantly populate the v2 trust graph with inflated, unvalidated starting points.

**Recommendation:**  
Apply a migration discount based on v1 age, or migrate with a historical `lastUpdated` derived from v1 activity (if available), or apply a fixed migration cap (e.g., max imported score = 500, requiring agents to earn the remaining 500 through v2 activity).

---

### B-014 [LOW]: ZKCapabilityGate Root Update Silently Invalidates Pending Proofs

**Contracts:** `ZKCapabilityGate.sol`  
**Functions:** `setCapabilityRoot()`, `verifyCapability()`

**Issue:**  
When an agent calls `setCapabilityRoot(newRoot)`, any in-flight or cached proofs generated against the previous root are immediately invalid on-chain (the stored root changes). There is no transition window or versioned root history. An agent updating their capability set causes all counterparties expecting proof against the old root to receive verification failures until they obtain new proofs.

In an automated agent-to-agent negotiation context, this creates a TOCTOU window where an agent updates their root between proof generation (off-chain) and proof verification (on-chain), causing otherwise valid proofs to fail.

**Recommendation:**  
Store the previous root with a timestamp, allowing a brief overlap window where both old and new roots are valid. Or require a timelock on root updates (similar to ARC402Wallet's registry timelock) to give counterparties time to obtain new proofs.

---

### B-015 [LOW]: ARC402Wallet Registry Upgrade Accepts Any Address Without Interface Verification

**Contracts:** `ARC402Wallet.sol`  
**Functions:** `proposeRegistryUpdate()`, `executeRegistryUpdate()`

**Issue:**  
`proposeRegistryUpdate(address newRegistry)` accepts any non-zero address. After the 2-day timelock, `executeRegistryUpdate()` sets `registry = ARC402Registry(pendingRegistry)`. If `pendingRegistry` is an EOA, an unrelated contract, or a malicious contract returning adversarial addresses from `policyEngine()`, `trustRegistry()`, etc., every subsequent wallet operation will interact with attacker-controlled contracts.

The 2-day timelock is the sole protection. There is no on-chain validation that `pendingRegistry` implements `ARC402Registry`'s interface, has correct contract addresses configured, or is non-malicious.

**Recommendation:**  
Add an interface probe during `executeRegistryUpdate()`: verify that `pendingRegistry.policyEngine()`, `.trustRegistry()`, and `.intentAttestation()` return non-zero addresses. This doesn't guarantee correctness but catches accidental misconfiguration. For stronger protection, require a `registrar.isValidRegistry(newRegistry)` check against a known-good factory or allowlist.

---

## Invariants

### Invariants That HOLD

| # | Invariant | Contracts | Status |
|---|-----------|-----------|--------|
| I-01 | Single-use intent attestations cannot be replayed | `IntentAttestation` | ✅ HOLDS — `used[id]` enforced |
| I-02 | Trust scores bounded [0, 1000] | `TrustRegistry`, `TrustRegistryV2` | ✅ HOLDS — capped in all paths |
| I-03 | Escrow released exactly once per agreement | `ServiceAgreement` | ✅ HOLDS — status machine prevents double release |
| I-04 | ETH escrow cannot be stolen by re-entrancy | `ServiceAgreement` | ✅ HOLDS — `nonReentrant` + CEI pattern |
| I-05 | Only owner can propose registry upgrades | `ARC402Wallet` | ✅ HOLDS — `onlyOwner` consistently applied |
| I-06 | Counterparty diversity decays deal count gains | `TrustRegistryV2` | ✅ HOLDS — 10th deal = 0 gain |
| I-07 | Capability score slots bounded at 5 | `TrustRegistryV2` | ✅ HOLDS — fixed array, no overflow |
| I-08 | Settlement execution requires proposer identity | `SettlementCoordinator` | ✅ HOLDS — `msg.sender == fromWallet` |
| I-09 | Wallet freezes on velocity breach | `ARC402Wallet` | ✅ HOLDS — freeze is persistent |
| I-10 | Trust update failures never block escrow release | `ServiceAgreement` | ✅ HOLDS — try/catch wrapping |
| I-11 | ZKCapabilityGate proofs are address-bound | `ZKCapabilityGate` | ✅ HOLDS — root committed per `msg.sender` |
| I-12 | Fee-on-transfer tokens blocked by allowlist | `ServiceAgreement` | ✅ HOLDS — T-03 enforced |
| I-13 | Settlement proposals unique by content hash | `SettlementCoordinator` | ✅ HOLDS — collision check on propose |

---

### Invariants AT RISK

| # | Invariant | Violation | Severity |
|---|-----------|-----------|----------|
| R-01 | `expiredDisputeRefund()` respects 30-day window | `dispute()` never sets `resolvedAt` → bypass immediate | CRITICAL |
| R-02 | Trust score updates reflect v2 semantics | `ServiceAgreement` calls v1 interface → v2 never populated | CRITICAL |
| R-03 | ZK proofs bind to prover identity | No address in public signals → proof theft viable | CRITICAL |
| R-04 | Blocklisted providers cannot receive wallet payments | `validateSpend()` lacks recipient → blocklist unenforced | CRITICAL |
| R-05 | Effective trust decays with inactivity | Any activity resets decay clock to full stored value | HIGH |
| R-06 | Trust signals reflect current relationships | Signals are permanent; weights use historical trust | HIGH |
| R-07 | Velocity limits apply to meaningful spend amounts | Single limit crosses incommensurable ETH/ERC-20 units | HIGH |
| R-08 | Agent consent governs sponsorship attestations | Unilateral issue; no agent opt-out mechanism | HIGH |
| R-09 | Auto-endorsements are capability-specific | Streak shared across all capabilities; capHash from last deal | MEDIUM |
| R-10 | Endpoint stability reflects current behavior | Lifetime change count permanently degrades stability score | MEDIUM |
| R-11 | MAS settlements can complete execution | No `executeMASSettlement()` on ARC402Wallet; ERC-20 path needs approval | MEDIUM |
| R-12 | Reputation signals persist through SA upgrades | `serviceAgreement` is immutable; Oracle must be redeployed per SA version | MEDIUM |
| R-13 | Migrated v1 scores respect time elapsed | v1 score imported at face value with fresh `lastUpdated` | MEDIUM |

---

## Architecture Notes

### What This System Gets Right

The foundational plumbing is sound: CEI patterns are followed consistently, re-entrancy guards are applied to all value-transferring functions, Ownable2Step prevents phishing-based ownership hijacks, and the single-use attestation model is clean. The diversity multiplier in TrustRegistryV2 is a genuinely clever Sybil-resistance mechanism. The ZKCapabilityGate's root-based identity binding is the correct pattern — a model the other ZK gates should follow.

### The Core Architectural Problem

ARC-402 has built a sophisticated stack of components that are not wired together correctly at the seams:

- **Trust data model (v2) exists but is never written.** The richest trust model in the system (TrustRegistryV2) is never populated by the system's primary economic activity (ServiceAgreement). These two components don't speak.

- **Policy enforcement exists but never fires.** The blocklist is populated but `validateSpend()` doesn't read it. The shortlist is populated but has no effect on routing. Policy primitives were added without updating the policy evaluation function.

- **ZK gates prove statements without proving identity.** Two of three ZK gates are philosophically correct (privacy-preserving proofs) but technically broken (proofs aren't bound to the prover). The result is a privacy layer that also removes accountability.

- **The state machine has one broken transition.** The dispute resolution window — the primary safety valve for escrow disputes — relies on a `resolvedAt` field that is never set at the start of the dispute. This single missing line breaks the entire arbitration framework.

### The MAS Settlement Dead End

Multi-agent settlement (the highest-level economic primitive) cannot complete its execution lifecycle for either ETH or ERC-20 when initiated through ARC402Wallet. The proposal can be made. The acceptance can be received. The execution function exists. But there is no call path from ARC402Wallet to `SettlementCoordinator.execute()`. This is a complete circuit break in the protocol's top-level composition.

### Upgrade Path Safety Assessment

The v1→v2 migration design (lazy initialization from v1) is architecturally reasonable but inherits v1's limitations uncritically. The separation of TrustRegistryV2 from ServiceAgreement means the migration is currently inert — nothing writes to v2. When the interface mismatch is fixed, the migration will activate, but v1 scores will be imported with fresh timestamps, defeating time decay for all migrated wallets simultaneously.

The ReputationOracle's immutable `serviceAgreement` makes it incompatible with any future ServiceAgreement upgrade — including the one required by B-002. These two critical fixes (B-002 and B-012) must be implemented together.

---

## Verdict

**FAIL**

ARC-402 v2 introduces valuable architectural concepts — capability-specific trust, commit-reveal delivery, ZK privacy gates, social reputation signals — but ships with four critical failures that individually would justify rejection, and which together create a system where:

1. The escrow protection can be bypassed in a single block
2. The primary trust registry is never written
3. ZK gates are identity-spoofable
4. Blocklists are advisory decorations

None of the four critical findings require significant architectural redesign — they are integration failures (wrong interface called, missing parameter, missing timestamp assignment, missing identity commitment) rather than fundamental model problems. But they must ALL be resolved before any production deployment.

**Minimum required before PASS:**
- B-001: Set `ag.resolvedAt` in `dispute()`
- B-002: Update ServiceAgreement to call ITrustRegistryV2 interface
- B-003: Add address public signal to ZKTrustGate and ZKSolvencyGate circuits
- B-004: Add `recipient` to `validateSpend()` and enforce blocklist

**Required before PASS WITH CONDITIONS:**
- B-007: Separate velocity limits by currency
- B-011: Add `executeMASSettlement()` to ARC402Wallet + ERC-20 approval path
- B-012: Make ReputationOracle service agreement authorization mutable

**The protocol's architectural vision is sound. The implementation is not yet production-safe.**

---

*Auditor B — Defensive Architect | Delta Audit 2026-03-11 | ARC-402 v2*
