# ARC-402 Threat Model

**Status:** Pre-audit reference document
**Contracts in scope:** PolicyEngine, ServiceAgreement, AgreementTree, TrustRegistry, ARC402Wallet, CapabilityRegistry, AgentRegistry, DisputeArbitration
**Network:** Base L2 (OP Stack)

---

## Reentrancy

### Escrow Release Paths

All functions that move escrowed funds are protected by OpenZeppelin `ReentrancyGuard` (`nonReentrant`) and follow the Checks-Effects-Interactions (CEI) pattern: agreement status is set to its terminal state **before** `_releaseEscrow()` is called.

| Function | Guard | CEI order |
|---|---|---|
| `fulfill()` | `nonReentrant` | status → FULFILLED → `_releaseEscrow` |
| `verifyDeliverable()` | `nonReentrant` | status → FULFILLED → `_releaseEscrow` |
| `autoRelease()` | `nonReentrant` | status → FULFILLED → `_releaseEscrow` |
| `cancel()` | `nonReentrant` | status → CANCELLED → `_releaseEscrow` |
| `expiredCancel()` | `nonReentrant` | status → CANCELLED → `_releaseEscrow` |
| `resolveFromArbitration()` | `nonReentrant` | status → FULFILLED → `_releaseEscrow` |
| `challengeChannel()` | `nonReentrant` | status → SETTLED → `_settleChannel` |
| `finaliseChallenge()` | `nonReentrant` | status → SETTLED → `_settleChannel` |
| `reclaimExpiredChannel()` | `nonReentrant` | status → SETTLED → `_releaseEscrow` |

`_releaseEscrow` uses `SafeERC20.safeTransfer` for ERC-20 tokens. For ETH it uses a low-level `.call{value}("")` which could re-enter, but `nonReentrant` blocks re-entry into any other guarded function on the same contract.

### Dispute-Opening Path (NOT nonReentrant — by design)

`dispute()`, `directDispute()`, `openDisputeWithMode()`, and `escalateToDispute()` are `external payable` but not marked `nonReentrant`. This is deliberate: they pay a fee to `DisputeArbitration` (an external contract), which does not release main escrow. The agreement status is set to `DISPUTED` before any external call, so a reentrant call would fail the status check and revert. No escrow funds move in this path — they remain locked until a nonReentrant resolve function runs.

### Channel Close Path

`closeChannel()` is `nonReentrant` but does **not** release funds — it only sets status to `CLOSING` and starts the challenge window. Funds move only in `finaliseChallenge()` (nonReentrant) or `challengeChannel()` (nonReentrant), both of which update `ch.status` to `SETTLED` before calling `_settleChannel`.

### Summary

All ETH and ERC-20 transfers are guarded by `nonReentrant` with CEI ordering. The dispute-open path is an intentional exception: it does not move escrow, and the status update prevents state corruption under reentrancy.

---

## Sybil Attacks on TrustRegistry

### Cost of a Fresh Identity

Creating a new wallet on Base L2 costs approximately $0.30–$0.50 in gas (one deployment transaction). This is a low barrier for adversarial sybil creation.

### What Trust Scores Protect Against

The trust system is designed to surface **honest-but-incompetent** agents: agents who try but fail, miss deadlines, or deliver poor work. Repeated failures reduce the score, making such agents deprioritised by policy engines that filter on `minimumTrustValue`.

### What Trust Scores Do NOT Protect Against

An adversary willing to spend $0.30 per identity can create unlimited fresh wallets. Each starts at the floor score (100). A sybil operator could:
- Farm small agreements to build score
- Execute a targeted attack
- Abandon the identity

The protocol does **not** claim to prevent adversarial sybil with disposable identities.

### Mitigations in Place

1. **Value weighting** (`minimumTrustValue`): The contract owner can set a minimum agreement price below which trust updates are ignored. This raises the cost of score-farming via 1-wei agreements.
2. **Counterparty diversity** (TrustRegistryV2): Score gains from the same counterparty face diminishing returns. Farming score from a single colluding wallet is bounded.
3. **Minimum value gate**: `recordSuccess` only fires if `ag.price >= minimumTrustValue`. Sub-threshold agreements are silently skipped for trust purposes.
4. **Time decay** (TrustRegistryV2): Scores decay with a 180-day half-life, limiting the value of long-abandoned sybil identities.

### Explicit Scope Statement

**Trust scores are a signal, not a guarantee.** A high score indicates a history of successful, diverse, above-minimum-value agreements. It does not certify the agent's identity, legal standing, or resistance to adversarial intent. Callers should combine trust signals with out-of-band verification for high-stakes agreements.

---

## Gas Griefing

### CapabilityRegistry Namespace Loops

`getAgentsWithCapability(capability)` returns the full reverse-index array for a given capability hash. This array is bounded by `MAX_AGENTS_PER_CAPABILITY` (a constant in CapabilityRegistry). Each agent can claim at most 20 capabilities. The loop is O(n) in the number of agents with that capability, bounded by the max-agents constant. Callers pay their own gas — there is no on-chain callback that could grief the contract.

### AgreementTree DAG Traversal

`MAX_DEPTH = 8`. All traversal functions (`_computeDepth`, `_isAncestor`, `getPath`, `_findRoot`) loop with `i <= MAX_DEPTH` as the termination condition, making all loops O(8) = effectively O(1). The depth cap is enforced in `registerSubAgreement` before any child is added, preventing tree growth beyond depth 8.

### PolicyEngine Shortlist Iteration

`getPreferred(wallet, capability)` returns the shortlist array. The shortlist is a caller-maintained array with no on-chain size limit set in PolicyEngine itself. However, shortlists are managed by wallet owners who pay their own gas to add entries. The caller of `getPreferred` pays their own read gas. No on-chain function iterates the shortlist in a path that could grief another user.

### PolicyEngine Daily Limit Check

`validateSpend` does a single mapping lookup (`dailySpend[wallet][category]`). O(1). No loop.

### Unbounded Loops

None found. All loops in scope are bounded by:
- `MAX_DEPTH = 8` (AgreementTree)
- `MAX_AGENTS_PER_CAPABILITY` (CapabilityRegistry)
- `ARBITRATOR_PANEL_SIZE = 3` (ServiceAgreement arbitration)
- `MAX_REMEDIATION_CYCLES = 2` (ServiceAgreement remediation)

---

## Arbitrator Collusion

### Panel Configuration

- Panel size: `ARBITRATOR_PANEL_SIZE = 3`
- Decision threshold: `ARBITRATOR_MAJORITY = 2` (2-of-3 majority required)

Collusion requires at least 2 arbitrators to coordinate a fraudulent vote.

### Bond at Risk

Arbitrators who submit a vote and are found to have acted in bad faith (determined by a subsequent on-chain slash via `TrustRegistry.recordArbitratorSlash`) receive a trust score penalty of −50 points — double the standard anomaly penalty (−20). The DisputeArbitration contract also holds arbitrator bonds; bond slashing applies to arbitrators who fail to vote within the decision window.

### Arbitrator Selection

Arbitrators are **nominated bilaterally** — each party nominates candidates using `nominateArbitrator()`. An arbitrator is only added to the panel if:
- They are registered as an approved arbitrator
- They are not a party to the agreement (`arbitrator != ag.client && arbitrator != ag.provider`)
- The panel is not yet full

There is no on-chain randomness in selection. The selection process has a 3-day window; if the panel is not filled, the dispute can escalate to human review. This means a party can stall selection by refusing to nominate, but cannot unilaterally appoint colluding arbitrators without the counterparty's cooperation — both parties must fill the 3-slot panel.

**Manipulation risk:** A party with a pre-existing relationship with a candidate arbitrator could attempt to steer nomination. This is an off-chain social attack, not exploitable purely on-chain.

---

## Upgrade Key Custody

### No Proxy Pattern

All ARC-402 contracts are **immutable**. There is no `delegatecall` proxy, no `upgradeTo`, and no `selfdestruct`. Contract bytecode cannot be changed after deployment.

### ARC402Wallet Registry Update (timelocked)

`ARC402Wallet` holds a mutable `registry` pointer (an `ARC402Registry` address). The owner can update this pointer to opt into new protocol infrastructure versions. This is **not** a code upgrade — it changes which registry of contract addresses the wallet reads from (PolicyEngine, TrustRegistry, etc.).

The update is timelocked:
1. `proposeRegistryUpdate(newRegistry)` — starts a 2-day countdown
2. `executeRegistryUpdate()` — callable only after `REGISTRY_TIMELOCK = 2 days` has elapsed
3. `cancelRegistryUpdate()` — owner can abort at any time before execution

**What the registry update can do:** Point the wallet at a new PolicyEngine, TrustRegistry, or IntentAttestation contract. Existing agreements in the old ServiceAgreement remain valid — they hold their escrow independently.

**What the registry update cannot do:** Move escrowed funds. Funds in ServiceAgreement are held by ServiceAgreement, not by ARC402Wallet. A registry update does not affect in-flight agreements.

### Guardian / Pause Key

The `freeze()` function on ARC402Wallet is `onlyOwner`. The owner key should be held in a hardware wallet or Gnosis Safe multisig. Specific multisig addresses will be documented after deployment.

---

## Front-Running

### `propose()`

`propose()` takes an explicit `provider` address, `price`, `deadline`, and `deliverablesHash`. Front-running cannot redirect the escrow — funds go directly to the `ServiceAgreement` contract and are attributed to the agreement between `msg.sender` (client) and the specified `provider`. A front-runner submitting their own `propose()` creates a separate agreement with no impact on the original.

**Risk:** None for agreement integrity. A griefing attacker could waste the original caller's gas if the provider's capacity is somehow exclusive, but ServiceAgreement has no exclusive resource that can be occupied.

### `openSessionChannel()`

`openSessionChannel()` specifies an explicit `provider` address. The channel is keyed by a hash of `(client, provider, token, maxAmount, deadline, block.timestamp, nonce)`. A front-runner cannot intercept the client's deposit — they would create a separate channel. The client's funds go into the channel between the exact client and provider specified.

**Risk:** None for fund safety. A front-runner who opens a channel with the same provider simultaneously is creating their own independent channel.

### `AgentRegistry.register()`

Registration is keyed by `msg.sender` (wallet address). A front-runner cannot register on behalf of another address — they would be registering their own wallet. Name squatting is possible if agent names are unique-constrained, but AgentRegistry does not enforce unique names.

**Risk:** Negligible. Names are informational; addresses are the canonical identity.

### Mitigations

The absence of meaningful front-running risk is structural: all critical functions are caller-keyed (escrow belongs to the sender, channels are between specified parties) and do not involve shared exclusive resources.

---

## PolicyEngine Attack Surface

### Salami Attack — FIXED

**Issue:** Sending many small transactions, each below the per-transaction limit, to exhaust a daily budget without any single transaction triggering the per-tx check.

**Fix:** `dailySpend[wallet][category]` accumulates cumulatively across all transactions within a rolling 24-hour window. Each call to `recordSpend` adds to this accumulator. `validateSpend` checks `accumulated + amount > daily` before allowing any spend.

The fix was implemented in commit `af2c6ea` (2026-03-12): cumulative daily tracking + contextId deduplication.

### contextId Replay — FIXED

**Issue:** Submitting the same agreement/context identifier multiple times to double-count a validated spend.

**Fix:** `_usedContextIds[contextId] = true` is set in `recordSpend` after the first use. `validateSpend` checks `_usedContextIds[contextId]` and returns `(false, "PolicyEngine: contextId already used")` on any subsequent attempt with the same contextId.

### Policy Mid-Session

PolicyEngine checks occur at the point of `validateSpend`. Policy settings (`categoryLimits`, `dailyCategoryLimit`) are read at validation time, not locked at context open. This means an owner could tighten policy mid-session, which would block subsequent spends in that context. This is intentional — it gives the owner emergency stop capability. Loosening policy mid-session would take effect immediately for subsequent spends.

### 100 Concurrent Agreements — Daily Limit Tracking

`dailySpend` is keyed by `(wallet, category)`, **not** by agreementId. When 100 simultaneous agreements each trigger `recordSpend(wallet, category, amount, contextId)`:

- All 100 calls write to the same `dailySpend[wallet][category]` accumulator.
- The daily limit is enforced globally across all concurrent agreements for the same wallet and category.
- This is the correct and intended behaviour: 100 × $10 agreements in "compute" category will exhaust a $500 daily compute limit after 50 agreements, blocking the remaining 50.

There is no per-agreement escaping of the daily limit.

---

## Session Channel Liveness

### Challenge Window

`CHALLENGE_WINDOW = 24 hours` (set as a constant in ServiceAgreement). After a close is submitted via `closeChannel()`, either party has 24 hours to submit a higher-sequence state via `challengeChannel()`.

### Liveness Requirement

At least one party (or a delegated watchtower) must be online and monitoring within the 24-hour window after any close attempt. If both parties are offline and no watchtower is running, a stale close will be finalised by `finaliseChallenge()` after the window expires.

### Watchtower Mitigation (Three Tiers)

1. **Tier 1 — Arc402 Daemon (`arc402 daemon channel-watch`):** An always-on process co-located with the agent node. Polls every 30s for `ChannelClosing` events and auto-challenges from local signed state storage at `~/.arc402/channel-states/<channelId>.json`. Suitable for nodes that remain online.

2. **Tier 2 — WatchtowerRegistry / External Watchtower Service:** A third-party service registers channels and accepts pre-signed states. The watchtower cannot forge states (requires both signatures) and cannot steal funds (payouts go to client/provider, not to the watchtower). Suitable for agents with intermittent connectivity.

3. **Tier 3 — Enterprise Watchtower:** Managed redundant monitoring infrastructure for high-value channels. Protocol-level integration defined in `spec/22-watchtower.md`.

### Worst Case

If both parties are offline, no watchtower is registered, and no challenge is submitted within 24 hours: `finaliseChallenge()` can be called by anyone after `challengeExpiry`. The last submitted close state is finalised, regardless of whether it is the highest-sequence state.

### User Responsibility

**Operators who open session channels are responsible for ensuring at least one of the following:**
- The `arc402 daemon channel-watch` process is running continuously.
- A watchtower service is registered for their channels.
- Both parties have agreed on a cooperative close before going offline.

The protocol cannot guarantee liveness protection if no monitoring is in place. This is an explicit design constraint of the optimistic channel model.
