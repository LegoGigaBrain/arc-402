# Auditor C (Independent) — Delta Audit Report 2026-03-11

## Summary

Fresh-eyes review of ARC-402 reveals **three critical bugs** that break core protocol mechanics, two **high-severity** logic issues, and several **medium-severity** gaps. The most severe: **dispute timeout broken** (anyone can refund disputed funds immediately), **ServiceAgreement cannot call TrustRegistry** (function signature mismatch), and **registry timelock can be indefinitely extended**.

The protocol shows strong architectural thinking but has implementation gaps in state management, cross-contract integration, and edge case handling.

---

## Findings

### C-001 [CRITICAL]: Dispute Timeout Broken — resolvedAt Never Initialized

**Contract:** ServiceAgreement.sol  
**Line:** Line 422 (dispute function), Line 459 (expiredDisputeRefund function)  
**Issue:**

When a dispute is raised via `dispute()`, the `resolvedAt` field is NOT updated. It remains 0. But `expiredDisputeRefund()` checks:
```solidity
require(
    block.timestamp > ag.resolvedAt + DISPUTE_TIMEOUT,
    "ServiceAgreement: dispute timeout not reached"
);
```

Since `ag.resolvedAt == 0` initially, the condition `block.timestamp > 0 + 30 days` is true almost immediately (unless the dispute was raised within 30 days of the Unix epoch in 1970). This means anyone can call `expiredDisputeRefund()` on a just-disputed agreement and refund the client **without waiting 30 days**.

**Proof of Concept:**

1. Alice proposes a service agreement with Bob (provider)
2. Bob accepts
3. Alice disputes immediately: `dispute()` is called
4. `resolvedAt` = 0
5. Alice (or any party) calls `expiredDisputeRefund()` on block 1: `block.timestamp > 0 + 30 days` passes
6. Client refund executed within seconds, not 30 days

**Recommendation:**

In the `dispute()` function, set `ag.resolvedAt = block.timestamp;` to start the 30-day timeout clock.

```solidity
function dispute(uint256 agreementId, string calldata reason) external {
    require(bytes(reason).length <= 512, "ServiceAgreement: reason too long");
    Agreement storage ag = _get(agreementId);
    require(
        msg.sender == ag.client || msg.sender == ag.provider,
        "ServiceAgreement: not a party"
    );
    require(
        ag.status == Status.ACCEPTED || ag.status == Status.PENDING_VERIFICATION,
        "ServiceAgreement: not ACCEPTED"
    );

    ag.status = Status.DISPUTED;
    ag.resolvedAt = block.timestamp;  // <-- ADD THIS LINE

    emit AgreementDisputed(agreementId, msg.sender, reason);
}
```

---

### C-002 [CRITICAL]: ServiceAgreement Cannot Call TrustRegistry — Function Signature Mismatch

**Contract:** ServiceAgreement.sol  
**Line:** Line 517–519 (_updateTrust function)  
**Issue:**

ServiceAgreement calls:
```solidity
try ITrustRegistry(trustRegistry).recordSuccess(ag.provider) {
```

But TrustRegistryV2.recordSuccess signature is:
```solidity
function recordSuccess(
    address wallet,
    address counterparty,
    string calldata capability,
    uint256 agreementValueWei
) external onlyUpdater
```

The call with a single argument (wallet) does not match the four-argument signature. This will revert at the call site, causing `_updateTrust` to silently fail (caught by the try-catch), and **no trust score updates will occur** even when agreements fulfill successfully.

Similarly, `recordAnomaly` signature is:
```solidity
function recordAnomaly(
    address wallet,
    address counterparty,
    string calldata capability,
    uint256 agreementValueWei
) external onlyUpdater
```

But ServiceAgreement calls:
```solidity
try ITrustRegistry(trustRegistry).recordAnomaly(ag.provider) {
```

Again, signature mismatch — the entire trust-score update mechanism is broken.

**Proof of Concept:**

1. Deploy ServiceAgreement with TrustRegistryV2
2. Create and fulfill an agreement with adequate price
3. `_updateTrust` is called, which attempts `recordSuccess(ag.provider)`
4. ABI encoder fails to match the signature (4 params expected, 1 provided)
5. The try-catch catches it silently
6. Trust score remains unchanged: no provider incentive for good work

**Recommendation:**

Update `_updateTrust` to pass all required parameters:

```solidity
function _updateTrust(uint256 agreementId, Agreement storage ag, bool success) internal {
    bytes32 capabilityHash = keccak256(bytes(ag.serviceType));

    if (trustRegistry != address(0)) {
        if (success) {
            if (minimumTrustValue == 0 || ag.price >= minimumTrustValue) {
                try ITrustRegistry(trustRegistry).recordSuccess(
                    ag.provider,
                    ag.client,           // counterparty is client
                    ag.serviceType,      // capability
                    ag.price             // agreementValueWei
                ) {
                    // trust updated successfully
                } catch {
                    emit TrustUpdateFailed(agreementId, ag.provider, "fulfill");
                }
            }
        } else {
            try ITrustRegistry(trustRegistry).recordAnomaly(
                ag.provider,
                ag.client,               // counterparty is client
                ag.serviceType,          // capability
                ag.price                 // agreementValueWei
            ) {
                // trust updated successfully
            } catch {
                emit TrustUpdateFailed(agreementId, ag.provider, "resolveDispute:anomaly");
            }
        }
    }
    // ... reputation oracle calls ...
}
```

---

### C-003 [CRITICAL]: ARC402Wallet Registry Timelock Can Be Indefinitely Extended

**Contract:** ARC402Wallet.sol  
**Line:** Lines 154–170 (proposeRegistryUpdate, executeRegistryUpdate, cancelRegistryUpdate)  
**Issue:**

The registry upgrade mechanism allows the owner to call `proposeRegistryUpdate(newRegistry)` to begin a 2-day timelock. However, **before the timelock expires**, the owner can call `proposeRegistryUpdate(anotherRegistry)`, which **overwrites `registryUpdateUnlockAt`** with a fresh 2-day deadline.

This allows the owner to:
1. `proposeRegistryUpdate(A)` at block 100
2. Observe A is broken or undesired
3. `proposeRegistryUpdate(B)` at block 101
4. Observe B is worse
5. `proposeRegistryUpdate(C)` at block 102
6. ...repeat indefinitely...

The wallet never actually upgrades, and users/protocols relying on deterministic registry changes cannot make assumptions about the upgrade timeline. An attacker (or a compromised owner) could indefinitely stall upgrades.

**Proof of Concept:**

1. Owner calls `proposeRegistryUpdate(registryA)`
2. registryUpdateUnlockAt = block.timestamp + 2 days (block 100 + 2 days)
3. At block 101, owner calls `proposeRegistryUpdate(registryB)`
4. registryUpdateUnlockAt = block.timestamp + 2 days (block 101 + 2 days)
5. At block 102, owner calls `proposeRegistryUpdate(registryC)`
6. registryUpdateUnlockAt = block.timestamp + 2 days (block 102 + 2 days)
7. The owner repeatedly extends the deadline. No upgrade ever commits.

**Recommendation:**

Enforce that a pending registry upgrade must either execute or be explicitly cancelled before a new one can be proposed:

```solidity
function proposeRegistryUpdate(address newRegistry) external onlyOwner {
    require(newRegistry != address(0), "ARC402: zero registry");
    require(pendingRegistry == address(0), "ARC402: pending upgrade in progress");  // <-- ADD THIS
    pendingRegistry = newRegistry;
    registryUpdateUnlockAt = block.timestamp + REGISTRY_TIMELOCK;
    emit RegistryUpdateProposed(newRegistry, registryUpdateUnlockAt);
}
```

Or, allow updates only after the previous lock has been cancelled or executed.

---

### C-004 [HIGH]: ReputationOracle — hasSignaled Prevents Manual Signal After Auto-WARN

**Contract:** ReputationOracle.sol  
**Line:** Lines 157–159 (autoWarn), Lines 187–188 (autoRecordSuccess)  
**Issue:**

Both `autoWarn()` and `autoRecordSuccess()` set `hasSignaled[client][provider] = true`, which is idempotent and prevents double-signaling by the same publisher.

However, this creates a semantic problem: if Alice is a client and wins a dispute against Bob, ServiceAgreement calls `reputationOracle.autoWarn(alice, bob, capHash)`, which sets `hasSignaled[alice][bob] = true`. Now Alice cannot manually call `publishSignal()` later to issue a stronger or more detailed WARN signal about Bob (e.g., with a specific reason), because the check at line 105 requires `!hasSignaled[msg.sender][subject]`.

This couples auto-published signals to manual signals in a way that limits expressiveness. Alice is prevented from refining her reputation judgment once the auto-WARN is published.

**Proof of Concept:**

1. Alice disputes with Bob over a deliverable
2. Arbitrer resolves in Alice's favor
3. `reputationOracle.autoWarn(alice, bob, capabilityHash)` publishes a generic "Dispute resolved against provider" WARN
4. `hasSignaled[alice][bob]` = true
5. Alice later gathers evidence of Bob's incompetence and wants to publish a detailed WARN with specific evidence
6. Alice calls `publishSignal(bob, WARN, capHash, "Evidence: Bob submitted code with 50 bugs")` 
7. **Reverts** because `hasSignaled[alice][bob]` is already true

**Recommendation:**

Separate auto-signals from manual signals, or allow manual signals to override/refine auto-signals. For example:

```solidity
// In ReputationOracle: use two separate mappings
mapping(address => mapping(address => bool)) public hasAutoSignaled;
mapping(address => mapping(address => bool)) public hasManualSignaled;

function publishSignal(...) external {
    // ...
    require(!hasManualSignaled[msg.sender][subject], "ReputationOracle: already signaled");
    // ...
    hasManualSignaled[msg.sender][subject] = true;
}

function autoWarn(...) external onlyServiceAgreement {
    // ...
    if (hasAutoSignaled[client][provider]) return;
    // ...
    hasAutoSignaled[client][provider] = true;
}
```

Or, allow a single `hasSignaled` mapping but allow updates (move away from "one signal per pair" toward "latest signal per pair").

---

### C-005 [HIGH]: ServiceAgreement — commitDeliverable Does Not Check Deadline Before PENDING_VERIFICATION

**Contract:** ServiceAgreement.sol  
**Line:** Lines 366–378 (commitDeliverable)  
**Issue:**

The `commitDeliverable()` function correctly checks that `block.timestamp <= ag.deadline`, preventing commits after the deadline. However, once in `PENDING_VERIFICATION`, the `verifyDeliverable()` function does NOT check the deadline again:

```solidity
function verifyDeliverable(uint256 agreementId) external nonReentrant {
    Agreement storage ag = _get(agreementId);
    require(msg.sender == ag.client, "ServiceAgreement: not client");
    require(ag.status == Status.PENDING_VERIFICATION, "ServiceAgreement: not PENDING_VERIFICATION");
    // NO deadline check here
    
    ag.status = Status.FULFILLED;
    ag.resolvedAt = block.timestamp;
    // ...
    _releaseEscrow(ag.token, ag.provider, ag.price);
}
```

Similarly, `autoRelease()` only checks the verify window, not the original deadline:

```solidity
function autoRelease(uint256 agreementId) external nonReentrant {
    Agreement storage ag = _get(agreementId);
    require(ag.status == Status.PENDING_VERIFICATION, "ServiceAgreement: not PENDING_VERIFICATION");
    require(block.timestamp > ag.verifyWindowEnd, "ServiceAgreement: verify window open");
    // NO deadline check
    // ...
}
```

This means:
- Provider commits a deliverable at deadline - 1 second
- Verify window opens: deadline + 3 days - 1 second
- On deadline + 30 days, client approves the deliverable and releases escrow **months after the agreement deadline**

The agreement should be dead after the deadline, but the two-step commit-reveal path allows resurrection.

**Proof of Concept:**

1. Agreement deadline = block 100 + 7 days
2. At block 100 + 6.99 days, provider calls `commitDeliverable(deliverableHash)`
3. verifyWindowEnd = block 100 + 6.99 days + 3 days = block 100 + 9.99 days
4. Client can call `verifyDeliverable()` or auto-release can happen at block 100 + 9.99 days, **well past the original 7-day deadline**

**Recommendation:**

Add deadline checks in both `verifyDeliverable()` and `autoRelease()`:

```solidity
function verifyDeliverable(uint256 agreementId) external nonReentrant {
    Agreement storage ag = _get(agreementId);
    require(msg.sender == ag.client, "ServiceAgreement: not client");
    require(ag.status == Status.PENDING_VERIFICATION, "ServiceAgreement: not PENDING_VERIFICATION");
    require(block.timestamp <= ag.deadline, "ServiceAgreement: past deadline");  // <-- ADD THIS
    
    ag.status = Status.FULFILLED;
    ag.resolvedAt = block.timestamp;
    emit AgreementFulfilled(agreementId, ag.provider, ag.committedHash);
    _releaseEscrow(ag.token, ag.provider, ag.price);
    _updateTrust(agreementId, ag, true);
}

function autoRelease(uint256 agreementId) external nonReentrant {
    Agreement storage ag = _get(agreementId);
    require(ag.status == Status.PENDING_VERIFICATION, "ServiceAgreement: not PENDING_VERIFICATION");
    require(block.timestamp > ag.verifyWindowEnd, "ServiceAgreement: verify window open");
    require(block.timestamp <= ag.deadline, "ServiceAgreement: past deadline");  // <-- ADD THIS
    
    ag.status = Status.FULFILLED;
    ag.resolvedAt = block.timestamp;
    emit AgreementFulfilled(agreementId, ag.provider, ag.committedHash);
    emit AutoReleased(agreementId, ag.provider);
    _releaseEscrow(ag.token, ag.provider, ag.price);
    _updateTrust(agreementId, ag, true);
}
```

---

### C-006 [MEDIUM]: PolicyEngine — Blocklist Can Be Toggled Repeatedly to Bypass State Checks

**Contract:** PolicyEngine.sol  
**Line:** Lines 93–104 (addToBlocklist / removeFromBlocklist)  
**Issue:**

The blocklist uses a simple boolean mapping:

```solidity
mapping(address => mapping(address => bool)) private _blocklist;

function addToBlocklist(address wallet, address provider) external onlyWalletOwnerOrWallet(wallet) {
    require(provider != address(0), "PolicyEngine: zero provider");
    _blocklist[wallet][provider] = true;
    emit ProviderBlocked(wallet, provider);
}

function removeFromBlocklist(address wallet, address provider) external onlyWalletOwnerOrWallet(wallet) {
    _blocklist[wallet][provider] = false;
    emit ProviderUnblocked(wallet, provider);
}
```

There is no state check preventing repeated toggle operations or enforcing that a provider remains blocked. An attacker-controlled wallet owner could:

1. Block provider A
2. Unblock provider A
3. Block provider A again
4. ...spam toggles...

This creates excessive event spam and burns gas unnecessarily. More critically, if any downstream system relies on listening to `ProviderBlocked` events to update off-chain state, the repeated toggling could cause state divergence.

**Proof of Concept:**

```solidity
for (uint i = 0; i < 1000; i++) {
    policyEngine.addToBlocklist(wallet, provider);
    policyEngine.removeFromBlocklist(wallet, provider);
}
```

This spams the event log and can cause off-chain indexers to be confused.

**Recommendation:**

Add state guards to prevent redundant operations:

```solidity
function addToBlocklist(address wallet, address provider) 
    external onlyWalletOwnerOrWallet(wallet) 
{
    require(provider != address(0), "PolicyEngine: zero provider");
    require(!_blocklist[wallet][provider], "PolicyEngine: already blocked");  // <-- ADD THIS
    _blocklist[wallet][provider] = true;
    emit ProviderBlocked(wallet, provider);
}

function removeFromBlocklist(address wallet, address provider) 
    external onlyWalletOwnerOrWallet(wallet) 
{
    require(_blocklist[wallet][provider], "PolicyEngine: not blocked");  // <-- ADD THIS
    _blocklist[wallet][provider] = false;
    emit ProviderUnblocked(wallet, provider);
}
```

---

### C-007 [MEDIUM]: TrustRegistryV2 — Edge Case in Decay Calculation at Day 0

**Contract:** TrustRegistryV2.sol  
**Line:** Lines 287–296 (getEffectiveScore)  
**Issue:**

In `getEffectiveScore()`:

```solidity
uint256 elapsed = block.timestamp - p.lastUpdated;
if (elapsed == 0) return p.globalScore;

uint256 above = p.globalScore > DECAY_FLOOR ? p.globalScore - DECAY_FLOOR : 0;
uint256 halvings = elapsed / HALF_LIFE;
if (halvings >= 10) return DECAY_FLOOR;
above = above >> halvings;
return DECAY_FLOOR + above;
```

If `lastUpdated` was set to `block.timestamp` at wallet initialization, and then the wallet is queried in the same block (elapsed = 0), the function correctly returns the stored score.

However, consider an edge case: if a wallet is initialized at block.timestamp T, then the contract's view of `block.timestamp` advances by 1 second to T+1, the code computes `elapsed = 1`. With `HALF_LIFE = 180 days = 15_552_000 seconds`, `halvings = 0`, and decay is negligible. But the comment claims "Accurate to ~1 part in 1000 for intervals up to 10 years."

This is not a functional bug, but the precision claim is not validated in tests. Specifically, there are no tests for:
- Decay at day 1, day 7, day 30 (just initialized, various small intervals)
- Decay at exactly 180 days (half-life boundary)
- Decay at 179 days vs 180 days (boundary behavior)

**Proof of Concept:**

Not applicable—this is a documentation/testing gap, not a runtime bug. But it's worth noting because the implementation uses right-shift division, which introduces rounding errors that are not explicitly tested.

**Recommendation:**

Add explicit tests for boundary cases in TrustRegistryV2.t.sol:

```solidity
function test_EffectiveScore_ExactHalfLife() public {
    registry.initWallet(WALLET);
    for (uint256 i = 0; i < 32; i++) {
        registry.recordSuccess(WALLET, address(uint160(0xE000 + i)), "compute", 1 ether);
    }
    uint256 stored = registry.getGlobalScore(WALLET);
    uint256 above = stored > 100 ? stored - 100 : 0;
    
    vm.warp(block.timestamp + 180 days);
    uint256 eff = registry.getEffectiveScore(WALLET);
    uint256 expected = 100 + (above >> 1);
    assertEq(eff, expected, "Effective score should be exactly half at 180 days");
}

function test_EffectiveScore_OneDayBefore() public {
    registry.initWallet(WALLET);
    for (uint256 i = 0; i < 32; i++) {
        registry.recordSuccess(WALLET, address(uint160(0xF000 + i)), "compute", 1 ether);
    }
    uint256 stored = registry.getGlobalScore(WALLET);
    uint256 above = stored > 100 ? stored - 100 : 0;
    
    vm.warp(block.timestamp + 180 days - 1);
    uint256 eff = registry.getEffectiveScore(WALLET);
    // At 179 days, halvings = 0, so effective = stored (no decay yet)
    assertEq(eff, stored, "No decay at day 179");
}
```

---

### C-008 [MEDIUM]: ZKCapabilityGate — Public Signal Ordering Not Verified Against Circuit

**Contract:** ZKCapabilityGate.sol  
**Line:** Lines 72–77 (verifyCapability)  
**Issue:**

The `verifyCapability()` function constructs public signals as:

```solidity
uint[2] memory pubSignals;
pubSignals[0] = uint256(root);
pubSignals[1] = uint256(capabilityHash);
```

However, the contract does not document (or require) that the Groth16 circuit being verified expects signals in this order. If the circuit was generated to expect `[capabilityHash, root]` instead, the proof verification will fail silently or accept invalid proofs.

The comment says "IMPORTANT: Dev keys used. Replace with proper MPC trusted setup for mainnet," but there is no formal specification linking the Solidity signal order to the circom circuit definition.

**Proof of Concept:**

1. Developer generates a circom circuit that expects `[capabilityHash, root]`
2. Developer generates Groth16 keys from that circuit
3. Developer deploys ZKCapabilityGate, which constructs signals as `[root, capabilityHash]`
4. Valid proofs for the circuit fail; invalid signal orderings pass (or vice versa)

**Recommendation:**

Add explicit comments linking signal order to circuit definition, and consider adding a circuit version identifier:

```solidity
/**
 * @notice Verify a ZK proof that the caller has a specific capability in their set.
 * 
 * PUBLIC SIGNALS (order CRITICAL — must match circom circuit):
 *   [0] = Merkle root of capability set
 *   [1] = keccak256 hash of the capability string
 * 
 * CIRCUIT: zkCapability_v1.circom
 * KEYS: Groth16 keys generated from zkCapability_v1 on [DATE]
 */
function verifyCapability(
    uint[2] calldata pA,
    uint[2][2] calldata pB,
    uint[2] calldata pC,
    bytes32 capabilityHash
) external returns (bool) {
    bytes32 root = capabilityRoots[msg.sender];
    require(root != bytes32(0), "ZKCapabilityGate: no root registered");

    uint[2] memory pubSignals;
    pubSignals[0] = uint256(root);                // Signal [0]: root
    pubSignals[1] = uint256(capabilityHash);      // Signal [1]: capability hash
    // ^^^ Must match zkCapability_v1.circom public input order

    bool valid = verifier.verifyProof(pA, pB, pC, pubSignals);
    if (valid) {
        emit CapabilityProofVerified(msg.sender, capabilityHash);
    }
    return valid;
}
```

---

### C-009 [MEDIUM]: SettlementCoordinator — Missing Expiry Check in execute()

**Contract:** SettlementCoordinator.sol  
**Line:** Lines 100–121 (execute function)  
**Issue:**

The `execute()` function checks that the proposal is ACCEPTED and that it hasn't exceeded the EXECUTION_WINDOW (7 days after acceptance). However, it also checks that `block.timestamp <= p.expiresAt`, where `expiresAt` is the **original proposal expiry** (set when proposed, typically 1 day).

This means:
- Proposal created at block 100
- expiresAt = block 100 + 1 day
- Accepted at block 100 + 6 hours
- acceptedAt = block 100 + 6 hours
- EXECUTION_WINDOW = 7 days

But `block.timestamp <= p.expiresAt` will fail after block 100 + 1 day, even though the acceptance-based 7-day window hasn't closed. The original proposal expiry takes precedence over the execution window, creating confusion:

```solidity
require(block.timestamp <= p.expiresAt, "SettlementCoordinator: expired");
require(
    block.timestamp <= p.acceptedAt + EXECUTION_WINDOW,
    "SettlementCoordinator: execution window expired"
);
```

If a proposal expires before it's accepted, that's fine (checked in `accept()`). But the redundant check in `execute()` with a different deadline is confusing and could prevent execution even when the proposal was accepted within the window.

**Proof of Concept:**

1. Proposal created at block 100, expiresAt = block 100 + 1 day
2. Accepted at block 100 + 12 hours
3. Execution attempted at block 100 + 18 hours:
   - `block.timestamp <= p.expiresAt`: block 100 + 18 hours > block 100 + 1 day — **FAILS**
   - `block.timestamp <= p.acceptedAt + EXECUTION_WINDOW`: block 100 + 18 hours <= block 100 + 12 hours + 7 days — passes

Even though the execution window is open, the transaction reverts due to original expiry.

**Recommendation:**

Remove the redundant `expiresAt` check from `execute()`, or clarify the semantics. The EXECUTION_WINDOW is the authoritative deadline for settlements:

```solidity
function execute(bytes32 proposalId) external payable {
    Proposal storage p = proposals[proposalId];
    require(proposalExists[proposalId], "SettlementCoordinator: not found");
    require(p.status == ProposalStatus.ACCEPTED, "SettlementCoordinator: not accepted");
    // Remove: require(block.timestamp <= p.expiresAt, "SettlementCoordinator: expired");
    require(
        block.timestamp <= p.acceptedAt + EXECUTION_WINDOW,
        "SettlementCoordinator: execution window expired"
    );
    require(msg.sender == p.fromWallet, "SettlementCoordinator: not sender");

    p.status = ProposalStatus.EXECUTED;
    emit ProposalExecuted(proposalId, p.amount);
    // ... transfer logic ...
}
```

---

## Test Coverage Gaps

The following behaviors are **not tested** but should be:

1. **ServiceAgreement dispute timeout**: No test for `expiredDisputeRefund()` actually waiting 30 days and then refunding. All existing tests pass early.

2. **ServiceAgreement deadline expiry in PENDING_VERIFICATION**: No test that `verifyDeliverable()` fails after the original deadline when in PENDING_VERIFICATION state. Currently, the two-step path ignores the deadline.

3. **TrustRegistryV2 time decay boundary cases**: No tests for decay at day 1, day 7, day 179 (one day before half-life), or the exact transition at day 180.

4. **ReputationOracle signal override**: No test that demonstrates the limitation where a client cannot publish a manual signal after an auto-WARN.

5. **ARC402Wallet velocity limit triggered by both ETH and token spending**: The velocity tracking uses separate accumulators for `ethSpendingInWindow` and `tokenSpendingInWindow`. No test that verifies both are reset on window rollover, or that token spending can trigger the velocity freeze independently.

6. **PolicyEngine blocklist idempotency**: No test that verifies adding to blocklist twice or removing when not blocked produces appropriate state and events.

7. **SettlementCoordinator expiry window interaction**: No test that verifies the behavior of a proposal that expires before acceptance but is accepted just under the deadline, then executed within EXECUTION_WINDOW but after original expiresAt.

8. **ARC402Wallet registry timelock re-proposal**: No test that proposes a new registry before the prior timelock expires, and verifies the behavior.

9. **ZK gate public signal ordering**: No integration test that generates actual Groth16 proofs and verifies they match the expected signal order.

---

## Verdict

**FAIL**

The ARC-402 contracts contain **three critical bugs** (dispute timeout, TrustRegistry call signature mismatch, registry timelock extension) that prevent core functionality from working as designed. Additionally, there are two high-severity logic flaws and multiple medium-severity gaps.

**Before mainnet launch:**

1. **C-001 (CRITICAL)**: Fix `dispute()` to set `resolvedAt`
2. **C-002 (CRITICAL)**: Fix `_updateTrust()` to call TrustRegistry with correct signatures
3. **C-003 (CRITICAL)**: Add guard to prevent re-proposing registry upgrade before execution/cancellation
4. **C-004 (HIGH)**: Revisit ReputationOracle signal semantics to allow manual refinement
5. **C-005 (HIGH)**: Add deadline checks to `verifyDeliverable()` and `autoRelease()`
6. **C-006 through C-009 (MEDIUM)**: Address as listed
7. **Test Coverage**: Implement tests for all gaps listed above

The architecture is sound, but the implementation needs hardening before any production deployment.

