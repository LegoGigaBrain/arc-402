# ARC-402 Threat Model
**Version:** 1.0  
**Date:** 2026-03-11  
**Auditor:** Forge Engineering (Economic Attack Layer)  
**Methodology:** Simulating Trail of Bits / Spearbit / ConsenSys Diligence economic analysis

---

## System Overview

ARC-402 is a protocol for autonomous agent-to-agent service agreements on Base (L2). It enables:
- **ServiceAgreement.sol** — bilateral escrow contracts between a client agent and provider agent
- **TrustRegistry.sol** — on-chain reputation scores (0–1000) for agent wallets
- **AgentRegistry.sol** — agent discovery, capability registration, and endpoint publishing
- **ARC402Wallet.sol** — governed spending wallet with policy engine integration
- **WalletFactory.sol** — deterministic wallet deployment

**Scope of this threat model:** `ServiceAgreement.sol` (primary risk surface), `TrustRegistry.sol`, `AgentRegistry.sol`.  
**Out of scope (v1):** PolicyEngine, IntentAttestation, SettlementCoordinator, WalletFactory.

**Protocol status:** DRAFT — not audited, not production-ready.

---

## Assets at Risk

| Asset | Estimated Value | Location | Notes |
|-------|----------------|----------|-------|
| ETH Escrow | Per agreement (user-defined) | `ServiceAgreement.sol` balance | Locked until fulfill/cancel/dispute |
| ERC-20 Escrow | Per agreement (user-defined) | `ServiceAgreement.sol` balance | Includes USDC, any ERC-20 |
| Trust Scores | Indirect (unlocks permissions) | `TrustRegistry.sol` `scores[]` | Score 800+ = Autonomous tier |
| Agent Reputation | Brand/business value | `AgentRegistry.sol` `_agents[]` | Endpoint and capability data |
| Protocol Owner Key | Controls dispute resolution | EOA / multisig (off-chain) | Single point of failure in v1 |

**Maximum value at risk (single agreement):** Unbounded — no cap on `price` parameter.  
**Maximum systemic value at risk:** Sum of all active escrow balances across all agreements.

---

## Trust Boundaries

```
┌─────────────────────────────────────────────────────┐
│  TRUSTED                                            │
│  ┌─────────────────────────────────────────────┐   │
│  │ contract owner (dispute arbiter)            │   │
│  │ ServiceAgreement.sol (holds escrow)         │   │
│  │ TrustRegistry.sol (authorized updaters)     │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  SEMI-TRUSTED (role-based)                         │
│  ┌─────────────────────────────────────────────┐   │
│  │ client (must be agreement creator)          │   │
│  │ provider (must be designated counterparty)  │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  UNTRUSTED                                         │
│  ┌─────────────────────────────────────────────┐   │
│  │ all other addresses                         │   │
│  │ ERC-20 tokens (no allowlist)                │   │
│  │ provider off-chain execution environment    │   │
│  │ MEV bots / sequencer                        │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

Key trust boundary: **The contract owner is the sole dispute arbiter in v1.**  
If the owner key is compromised, ALL disputed funds are at risk. This is the protocol's most critical single point of failure.

---

## Threat Actors

| Actor | Capability | Motivation | Sophistication |
|-------|-----------|------------|----------------|
| External Attacker | Any EOA or contract | Drain escrow funds | Low to High |
| Malicious Provider | Designated provider wallet | Receive payment without delivering | Medium |
| Malicious Client | Designated client wallet | Recover escrow without compensating provider | Medium |
| Compromised Owner | Controls `owner` key | Resolve all disputes in attacker's favour | High |
| MEV Bot / Sequencer | Sees mempool, sets timestamp | Front-run transactions, deadline manipulation | High |
| Sybil Attacker | Controls many wallets | Farm trust scores, pollute registry | Medium |
| Token Issuer | Deploys malicious ERC-20 | Lock funds in contract (DoS) | Medium |

---

## Attack Surface

| Entry Point | Caller | Value Transferred | Risk Level |
|-------------|--------|------------------|------------|
| `propose()` | client | ETH or ERC-20 to escrow | HIGH — escrow entry |
| `accept()` | provider | None | LOW |
| `fulfill()` | provider | Escrow released to provider | HIGH — escrow exit |
| `cancel()` | client | Escrow returned to client | MEDIUM |
| `expiredCancel()` | client | Escrow returned to client | MEDIUM — timestamp dependency |
| `dispute()` | client or provider | None (escrow locked) | MEDIUM |
| `resolveDispute()` | owner only | Escrow released | CRITICAL — single arbiter |
| `transferOwnership()` | owner only | None | CRITICAL — key rotation |
| `register()` (AgentRegistry) | agent | None | LOW — reputation data |
| `recordSuccess/Anomaly()` (TrustRegistry) | authorized updater | None | HIGH — trust score manipulation |
| `addUpdater()` (TrustRegistry) | owner | None | CRITICAL — updater access control |

---

## Threat Matrix

| ID | Threat | Actor | Likelihood | Impact | Mitigation | Status |
|----|--------|-------|-----------|--------|------------|--------|
| T-01 | Reentrancy on escrow release | External attacker (malicious provider) | LOW | CRITICAL | OpenZeppelin `ReentrancyGuard` on `fulfill()`, `cancel()`, `expiredCancel()`, `resolveDispute()` | **MITIGATED** |
| T-02 | Owner key compromise (single point of failure) | Compromised owner / insider | MEDIUM | CRITICAL | None in v1. Entire disputed escrow pool at risk | **OPEN** |
| T-03 | Sybil trust farming | Sybil attacker with updater access | HIGH | HIGH | No minimum agreement value; no rate limiting; cost to Autonomous: ~$20 in gas | **OPEN** |
| T-04 | Malicious ERC-20 token (revert on transfer) | Token issuer / attacker | MEDIUM | HIGH | No token allowlist; funds permanently locked if token reverts on transfer() | **OPEN** |
| T-05 | MEV front-running on propose() | MEV bot | HIGH | LOW | Escrow tied to `msg.sender` as client; front-runner gains nothing, only locks own ETH | **MITIGATED** |
| T-06 | Flash loan attack on escrow | External attacker with capital | LOW | NONE | No shared liquidity pool; msg.sender binding prevents cross-agreement access | **MITIGATED** |
| T-07 | Deadline manipulation (Base L2 sequencer ±15s) | Sequencer / MEV | MEDIUM | LOW | Accepted L2 property; only affects sub-300s deadline agreements | **ACCEPTED** |
| T-08 | Self-dealing agreements (trust farming) | Sybil attacker | HIGH | HIGH | `client != provider` check prevents same-address deals; two-wallet deals still possible | **PARTIAL** |
| T-09 | Endpoint bait-and-switch (AgentRegistry) | Malicious agent | HIGH | MEDIUM | No endpoint validation; any string accepted; agent can update endpoint after selection | **OPEN** |
| T-10 | Fee-on-transfer token accounting error | Token issuer | MEDIUM | HIGH | `safeTransferFrom` used, but no balance check before/after deposit; contract holds less than `price` records | **OPEN** |
| T-11 | Griefing via tiny agreements (DoS) | Griefer | MEDIUM | LOW | No minimum price; gas cost ~$0.10 per agreement at 0.1 gwei; economically expensive at scale | **ACCEPTED** |
| T-12 | Client ghosts after delivery | Malicious client | N/A | N/A | Non-issue: `fulfill()` is called by provider, auto-releases escrow — client approval not required | **N/A** |
| T-13 | Provider submits garbage deliverables hash | Malicious provider | HIGH | MEDIUM | No on-chain verification of `deliverablesHash`; any bytes32 accepted; dispute only recourse | **OPEN** |
| T-14 | Dispute resolution oracle manipulation (future) | Compromised oracle / owner | LOW (v2) | CRITICAL | v1 has no oracle; centralized owner; v2 will need multi-sig or DAO governance | **FUTURE RISK** |
| T-15 | Registry upgrade bricking wallets | Malicious registry deployer | LOW | HIGH | `setRegistry()` is owner-only on ARC402Wallet; owner can only upgrade own wallet | **MITIGATED** |
| T-16 | Agreement counter overflow | Griefer | NONE | NONE | Uses `unchecked{ _nextId++ }` — would require 2^256 agreements to overflow | **MITIGATED** |
| T-17 | ETH forced-send inflation | Attacker | LOW | NONE | `receive()` accepts ETH but escrow accounting is per-agreement, not by balance | **ACCEPTED** |

---

## Detailed Findings

### CRITICAL: T-02 — Owner Key Compromise

**Description:** The `resolveDispute()` function is gated by `onlyOwner`. In v1, the owner is a single EOA. Any party controlling the owner key can resolve ALL disputed agreements in their favour, draining the entire disputed escrow pool.

**Scenario:**
1. Attacker compromises owner private key (phishing, hardware vulnerability)
2. All agreements currently in `DISPUTED` status can be resolved `favorProvider = true`
3. Attacker receives all disputed funds

**Maximum extractable value:** Sum of all escrow in `DISPUTED` status at time of compromise. In a mature protocol, this could be millions of dollars.

**Recommendation:** Replace EOA owner with 3-of-5 multisig (Gnosis Safe) for v1 production. For v2: DAO governance or on-chain dispute resolution with randomized juror selection.

---

### HIGH: T-03 — Sybil Trust Score Farming

**Description:** Trust scores can be farmed by an attacker who: (1) controls two wallets, (2) is or can become an authorized TrustRegistry updater.

**Measured cost to reach "Autonomous" tier (score 800):**
- Initial score: 100
- Score needed: 700 points at +5 per success = 140 successful cycles
- Gas per cycle: ~496,000 (propose + accept + fulfill + recordSuccess)
- Total gas for 140 cycles: ~69.4M gas
- Cost at 0.1 gwei on Base: **~0.007 ETH (~$21 at $3,000 ETH)**

**Root cause:** `TrustRegistry.recordSuccess()` only requires `onlyUpdater` — it does not verify that an actual ServiceAgreement was fulfilled, what the agreement's value was, or how recently.

**Recommendation:**
1. Only `ServiceAgreement.sol` should be an authorized updater (remove human-managed updater list)
2. `fulfill()` in ServiceAgreement should call `trustRegistry.recordSuccess(provider)` directly
3. Add minimum agreement price threshold for score increase (e.g., 0.001 ETH or 1 USDC)
4. Add rate limiting: max 1 score increase per 24 hours per wallet

---

### HIGH: T-04 — Malicious ERC-20 Token (Permanent Fund Lock)

**Description:** Any ERC-20 token can be used as payment. A token where `transfer()` reverts but `transferFrom()` works will permanently lock funds in the contract.

**Proof from test `test_Attack4_MaliciousERC20_FundsLocked`:**
- Client proposes with malicious token: `safeTransferFrom` works (deposit succeeds)
- Provider fulfills: `safeTransfer` calls `transfer()` which reverts
- `resolveDispute()` also fails for the same reason
- Result: 500e18 tokens permanently locked, unrecoverable by any party

**Recommendation:**
1. Token allowlist (preferred for v1 production)
2. Owner emergency withdrawal function (safety net only — use with governance)
3. Use balance-before/after pattern to detect fee-on-transfer issues

---

### HIGH: T-10 — Fee-on-Transfer Token Accounting

**Description:** If a fee-on-transfer token is used, `propose()` records `price` in the agreement struct but the contract actually holds `price - fee`. When `fulfill()` tries to release `price`, it will revert (insufficient balance) or release less than expected.

**Example:**
- Token charges 1% fee on transfer
- Client approves and calls `propose(price = 1000 USDC)`
- Contract receives 990 USDC (1% fee)
- Agreement records `price = 1000`
- `fulfill()` calls `safeTransfer(provider, 1000)` — reverts (only 990 available)

**Status:** Similar to T-04 — permanently locks funds for fee-on-transfer tokens.

**Recommendation:** Token allowlist with vetted, fee-free tokens only.

---

### MEDIUM: T-09 — Endpoint Bait-and-Switch

**Description:** An agent registers with a legitimate endpoint, builds reputation score, then updates their endpoint to a malicious or dead URL. Clients who selected this agent based on historical data are bait-switched post-selection.

**Root cause:** No endpoint verification, no cooldown on updates, no notification to parties with active agreements.

**Recommendation:** Emit events on endpoint update; off-chain clients should re-validate before accepting.

---

### MEDIUM: T-13 — Garbage Deliverables Hash

**Description:** `fulfill()` accepts any `bytes32` as `actualDeliverablesHash`. A provider can submit `bytes32(0)` or any nonsense value and receive payment. The hash is not verified on-chain.

**Design note:** This is intentional in v1 — full content verification is off-chain. The hash serves as a commitment, not a proof.

**Mitigation path:** Commit-reveal scheme (v2) where client must acknowledge the hash before escrow releases. This would close the "deliver nothing and get paid" attack vector.

---

## Gas Economics

Gas costs measured across all test suites (Forge, `forge test --gas-report`). These form a natural defence against griefing attacks.

| Function | Min Gas | Avg Gas | Max Gas | USD Cost @ 0.1 gwei, $3k ETH |
|----------|---------|---------|---------|-------------------------------|
| `propose()` | 29,036 | 307,141 | 407,764 | ~$0.09 avg |
| `accept()` | 31,138 | 51,564 | 52,203 | ~$0.015 |
| `fulfill()` | 33,470 | 76,856 | 103,976 | ~$0.023 |
| `cancel()` | 31,182 | 73,862 | 97,734 | ~$0.022 |
| `dispute()` | 28,984 | 34,105 | 36,702 | ~$0.010 |
| `expiredCancel()` | 33,320 | 63,226 | 70,703 | ~$0.019 |
| `resolveDispute()` | 33,516 | 61,541 | 85,972 | ~$0.018 |
| Contract Deployment | 1,661,018 | — | — | ~$0.50 |

**Griefing analysis (T-11):**
- Creating 1,000 agreements costs ~256M gas (~$0.77 at 0.1 gwei)
- Creating 10,000 agreements: ~$7.70
- Not free, but not a major deterrent for well-funded attackers
- Recommendation: add minimum `price` floor (e.g., 0.001 ETH) to make griefing materially costly

**Trust farming analysis (T-03):**
- Reaching "Autonomous" tier via Sybil farming: ~64.5M gas = **~$0.019 ETH ≈ $57 at $3k ETH**
  _(Note: measured in test with 0.1 gwei estimate; actual Base gas is often 0.01 gwei = ~$5.70)_
- This is the most critical finding from an economic security perspective

---

## Residual Risks (Accepted)

| Risk | Why Accepted |
|------|-------------|
| T-07: Deadline ±15s manipulation | Base L2 property, not ARC-402-specific. Minimum 300s deadline recommendation in docs. |
| T-11: Griefing via tiny agreements | Gas cost makes it economically rational only for well-funded attackers. No state corruption. |
| T-17: Forced ETH send | Cosmetic accounting mismatch only. Escrow is per-agreement, not balance-dependent. |
| T-12: Client ghosting | Non-issue by design. Provider calls `fulfill()` unilaterally. |
| T-16: Counter overflow | 2^256 agreements is physically impossible. |

---

## Recommendations for Future Versions

### v1 Production (Before Launch)

1. **Replace EOA owner with Gnosis Safe 3-of-5 multisig** — resolves T-02
2. **Token allowlist** for ERC-20 payments — resolves T-04, T-10
3. **Minimum agreement value** (e.g., 0.001 ETH or 10 USDC) — mitigates T-03, T-11
4. **ServiceAgreement as sole TrustRegistry updater** — closes T-03 farming vector
5. **Rate limiting on trust score increases** (max 1/day per wallet) — mitigates T-03

### v2 Architecture

6. **Decentralized dispute resolution** — Kleros, UMA, or on-chain juror selection. Resolves T-02, T-14.
7. **Commit-reveal for deliverables** — client must acknowledge hash before escrow releases. Resolves T-13.
8. **Minimum stake requirement** — providers stake tokens that are slashed on dispute loss. Removes rational defection (T-05 economic analysis).
9. **Oracle integration** — Chainlink for off-chain task verification. Reduces T-13 surface.
10. **Timelock on owner actions** — 24–48 hour delay on `resolveDispute()` for amounts above threshold.

---

## Audit Trail

### What Was Tested

| Test | File | Result |
|------|------|--------|
| Flash loan + escrow drain | `ServiceAgreement.economic.t.sol` | BLOCKED |
| Reentrancy on ETH release | `ServiceAgreement.economic.t.sol` | BLOCKED (ReentrancyGuard) |
| MEV front-running on propose() | `ServiceAgreement.economic.t.sol` | BLOCKED (msg.sender binding) |
| Agreement ID griefing (1000 agreements) | `ServiceAgreement.economic.t.sol` | EXPENSIVE, no corruption |
| Malicious ERC-20 (revert on transfer) | `ServiceAgreement.economic.t.sol` | **FUNDS LOCKED — OPEN** |
| Economic rational defection (game theory) | `ServiceAgreement.economic.t.sol` | Documented, manageable |
| Sybil trust score farming | `ServiceAgreement.economic.t.sol` | **CHEAP — OPEN** |
| Deadline manipulation (±15s) | `ServiceAgreement.economic.t.sol` | ACCEPTED RISK |
| Core state machine (propose/accept/fulfill) | `ServiceAgreement.t.sol` | PASS (15 tests) |

### Tools Used

- **Forge** (Foundry) — unit tests, fuzz-ready structure
- **Gas Reporter** — `forge test --gas-report` for all core functions
- **Forge Cheatcodes** — `vm.prank`, `vm.warp`, `vm.deal`, `vm.expectRevert`
- **Manual code review** — state machine transitions, CEI pattern verification, access control

### What Was NOT Tested

- Formal verification (Certora, Halmos) — recommended before mainnet
- Fuzzing / invariant testing — no `invariant_*` tests written yet
- Cross-contract interaction with PolicyEngine and IntentAttestation
- ERC-4337 account abstraction compatibility
- Actual Base L2 deployment and sequencer interaction
- Token standards beyond ERC-20 (ERC-777 reentrancy hooks not tested)
- Front-running of `resolveDispute()` by monitoring mempool

---

## Risk Summary

| Category | Finding Count | Severity Distribution |
|----------|--------------|----------------------|
| Critical | 1 | T-02: Owner key compromise |
| High | 3 | T-03: Trust farming, T-04: Malicious ERC-20, T-10: Fee-on-transfer |
| Medium | 3 | T-08: Self-dealing, T-09: Endpoint bait-and-switch, T-13: Garbage hash |
| Low | 2 | T-07: Deadline manipulation, T-11: Griefing |
| Mitigated | 5 | T-01, T-05, T-06, T-15, T-16 |
| Accepted | 3 | T-07, T-11, T-17 |
| N/A | 1 | T-12 |

**Maximum Extractable Value (0-day scenario):**
If an attacker found a critical reentrancy bypass or compromised the owner key, the maximum extractable value equals the **sum of all ETH and ERC-20 escrowed across all active agreements** at that moment. There is no cap. For a protocol processing $1M/day in agreements, peak exposure could be in the millions.

**Overall Risk Posture:** The escrow mechanics are sound (ReentrancyGuard, CEI pattern, msg.sender binding). The primary risks are in the **governance layer** (owner key) and the **trust layer** (unconstrained updater access). Neither is a cryptographic flaw — both are operational/design decisions that can be remediated before production launch.

---

*Threat Model v1.0 — ARC-402 Economic Audit Layer — 2026-03-11*  
*Generated by: Forge Engineering (automated economic simulation + manual analysis)*  
*Next review: Before v1 mainnet deployment*
