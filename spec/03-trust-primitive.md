# Primitive 3: Trust Primitive

**Status:** DRAFT

---

## Definition

The **Trust Primitive** is an on-chain trust score that evolves with observed wallet behaviour. Spending autonomy compounds over time as the wallet demonstrates consistent, policy-compliant operation.

---

## The Problem It Solves

Today, a new agent and a proven agent operate under identical constraints. There is no mechanism for earned autonomy. Trust is binary: the wallet either has access or it doesn't.

The Trust Primitive makes autonomy a function of track record. A wallet that has processed 10,000 clean transactions, stayed within policy, and closed contexts properly has earned different authority than a wallet deployed yesterday.

---

## Trust Score

Trust is a numerical score in the range `[0, 1000]`, where:

- `0` — No history. Maximum constraints apply.
- `500` — Established. Standard operational authority.
- `1000` — Fully trusted. Maximum policy-defined autonomy.

The score is stored on-chain as a verifiable attestation, updated by the **Trust Registry** (see reference implementation).

---

## Score Components

| Component | Weight | Description |
|-----------|--------|-------------|
| `transaction_volume` | 20% | Total clean transactions completed |
| `policy_compliance` | 35% | Ratio of policy-compliant to total spending decisions |
| `context_integrity` | 25% | Contexts opened and properly closed vs abandoned/aborted |
| `escalation_accuracy` | 10% | Escalations that were genuinely required vs false escalations |
| `anomaly_history` | 10% | Penalty for detected anomalies (decays over time) |

---

## Trust Thresholds

Implementations define their own threshold-to-authority mappings. ARC-402 defines a reference mapping:

| Score Range | Authority Level | Example Effect |
|-------------|-----------------|----------------|
| 0–99 | Probationary | All transactions require explicit approval |
| 100–299 | Restricted | Category caps at 25% of policy maximum |
| 300–599 | Standard | Full policy limits active |
| 600–799 | Elevated | Daily limits may be auto-extended up to 150% |
| 800–1000 | Autonomous | Multi-step transactions without per-step approval |

These tiers are referenced by `07-agent-registry.md` for discovery filtering and by `08-service-agreement.md` for agreement trust requirements. They are the canonical tier definitions for the ARC-402 protocol.

---

## Score Updates

Trust scores update after every closed context. The update is:

```
new_score = current_score + (delta * learning_rate)
```

Where `delta` is computed from the context's compliance summary and `learning_rate` decays as score approaches 1000 (preventing runaway trust accumulation).

**Penalties are applied immediately.** An anomaly detected mid-context triggers an instant score reduction. The wallet does not wait for context close.

---

## Requirements

### MUST
- Be stored as a verifiable on-chain attestation
- Update after every closed context
- Apply penalties immediately on anomaly detection
- Be queryable by any party verifying a transaction

### SHOULD
- Decay slowly toward a baseline if the wallet is inactive (prevents stale trust)
- Be portable across chains via cross-chain attestation bridges

### MUST NOT
- Be updatable by the wallet itself
- Exceed the maximum score of 1000

---

## Trust Registry

The Trust Registry is a smart contract (see `reference/contracts/TrustRegistry.sol`) that:
- Stores current trust scores by wallet address
- Accepts score updates from authorized updater addresses
- Emits events on score changes
- Provides a view function for score verification at transaction time
