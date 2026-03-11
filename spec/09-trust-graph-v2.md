# Trust Registry v2: Capability-Specific Sybil-Resistant Trust

**Status:** DRAFT  
**Version:** 0.1.0  
**Authors:** TBD  
**Created:** 2026-03-11  
**Supersedes:** `03-trust-primitive.md` (v1 global score), `reference/contracts/TrustRegistry.sol`

---

## Abstract

TrustRegistry v1 stores a single global score (0–1000) per wallet. A wallet that has completed 140 micro-tasks worth $0.01 each reaches Autonomous tier (800 points) for $1.40 in agreement value, plus gas. It conflates capability domains — a wallet trusted for "compute" tasks is treated identically to one trusted for "legal-research" when hiring for either. It gives equal weight to a $1 agreement and a $10,000 agreement. It does not decay, so a wallet that transacted two years ago carries the same score today. And it can be farmed by a single actor operating both sides of repeated self-agreements.

TrustRegistry v2 replaces the single score with six interlocking mechanisms: capability-specific scores, counterparty diversity requirements, value-weighted trust gains, time decay toward a floor, asymmetric dispute penalties, and a configurable minimum agreement value. The combined effect raises the cost of reaching Autonomous tier from ~$1.40 to >$50,000 in productive agreement value, while preserving the existing global score as a starting point for migrated wallets.

---

## Motivation

### Why v1 Is Insufficient for a Marketplace

v1 was designed for a single-operator context: one deployer controlling which wallets get trust updates, one score that gates spending authority. In a multi-agent marketplace, the assumptions change:

**Unknown counterparties.** A marketplace agent doesn't know if the high-trust wallet requesting its services earned that trust through 140 legitimate $10K agreements or 140 self-dealt $0.01 micro-tasks. The score looks identical.

**Domain mismatch.** A wallet with score 850 in code-review tasks is autonomously trusted in the legal-research marketplace. Trust should transfer within domains, not across them.

**Stale trust.** A wallet that reached 900 in 2024 and has been dormant since carries full Autonomous authority in 2026. Trust without recency is an oracle for past behaviour, not present reliability.

**Cheap farming.** v1's attack surface is trivial. A single actor creates two wallets, deploys a minimal ServiceAgreement, and calls `recordSuccess()` on both sides. Repeat 140 times. Total cost: $1.40 + ~0.005 ETH in gas. Result: one Autonomous-tier wallet.

### Sybil Attack Cost: v1 vs v2

| Scenario | v1 Cost | v2 Cost |
|----------|---------|---------|
| Reach Autonomous (800 pts from 100 baseline) | ~$1.40 + gas | See §8 |
| Single counterparty farming | $1.40 + gas | $0 trust gain beyond 10th deal |
| $0.01 micro-task farming | $1.40 + gas | Blocked by minimum value floor |
| Dormant wallet retains Autonomous | Forever | Decays to ~500 after 12 months inactive |

v2 makes farming economically comparable to actually doing the work.

---

## Design

### Mechanism 1: Capability-Specific Trust

Trust is multidimensional. Each wallet maintains a trust profile segmented by capability domain.

**Capability** is a string tag matching the `serviceType` field in `AgentRegistry` and `ServiceAgreement`. Examples: `"legal-research"`, `"code-review"`, `"medical-transcription"`, `"compute"`, `"data-labeling"`.

**Trust profile example:**

```
Agent 0xB3a7...f91c trust profile:
  global:               720
  legal-research:       891  (23 agreements, 22 fulfilled, $45,200 total)
  code-review:          340  (5 agreements, 4 fulfilled, $2,100 total)
  medical-transcription:  0  (unrated)
```

The `global` score is a weighted average across all capability scores, weighted by agreement count. A wallet with zero capability scores inherits its migrated v1 score as its global score.

**Global score formula:**

```
global = Σ(capability_score_i * agreement_count_i) / Σ(agreement_count_i)

If Σ(agreement_count_i) == 0: global = migrated_v1_score
```

**Score initialization:** New wallets start at 100 (the INITIAL_SCORE constant from v1) for global and 0 for all capabilities. Capability scores are only initialized on first agreement in that domain, starting at 100 when the first qualifying agreement completes.

#### Capability Identity

Capabilities are hashed on-chain for storage efficiency:

```solidity
bytes32 capabilityKey = keccak256(abi.encodePacked(capability));
```

The human-readable string is never stored on-chain. Callers pass the string; the contract hashes it. This caps capability key storage at 32 bytes regardless of string length.

---

### Mechanism 2: Counterparty Diversity Requirement

Repeated agreements with the same counterparty yield diminishing trust returns. This kills self-dealing: an actor cannot reach high trust by cycling agreements between two wallets they control.

**Decay schedule:**

| Deal number with same counterparty | Trust boost multiplier |
|------------------------------------|------------------------|
| 1st | 100% (full boost) |
| 2nd | 50% |
| 3rd | 25% |
| 4th | 12.5% |
| 5th | 6.25% |
| 6th | 3.125% |
| 7th–9th | <2% |
| 10th+ | ~0% (rounds to 0) |

**Formula:**

```
boost_multiplier = 1 / (2 ** min(deal_count - 1, 10))
effective_increment = base_increment * boost_multiplier
```

Where `deal_count` is the number of prior completed agreements between this wallet and this specific counterparty in this capability domain. First deal: `deal_count = 0`, so `boost_multiplier = 1/1 = 1.0`.

**On-chain storage:**

```solidity
// wallet → counterparty → capability_key → deal count
mapping(address => mapping(address => mapping(bytes32 => uint256))) public dealCount;
```

Each successful `recordSuccess()` call increments `dealCount[wallet][counterparty][capabilityKey]` after computing the trust gain.

**Integer approximation** (Solidity has no native float):

```solidity
// Pre-compute multiplier table: 10000 = 100%, 5000 = 50%, etc.
uint256[11] memory MULTIPLIERS = [10000, 5000, 2500, 1250, 625, 312, 156, 78, 39, 19, 0];
uint256 idx = dealCount < 10 ? dealCount : 10;
uint256 effective_increment = (base_increment * MULTIPLIERS[idx]) / 10000;
```

---

### Mechanism 3: Value-Weighted Trust

A $10,000 agreement is stronger evidence of capability than a $1 agreement. Trust gains scale with the square root of agreement value, anchored at $100 as the reference point.

**Formula:**

```
trust_gain = base_increment * sqrt(agreement_value_usd / 100)
```

| Agreement value | Multiplier | Trust gain (base = 5) |
|-----------------|------------|-----------------------|
| $1 | 0.1× | 0.5 pts |
| $10 | 0.316× | 1.58 pts |
| $100 | 1.0× | 5 pts (reference) |
| $1,000 | 3.16× | 15.8 pts |
| $10,000 | 10× | 50 pts |
| $100,000 | 31.6× | 158 pts |

Square root scaling prevents a single massive agreement from dominating the score while still giving meaningful weight to high-value work.

**Maximum trust gain per agreement:** capped at `5 * base_increment` (25 points at base=5). This prevents a single $250K+ agreement from leapfrogging tiers.

**USD value determination on-chain:**

| Payment token | USD conversion method |
|--------------|----------------------|
| USDC / USDT / DAI | 1:1 peg. No oracle needed. `value_usd = agreement_price / 1e6` (for 6-decimal USDC) |
| WETH / ETH | Chainlink ETH/USD price feed. `value_usd = (price * eth_amount) / 1e26` (price in 8 dec, ETH in 18 dec) |
| Other ERC-20 | Requires registered price feed. If no feed registered, agreement is ineligible for trust update. |
| ETH (direct) | Same as WETH via Chainlink. |

**Chainlink feed address** is stored as a contract-level config, updatable by the owner:

```solidity
AggregatorV3Interface public ethUsdFeed;
```

**Fallback:** If the Chainlink feed is stale (last update > 24 hours), the contract uses a configured `ethFloorPrice` (e.g., 2000 USD/ETH) as a conservative lower bound. This means ETH-denominated agreements may undercount trust gain but never overclaim it.

**Integer square root:** Solidity requires an integer approximation. Use Babylonian method with fixed-point arithmetic at 1e6 precision to avoid rounding the result to 0 for small values.

---

### Mechanism 4: Time Decay

Trust earned in the past counts less than trust earned recently. An agent that was highly active two years ago but has been dormant is a weaker signal than an agent active last month.

**Model:** Rather than running an on-chain decay job (impossible), the stored score is the "peak earned score." Effective score is computed at read time by applying a half-life decay toward the floor.

**Formula:**

```
effective_score = FLOOR + (stored_score - FLOOR) * decay_factor(t)

decay_factor(t) = 0.5 ^ (t / HALF_LIFE)

where:
  t         = time since last qualifying agreement (seconds)
  HALF_LIFE = 15,778,800 seconds (≈ 6 months)
  FLOOR     = 100 (the INITIAL_SCORE)
```

**Decay table (stored score = 900, floor = 100):**

| Inactivity period | decay_factor | effective_score |
|-------------------|--------------|-----------------|
| 0 months | 1.00 | 900 |
| 3 months | 0.707 | 665 |
| 6 months | 0.500 | 500 |
| 12 months | 0.250 | 300 |
| 24 months | 0.063 | 150 |
| 36 months | 0.016 | 113 |
| ∞ | 0 | 100 (floor) |

An Autonomous agent (900 score) that goes completely dormant falls to Standard tier (300–599) after ~12 months of inactivity, and back near baseline within 3 years.

**What counts as activity:** Any `recordSuccess()` call (for either party) resets `lastUpdated` to the current block timestamp. Anomaly recordings also reset `lastUpdated` — the agent is active, just penalised.

**Storage:**

```solidity
struct TrustProfile {
    uint256 globalScore;          // stored score (not decayed)
    uint256 lastUpdated;          // block.timestamp of last qualifying activity
    bytes32 capabilityProfileHash; // IPFS CIDv1 hash of full off-chain profile
}
```

`getEffectiveScore()` applies the decay formula at read time. `getGlobalScore()` returns the raw stored score. Contracts that need on-chain gating MUST use `getEffectiveScore()`.

**Integer decay approximation:** The decay exponent `0.5^(t/HALF_LIFE)` is approximated using integer arithmetic. Pre-compute `decay_factor` as a fraction (numerator/denominator) using bit-shifting, accurate to 1 part in 1000 for intervals up to 10 years.

---

### Mechanism 5: Dispute Penalty Asymmetry

Dispute outcomes are deliberately asymmetric to make gaming via self-dispute unprofitable.

| Dispute outcome | Trust change (v1) | Trust change (v2) |
|-----------------|-------------------|--------------------|
| Win dispute (your claim upheld) | +5 | +5 |
| Lose dispute (your claim rejected) | -20 | -50 |

**Rationale:** In v1, a self-dealing actor who controls both sides of a dispute can "win" on one wallet and "lose" on another, netting +5 - 20 = -15 across both wallets. With v2 penalty, the same scenario nets +5 - 50 = -45. The losing wallet loses far more than either side gains.

**Compound interaction with counterparty diversity:** The winning side's +5 is subject to the counterparty diversity multiplier. If the two wallets have dealt 10+ times, the winner gains 0 trust. The loser still takes -50. Self-dispute farming becomes strictly loss-making after the 5th cycle.

**Dispute resolution authority:** Same as v1. Only an authorized updater (typically the `ServiceAgreement` contract's dispute resolution path) can call `recordDispute(winner, loser, capability, value)`.

---

### Mechanism 6: Minimum Agreement Value (Anti-Farming Floor)

Agreements below the minimum value floor complete and pay out normally — the payment mechanism is unaffected. But they do not trigger trust score updates.

**Default minimums:**

| Capability | Minimum agreement value | Rationale |
|------------|------------------------|-----------|
| `compute` | $0.10 | Commodity tasks; small agreements are legitimate |
| `data-labeling` | $0.50 | Micro-task market; floor deters pure farming |
| `code-review` | $5.00 | Meaningful work floor |
| `content-generation` | $2.00 | Mid-range content tasks |
| `legal-research` | $50.00 | High-stakes domain; $50 minimum signals real work |
| `medical-transcription` | $25.00 | Regulated domain; high quality bar |
| `*` (default) | $1.00 | Any unregistered capability |

**Configuration:** Per-capability minimums are stored on-chain in a mapping, updatable by the contract owner:

```solidity
mapping(bytes32 => uint256) public capabilityMinimumUsd; // stored as cents (uint256)
uint256 public defaultMinimumUsd; // cents
```

Owner can set `capabilityMinimumUsd[keccak256("legal-research")] = 5000` (= $50.00).

**Anti-farming economics with v2 floors:**

To reach Autonomous tier (800 pts) from initial score (100 pts) = 700 points needed.

With counterparty diversity, an actor must use unique counterparties. After the first agreement with each counterparty, subsequent deals with that counterparty yield <50% trust. To maximize farming, they need a new counterparty for every deal.

At `legal-research` minimum ($50, base_increment = 5 pts/agreement):
- 700 points needed
- $50 minimum × 140 unique counterparties = $7,000 in agreement value minimum
- Plus: each counterparty wallet needs funds to pay, so actor needs $7,000 in actual deployed capital
- Plus: gas for 140 `propose()` + `fulfill()` + `recordSuccess()` calls ≈ 0.5 ETH at current gas
- Plus: must operate 140 distinct wallets (defeats single-actor control)

**At scale (reaching 900, the mid-Autonomous tier):**

| Capability | Min value | Agreements needed | Min capital required |
|------------|-----------|-------------------|----------------------|
| `compute` | $0.10 | 160 unique CPs | $16 + gas |
| `code-review` | $5.00 | 160 unique CPs | $800 + gas |
| `legal-research` | $50.00 | 160 unique CPs | $8,000 + gas |

This is the remaining v2 weakness: `compute` at $0.10 minimum is still farmable at low cost. The defense is that `compute` trust doesn't transfer to `legal-research` hiring decisions. A hiring agent for legal work checks `getCapabilityScore(wallet, "legal-research")`, not the compute score.

---

## Storage Model

### On-Chain Storage (per wallet)

| Field | Type | Size | Notes |
|-------|------|------|-------|
| `globalScore` | `uint256` | 32 bytes | Stored score, pre-decay |
| `lastUpdated` | `uint256` | 32 bytes | Unix timestamp |
| `capabilityProfileHash` | `bytes32` | 32 bytes | IPFS CIDv1 hash of full profile |
| Top-5 capability scores | `mapping(bytes32 => uint256)` | 32 bytes × 5 = 160 bytes | Inline on-chain |
| Top-5 capability metadata | `mapping(bytes32 => CapabilityMeta)` | ~96 bytes × 5 = 480 bytes | Count + total value |
| `dealCount[cp][cap]` | `mapping(mapping(uint256))` | 32 bytes per entry | Grows with unique counterparties |

**Estimated gas per `recordSuccess()` call (warm storage):**
- Global score update: ~5,000 gas
- One capability score update: ~5,000 gas
- Deal count increment: ~5,000 gas
- IPFS hash update (if profile changed): ~5,000 gas
- Events: ~2,000 gas
- **Total: ~22,000–30,000 gas per call**

At 20 gwei gas price and $3,000 ETH: ~$1.80 per trust update. This is the gas floor that makes micro-farming painful — 140 agreements × $1.80 = $252 in gas alone at these prices.

### Off-Chain Storage (IPFS)

The full capability profile is stored off-chain as a JSON document pinned to IPFS. The on-chain `capabilityProfileHash` is the CIDv1 of this document, updated whenever any capability score changes.

**Full profile JSON schema:**

```json
{
  "wallet": "0xB3a7...f91c",
  "version": 2,
  "globalScore": 720,
  "lastUpdated": 1741699200,
  "capabilities": {
    "legal-research": {
      "score": 891,
      "agreementCount": 23,
      "fulfilledCount": 22,
      "totalValueUsd": 45200,
      "lastActivity": 1741699200
    },
    "code-review": {
      "score": 340,
      "agreementCount": 5,
      "fulfilledCount": 4,
      "totalValueUsd": 2100,
      "lastActivity": 1738800000
    }
  }
}
```

**Pinning responsibility:** The authorized updater (typically the `ServiceAgreement` contract's offchain relay or a dedicated trust oracle) is responsible for pinning updated profiles and submitting the new CIDv1 hash on-chain. The on-chain hash is ground truth; the IPFS content is the extended record.

**On-chain top-5 rule:** The 5 capabilities with the highest `agreementCount` are stored inline on-chain for gas-efficient read access. All others live in the IPFS profile. When queried, `getCapabilityScore()` first checks on-chain storage; if not found, returns 0 and the caller should fetch the full profile via the IPFS hash.

---

## Migration Path

### v1 → v2 Migration

**Principle:** No wallet loses trust in the migration. All existing v1 scores are preserved as the starting `globalScore` in v2. The wallet is not penalised for having no capability scores — it simply starts with a blank capability slate and a credible global score.

**Migration steps:**

1. **Deploy TrustRegistryV2** with the v1 registry address as a constructor parameter.
2. **Lazy migration:** On first interaction with a wallet in v2, if no v2 profile exists, read the v1 score via `ITrustRegistry.getScore(wallet)` and initialize the v2 profile with:
   - `globalScore = v1_score`
   - `lastUpdated = block.timestamp` (no decay penalty for migration day)
   - `capabilityProfileHash = bytes32(0)` (empty profile)
   - All capability scores: uninitialized (treated as 0)
3. **No forced migration:** Wallets that never interact with v2 remain readable from v1. Hiring agents that haven't upgraded still see v1 scores.
4. **Sunset v1:** After a 6-month migration window, v1's authorized updaters are removed. New `ServiceAgreement` deployments point to v2. v1 scores freeze and begin decaying by v2 rules (which apply the decay from `lastUpdated = migration_date`).

**Migration mapping storage:**

```solidity
mapping(address => bool) public migratedFromV1;
ITrustRegistry public immutable v1Registry;
```

**Risk:** Wallets that legitimately earned 800+ on v1 now have a `global` of 800+ but all capability scores at 0. A hiring agent checking `getCapabilityScore(wallet, "legal-research")` will see 0. This is intentional — past trust was domain-agnostic, new trust is domain-specific. Migrated wallets need to re-establish capability scores through real agreements.

To soften this: the hiring agent SHOULD fall back to `getEffectiveScore()` (global) when capability score is 0 and the global score is Elevated or above, with a note in the discovery layer. This fallback is a UX recommendation, not a contract requirement.

---

## Interface

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ITrustRegistryV2 {

    // ─── Structs ────────────────────────────────────────────────────────────

    struct TrustProfile {
        uint256 globalScore;           // Stored score (pre-decay); use getEffectiveScore() for gating
        uint256 lastUpdated;           // block.timestamp of last qualifying activity
        bytes32 capabilityProfileHash; // IPFS CIDv1 of full capability JSON profile
    }

    struct CapabilityScore {
        uint256 score;           // Stored capability score (pre-decay)
        uint256 agreementCount;  // Total completed agreements in this capability
        uint256 fulfilledCount;  // Agreements fulfilled without dispute
        uint256 totalValueUsd;   // Cumulative USD value (in cents) of all qualifying agreements
        uint256 lastUpdated;     // block.timestamp of last qualifying activity in this capability
    }

    // ─── Events ─────────────────────────────────────────────────────────────

    event GlobalScoreUpdated(
        address indexed wallet,
        uint256 oldScore,
        uint256 newScore,
        string reason
    );

    event CapabilityScoreUpdated(
        address indexed wallet,
        bytes32 indexed capabilityKey,
        string capability,
        uint256 oldScore,
        uint256 newScore,
        uint256 agreementValueUsd
    );

    event ProfileHashUpdated(
        address indexed wallet,
        bytes32 oldHash,
        bytes32 newHash
    );

    event WalletMigrated(
        address indexed wallet,
        uint256 v1Score,
        uint256 v2GlobalScore
    );

    // ─── Updates ────────────────────────────────────────────────────────────

    /// @notice Record a successful agreement fulfillment.
    /// @param wallet       The wallet that fulfilled the agreement (provider)
    /// @param counterparty The wallet on the other side (client)
    /// @param capability   Human-readable capability string (hashed internally)
    /// @param agreementValueWei Agreement payment in wei (ETH) or token base units
    /// @param paymentToken ERC-20 token address, or address(0) for ETH
    function recordSuccess(
        address wallet,
        address counterparty,
        string calldata capability,
        uint256 agreementValueWei,
        address paymentToken
    ) external;

    /// @notice Record an anomaly or failed agreement.
    /// @param wallet       The wallet penalised
    /// @param counterparty The wallet on the other side
    /// @param capability   Human-readable capability string
    /// @param agreementValueWei Agreement value (for record-keeping; not used in penalty calc)
    /// @param paymentToken ERC-20 token address, or address(0) for ETH
    function recordAnomaly(
        address wallet,
        address counterparty,
        string calldata capability,
        uint256 agreementValueWei,
        address paymentToken
    ) external;

    /// @notice Record a dispute outcome. Applies +5 to winner and -50 to loser.
    /// @param winner    The wallet whose claim was upheld
    /// @param loser     The wallet whose claim was rejected
    /// @param capability The capability domain of the disputed agreement
    function recordDispute(
        address winner,
        address loser,
        string calldata capability
    ) external;

    /// @notice Update the IPFS profile hash for a wallet (after off-chain profile update).
    /// @param wallet  The wallet whose profile was updated
    /// @param newHash The new IPFS CIDv1 hash
    function updateProfileHash(address wallet, bytes32 newHash) external;

    // ─── Reads ──────────────────────────────────────────────────────────────

    /// @notice Raw stored global score (no decay applied).
    function getGlobalScore(address wallet) external view returns (uint256);

    /// @notice Effective global score with time decay applied. Use this for trust gating.
    function getEffectiveScore(address wallet) external view returns (uint256);

    /// @notice Raw stored capability score for a specific domain (no decay applied).
    function getCapabilityScore(address wallet, string calldata capability) external view returns (uint256);

    /// @notice Effective capability score with time decay applied.
    function getEffectiveCapabilityScore(address wallet, string calldata capability) external view returns (uint256);

    /// @notice Full on-chain trust profile.
    function getProfile(address wallet) external view returns (TrustProfile memory);

    /// @notice Full on-chain capability metadata (for top-5 on-chain capabilities).
    function getCapabilityMeta(address wallet, string calldata capability) external view returns (CapabilityScore memory);

    /// @notice Number of deals between wallet and counterparty in a capability.
    function getDealCount(address wallet, address counterparty, string calldata capability) external view returns (uint256);

    // ─── Discovery ──────────────────────────────────────────────────────────

    /// @notice Check whether a wallet meets a minimum effective score, optionally in a specific capability.
    /// @param wallet      The wallet to check
    /// @param minScore    Required minimum effective score
    /// @param capability  Capability domain to check ("" or "*" for global score check)
    function meetsThreshold(
        address wallet,
        uint256 minScore,
        string calldata capability
    ) external view returns (bool);

    /// @notice Return the trust tier label for a wallet's effective global score.
    function getTrustLevel(address wallet) external view returns (string memory);

    // ─── Configuration ──────────────────────────────────────────────────────

    /// @notice Set the minimum agreement value (in USD cents) for a capability.
    function setCapabilityMinimum(string calldata capability, uint256 minimumUsdCents) external;

    /// @notice Set the default minimum agreement value for unregistered capabilities.
    function setDefaultMinimum(uint256 minimumUsdCents) external;

    /// @notice Register or update a price feed for a payment token.
    function setPriceFeed(address token, address feed) external;
}
```

---

## Attack Cost Analysis

### v2 Attack: Reaching Autonomous Tier (800 pts)

**Assumptions:**
- Base increment: 5 pts per qualifying agreement
- Starting score: 100 (INITIAL_SCORE)
- Target: 800 (bottom of Autonomous tier)
- Points needed: 700
- Attacker controls both sides of agreements (but counterparty diversity applies)

**Scenario A: `compute` capability (minimum $0.10)**

With counterparty diversity, the attacker needs a new unique counterparty wallet for maximum efficiency. Each new counterparty yields 100% of base increment.

At $0.10 per agreement, value scaling: `sqrt(0.10/100) = 0.0316`. Trust gain = `5 × 0.0316 = 0.158 pts`.

Agreements needed = `700 / 0.158 = 4,430 agreements`.

Each agreement: $0.10 minimum + ~$2 in gas (estimate) = ~$2.10.

**Total cost: ~$9,300 for a single Autonomous compute wallet.**

With 4,430 unique counterparties: attacker needs to fund 4,430 wallets with $0.10 each + gas = another $9,300+ to fund counterparties.

**Total deployed capital: ~$18,600 + gas.**

**Scenario B: `legal-research` capability (minimum $50)**

Value scaling: `sqrt(50/100) = 0.707`. Trust gain = `5 × 0.707 = 3.54 pts`.

Agreements needed = `700 / 3.54 = 198 agreements` with unique counterparties.

Agreement cost: $50 minimum + ~$2 gas = $52.

**Total cost: ~$10,296 for a single Autonomous legal-research wallet.**

But: requires 198 distinct counterparty wallets, each funded with $50+ = $9,900 in counterparty capital.

**Total deployed capital: ~$20,000.**

**Scenario C: Maximum-value agreements ($10,000 each, `legal-research`)**

Value scaling: `sqrt(10000/100) = 10`. Trust gain = `5 × 10 = 50 pts` (hits cap of 25 pts — capped at 5× base).

With cap: 25 pts per agreement. Agreements needed = `700 / 25 = 28`.

28 × $10,000 = $280,000 in agreement value, plus counterparty funding.

This path is economically equivalent to doing real work: an attacker deploying $280K in legitimate agreements would reach Autonomous naturally and actually earn the trust.

### v1 vs v2 Headline Comparison

| | v1 | v2 (compute) | v2 (legal-research) |
|--|----|----|---|
| **Min agreements to reach Autonomous** | 140 | 4,430 | 198 |
| **Min agreement value** | $0.01 | $0.10 | $50.00 |
| **Min capital deployed** | $1.40 | ~$18,600 | ~$20,000 |
| **Unique counterparties required** | 1 | 4,430 | 198 |
| **Effective attack cost** | **$1.40** | **~$18,600** | **~$20,000** |

**v2 raises the cost of a Sybil attack by 4–5 orders of magnitude.**

The remaining cheap attack vector (compute at ~$18,600) produces compute trust only — not transferable to legal-research hiring decisions. Capability specificity compartmentalises the attack.

---

## Limitations

v2 significantly raises the cost of Sybil attacks but does not eliminate them. Known limitations:

### 1. Collusion rings
A network of 200 real agents who deliberately cycle agreements with each other (each providing genuine work) will accumulate trust faster than the counterparty diversity decay can offset. v2 has no way to distinguish a collusion ring from a legitimate professional network. Mitigation: reputation becomes expensive to fake but not impossible for well-funded coordinated actors.

### 2. Compute capability remains cheap
At $0.10 minimum and low gas prices, compute trust can be farmed for ~$18,600. This is tolerable because compute trust doesn't grant legal-research authority — but it does grant Autonomous tier for compute tasks. Mitigation: raise the compute minimum or accept that compute is a low-stakes capability.

### 3. Token price volatility
ETH-denominated agreements use a Chainlink price feed. If ETH price drops significantly between agreement proposal and fulfillment, the USD value used for trust calculation may differ from the actual economic value at proposal time. This could be exploited by timing agreements during price spikes. Mitigation: use the lower of proposal-time and fulfillment-time price (conservative bound).

### 4. IPFS availability
The full capability profile lives on IPFS. If the pin is lost and the on-chain hash becomes unresolvable, the extended profile is inaccessible. On-chain trust gating (via `meetsThreshold`) is unaffected (uses on-chain top-5 scores), but rich profile display breaks. Mitigation: require multiple pins (e.g., Pinata + self-hosted IPFS node), and build profile reconstruction from on-chain events as a fallback.

### 5. Time decay approximation error
The integer approximation of `0.5^(t/HALF_LIFE)` introduces small rounding errors (accurate to ~1 part in 1000). For edge cases near tier thresholds, a wallet may appear at one tier via `getEffectiveScore()` and drift to the adjacent tier on the next block. Mitigation: threshold checks should use a small hysteresis band (e.g., require effective score ≥ 810 for Autonomous rather than 800).

### 6. Oracle dependency
ETH pricing requires Chainlink. If the feed is unavailable, ETH-denominated agreements fall back to the configured `ethFloorPrice`. A malicious oracle could suppress trust gains. Mitigation: use Chainlink's decentralized feed, validate `updatedAt` freshness, and require the owner to update `ethFloorPrice` periodically as a manual backstop.

### 7. Capability taxonomy is not standardised
Capabilities are arbitrary strings. `"legal-research"` and `"LegalResearch"` hash to different keys and accumulate separate scores. Implementations must enforce normalisation (lowercase, hyphenated) at the application layer. The contract cannot enforce this on-chain. Mitigation: publish a canonical capability taxonomy in a separate ARC document; require marketplace UIs to normalise capability strings before contract calls.

### 8. No cross-chain portability (v2 scope)
Trust scores exist on a single chain. An agent operating on multiple chains has separate, unlinked trust profiles. Cross-chain reputation bridging is out of scope for v2 and deferred to a future spec.

---

## Summary

| Property | v1 | v2 |
|----------|----|----|
| Score dimensions | 1 (global) | N+1 (global + per-capability) |
| Self-dealing protection | None | Counterparty diversity decay |
| Value sensitivity | None ($1 = $10K) | Square root scaling |
| Time decay | SHOULD (unimplemented) | MUST (computed at read time) |
| Dispute penalty | −20 | −50 (2.5× more severe) |
| Farming floor | $0.01 (none effective) | $0.10–$50 (per capability) |
| Sybil attack cost | $1.40 | ~$18,600–$20,000 |
| Storage model | On-chain only | Hybrid (on-chain top-5 + IPFS full profile) |
| Migration | — | Lazy; v1 score → v2 global score |

TrustRegistry v2 makes trust economically meaningful. It costs real money to earn, decays without maintenance, and is specific to the domain where it was earned.
