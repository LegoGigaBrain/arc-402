# ARC-402 Spec — 22: Trust Score Economics

**Status:** DRAFT
**Version:** 1.0.0
**Created:** 2026-03-13

---

## Abstract

The TrustRegistry is only useful if builders trust the scores it produces. This spec defines the economic model behind trust scores: who writes them, under what conditions, how they resist manipulation, and what a specific score means as a decision input. The goal is a score that functions as a genuine signal — not a lagging indicator, not gameable noise.

---

## Score Range and Meaning

| Score | Meaning |
|-------|---------|
| 100 | New wallet — no history. Starting floor. |
| 100–299 | Early stage. Limited history. Use with caution. |
| 300–499 | Emerging. A few completed agreements. Some pattern to read. |
| 500–699 | Established. Meaningful history. Reasonable decision basis. |
| 700–849 | Trusted. Strong history with counterparty diversity. |
| 850–1000 | Elite. Deep history, diverse counterparties, high-value agreements, no anomalies. |

**Floor:** 100. Scores never decay below 100. A wallet cannot be penalised into irrelevance — it can only lose the gains it earned.

**Ceiling:** 1000. Hard cap. Elite status requires consistent performance over time, not a single large deal.

---

## Who Writes Scores

Trust scores are written only by **authorized updaters** — contracts registered by the protocol multisig. In v1:

| Updater | Writes on event |
|---------|----------------|
| `ServiceAgreement` | Agreement verified (success) or dispute opened (anomaly) |
| `DisputeArbitration` | Arbitration verdict (success, anomaly, or split) |
| `SessionChannel` (via ServiceAgreement) | Cooperative close (success) or bad-faith close (anomaly) |

No off-chain process, no oracle, no operator can write trust scores. The write gate is enforced on-chain:

```solidity
modifier onlyUpdater() {
    require(isAuthorizedUpdater[msg.sender], "TrustRegistryV2: not authorized updater");
    _;
}
```

Only the protocol multisig can add or remove updaters via `addUpdater(address)` / `removeUpdater(address)`.

---

## Score Mechanics

### Success: How Scores Grow

On a verified agreement, both client and provider earn trust:

```
gain = BASE_INCREMENT × sqrt(agreementValueWei / REFERENCE_VALUE)
gain = min(gain, MAX_SINGLE_GAIN)
```

Where:
- `BASE_INCREMENT = 5` points
- `REFERENCE_VALUE = 0.01 ETH` (the reference anchor)
- `MAX_SINGLE_GAIN = 25` points (5× base — prevents outsized single-deal gains)

**Example gains:**

| Agreement value | sqrt multiplier | Points earned |
|----------------|-----------------|--------------|
| 0.01 ETH | 1.0× | 5 pts |
| 0.04 ETH | 2.0× | 10 pts |
| 0.25 ETH | 5.0× | 25 pts (capped) |
| 100 ETH | 100× | 25 pts (capped) |

The sqrt curve means doubling the deal size does not double the trust gain. Diminishing returns prevent a single whale deal from distorting scores.

### Anomaly: How Scores Fall

An anomaly (dispute opened, bad-faith channel close, failed arbitration) deducts:

```
penalty = ANOMALY_PENALTY = 50 points
```

50 points = the equivalent of 10 successful reference-value deals. A single bad action takes significant history to recover from.

Anomaly writes are asymmetric: one anomaly undoes approximately 10 small wins or 2 large wins. This is intentional — trust is hard to build, easy to lose.

### Time Decay

Trust scores decay toward the floor at read time (lazy evaluation — no storage updates needed):

```
elapsed = block.timestamp - profile.lastUpdated
decayFactor = 0.5 ^ (elapsed / HALF_LIFE)
currentScore = floor + (rawScore - floor) × decayFactor
```

Where:
- `HALF_LIFE = 180 days`
- `floor = DECAY_FLOOR = 100`

**What this means:** An agent with score 800 that stops operating entirely will decay toward 100 over roughly 2 years. Active agents maintain their scores through continued successful agreements.

**Why lazy:** Updating all scores on-chain continuously is gas-prohibitive. Decay is computed at read time (`currentScore(wallet)`) without touching storage.

---

## Sybil Resistance

### Counterparty Diversity

Repeated deals with the same counterparty earn diminishing returns:

```solidity
uint256 priorDeals = dealCount[wallet][counterparty][capabilityHash];
uint256 diversityMultiplier = 1 + priorDeals; // denominator
gain = baseGain / diversityMultiplier;
```

| Prior deals with same counterparty | Multiplier | Points earned (at 1× base) |
|------------------------------------|------------|---------------------------|
| 0 (first deal) | 1× | 5 pts |
| 1 | 0.5× | 2.5 pts |
| 2 | 0.33× | 1.67 pts |
| 9 | 0.1× | 0.5 pts |

**Effect:** Running 100 deals with your own controlled wallet earns roughly `5 × ln(100) ≈ 23 points`. A single large diverse deal earns the same. Sybil farming produces diminishing returns.

### Minimum Agreement Value Gate

Agreements below the minimum threshold (`minimumAgreementValue`, set by governance) produce zero trust update. No revert — just silent skip.

This prevents micro-spam: creating thousands of tiny agreements to farm trust points.

**Current minimum:** Set by protocol governance. Launch value: `0.001 ETH` (configurable).

### Value Weighting

Low-value agreements produce low trust gains. An attacker who creates 1,000 × 0.001 ETH agreements gains the same trust as a single 1 ETH agreement (roughly). Real business relationships at meaningful values earn trust faster than spam.

---

## Capability-Specific Scores

TrustRegistryV2 tracks up to 5 on-chain capability scores per wallet, in addition to a global score:

```solidity
CapabilityScore[5] internal _capabilitySlots;

struct CapabilityScore {
    bytes32 capabilityHash;
    uint256 score;
    uint256 lastUpdated;
}
```

**Why this matters:**
- An agent with trust 800 in `legal.patent-analysis.us.v1` may have trust 200 in `compute.gpu.inference.v1`
- Global score alone masks capability-specific track records
- Discovery queries can filter by capability-specific trust

**What to query:** `capabilityScore(wallet, capability)` returns the trust score for that specific capability. Falls back to global score if no capability-specific record exists.

---

## What a Score Means as a Decision Input

### Practical thresholds for discovery filters

These are starting-point recommendations. Agents set their own thresholds.

| Use case | Recommended minTrustScore |
|----------|--------------------------|
| Low-stakes micro-task (<$5) | 300 |
| Standard service agreement ($5–$100) | 500 |
| High-value agreement ($100–$1,000) | 700 |
| Critical or sensitive work | 850 |

### What a score does NOT mean

- It is not a guarantee of future performance
- It is not a measure of capability quality, only reliability
- It does not account for off-chain reputation
- A score of 700 does not mean 70% success rate — it means consistent on-chain completion over a meaningful history

### What a score DOES mean

- An on-chain track record of completed agreements, weighted by value and counterparty diversity
- Resistance to fabrication: cannot be purchased with a single large deal or farmed with micro-spam
- Decay-adjusted recency: a high score requires recent activity, not just historical performance

---

## Trust Score Lifecycle

```
New wallet registered
    │
    ▼
INITIAL_SCORE = 100 (floor)
    │
    ├── Agreement verified → +2 to +25 pts (value + diversity weighted)
    ├── Anomaly event     → -50 pts (floor: 100)
    ├── Time decay        → -X% toward floor (6-month half-life)
    │
    ▼
Score at read time = decayed current score
(lazy computation — no gas on idle wallets)
```

---

## Authorized Updater Governance

Only the protocol multisig can authorize new updaters. The expected lifecycle:

1. **v1 launch:** ServiceAgreement + DisputeArbitration as authorized updaters
2. **Post-audit:** SessionChannel write paths verified and enabled
3. **v2:** Community-submitted updater proposals via governance vote
4. **Never:** Off-chain oracles, operator-submitted scores, self-reported scores

Unauthorized write attempts revert silently. There is no backdoor.

---

## Open Questions (For Audit Attention)

1. **Score floor after anomaly cascade:** If an agent receives 10 anomalies, does score floor at 100 correctly, or can it go negative before flooring?
2. **Lazy decay and read-time gas:** Is the `currentScore()` computation gas-bounded for callers?
3. **Counterparty diversity counter overflow:** `dealCount` is uint256 — not a practical concern but verify the diminishing returns formula doesn't underflow at extreme counts.
4. **v1 migration:** First interaction with a v1-registered wallet reads the v1 score as initial global score. Verify the migration read doesn't revert on v1 wallets with unusual state.
