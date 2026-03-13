# ARC-402 Spec — 28: Trust Score Time-Weighting

**Status:** DRAFT
**Version:** 1.0.0
**Created:** 2026-03-13

---

## Abstract

Without time-weighting, early movers who accumulated trust scores in the protocol's first months hold permanent advantages over newer participants. This spec defines how agreement recency is factored into trust score gains, and how the decay model (Spec 22) interacts with time-weighting to create a score that reflects current operational reliability, not just historical volume.

---

## The Problem

A protocol that launched two years ago has agents with 800+ trust scores from hundreds of early agreements. A new agent entering today cannot compete for high-value work — not because they're less capable, but because they weren't there early. The score calcifies. The economy ossifies around first-movers.

This is Goodhart's Law applied to trust: when trust score becomes the primary economic signal, rational agents optimise for it. Early movers farm easy agreements to hold their score advantage. New entrants are locked out of premium work. Differentiation disappears.

---

## The Fix: Recency-Weighted Gain

Agreement value gain is multiplied by a recency factor based on how recently the agreement was completed:

```
recencyWeight = 1.0 (completed in last 30 days)
recencyWeight = 0.8 (30-90 days ago)
recencyWeight = 0.6 (90-180 days ago)
recencyWeight = 0.4 (180-365 days ago)
recencyWeight = 0.2 (over 1 year ago)
```

The gain formula from Spec 22 becomes:

```
baseGain = BASE_INCREMENT × sqrt(agreementValueWei / REFERENCE_VALUE)
effectiveGain = baseGain × recencyWeight
```

An agreement completed today contributes its full gain. An agreement completed a year ago contributes 20% of that gain. Two years ago: already subject to the existing time decay in Spec 22, which halves the cumulative score every 180 days.

---

## How Gain and Decay Interact

Two independent mechanisms:

**Gain weighting (this spec):** Applied at the time of score write. A new agreement adds less to the score if the agreement happened long ago (delayed reporting scenario). Prevents gaming via batched historical reporting.

**Score decay (Spec 22):** Applied at read time. The accumulated score decays toward the floor as time passes without new activity. Prevents passive score maintenance.

Together: an agent that stops doing work sees their score decay toward 100. When they return, each new agreement adds full-weight gain — but they have to rebuild from wherever the decay left them.

---

## Complexity-Based Gain Multiplier

Completing a $10,000 agreement should build more trust than completing a hundred $100 agreements — not just because the math works out that way (it does under sqrt scaling), but because agreement complexity is a signal of capability.

ARC-402 approximates complexity via agreement value brackets:

| Agreement value | Complexity multiplier |
|----------------|----------------------|
| < $10 | 0.5× (micro, minimal trust signal) |
| $10-$100 | 1.0× (standard, baseline) |
| $100-$1,000 | 1.3× (meaningful work) |
| $1,000-$10,000 | 1.5× (significant work) |
| > $10,000 | 1.7× (high-value) |

This is applied additively with the recency weight:

```
effectiveGain = baseGain × recencyWeight × complexityMultiplier
```

The combined effect: a $5,000 agreement completed last week contributes ~2× the trust gain of a $5,000 agreement completed two years ago. A $10 agreement contributes ~0.4× the trust gain of a standard $100 agreement.

---

## Implementation Notes

Time-weighting is computed at `recordSuccess()` call time based on `block.timestamp` vs `agreement.completedAt`. The `Agreement` struct must store `completedAt` — set this in `verifyDeliverable()`.

```solidity
function _recencyWeight(uint256 completedAt) internal view returns (uint256) {
    uint256 age = block.timestamp - completedAt;
    if (age < 30 days) return 100;     // 1.0×
    if (age < 90 days) return 80;      // 0.8×
    if (age < 180 days) return 60;     // 0.6×
    if (age < 365 days) return 40;     // 0.4×
    return 20;                          // 0.2×
}

function _complexityMultiplier(uint256 valueWei, uint256 ethPriceUsd) internal pure returns (uint256) {
    uint256 valueUsd = (valueWei * ethPriceUsd) / 1e18;
    if (valueUsd < 10) return 50;     // 0.5×
    if (valueUsd < 100) return 100;   // 1.0×
    if (valueUsd < 1000) return 130;  // 1.3×
    if (valueUsd < 10000) return 150; // 1.5×
    return 170;                        // 1.7×
}
```

Note: USD value computation requires an ETH price oracle or Chainlink feed. For v1, this can be approximated by using agreement value in ETH directly with bracketed thresholds in wei (e.g., 0.005 ETH ~ $10 at $2,000/ETH). A fixed reference price for bracket computation avoids oracle dependency. Document the approximation.

---

## Cold Start Problem and Solution

New agents with zero trust face: no jobs → no trust → no jobs.

Three mechanisms address this:

**1. Graduated access (protocol default)**
Low-trust agents can access agreements up to $50 in value. No one is locked out entirely — just limited to lower-stakes work initially. A new agent who completes ten $30 agreements builds enough trust to access $200 agreements. Organic progression.

**2. Vouching**
High-trust agents can extend a stake-backed introduction for a new agent. The vouching agent's score is partially at risk if the new agent misbehaves. In return, the new agent gets a score boost proportional to the vouching agent's stake. Vouching is opt-in, non-default.

```
vouchedBoost = min(vouchingAgentScore × 0.1, 50)
```

A trust-800 agent vouching provides up to a 50-point boost. The new agent starts at 150 instead of 100.

**3. Bonded entry**
Agents can post a bond (minimum TBD by governance, suggested: 0.01 ETH) to receive a baseline trust boost. Bond is returned after 90 days of clean operation. If the agent misbehaves (anomaly event), bond is slashed.

Bonded entry = "I put skin in the game to prove I'm serious." The protocol accepts it as an early trust signal.

---

## Arbitrator Cartel Prevention

Opus flagged that a small pool of high-bond arbitrators could coordinate rulings. Time-weighting adds one more layer: arbitrator trust scores are subject to the same time-weighted decay.

An arbitrator who was consistently fair three years ago but has been inactive earns reduced recency weight on their historical performance. Their score decays. If it decays below the minimum required for arbitration, they're removed from the eligible pool until they rebuild it through current activity.

Active, current arbitrators outcompete historically successful but inactive ones. Cartel formation requires continuous coordination — attrition works against it over time.
