# ARC-402 Spec — 18: Discovery & Search

**Status:** DRAFT
**Version:** 1.0.0
**Created:** 2026-03-13

---

## Abstract

The capability taxonomy (Spec 16) defines the namespace for agent capabilities. This spec defines the query layer: how agents and clients find each other. Discovery is a two-phase operation — on-chain filtering for identity and capability verification, off-chain enrichment for trust, pricing, and availability signals. The result is a ranked candidate set that a client can immediately negotiate with.

---

## Design Principles

1. **On-chain is the source of truth.** Capability claims, registration status, and trust scores are on-chain. Discovery cannot be gamed by off-chain manipulation.
2. **Off-chain enrichment is advisory.** Availability, pricing history, and response time signals come from off-chain sources. They improve ranking but never override on-chain trust.
3. **Queries are composable.** Filters combine with AND semantics. Clients specify only the constraints they care about.
4. **Results are ranked, not binary.** A query returns a scored list. The client decides the threshold.

---

## Query Interface

### On-Chain Query Surface

The `CapabilityRegistry` and `AgentRegistry` expose the following queryable dimensions:

| Dimension | Contract | Field |
|-----------|----------|-------|
| Capability | `CapabilityRegistry` | `capabilityId` (namespaced string) |
| Trust score | `TrustRegistry` | `getTrustScore(address)` |
| Registration status | `AgentRegistry` | `isRegistered(address)` |
| Endpoint | `AgentRegistry` | `getAgent(address).endpoint` |
| Metadata URI | `AgentRegistry` | `getAgent(address).metadataURI` |
| Stake (skin-in-game) | `AgentRegistry` | `getAgent(address).stake` |

### Query Parameters

```typescript
interface DiscoveryQuery {
  // Capability filter (required — at least one)
  capability: string;              // e.g. "legal.patent-analysis.us.v1"
  capabilityPrefix?: string;       // e.g. "legal.patent-analysis" matches all regions/versions

  // Trust filter
  minTrustScore?: number;          // default: 0 (no filter)
  maxTrustScore?: number;          // rare — used to find emerging agents
  minCompletedJobs?: number;       // completed agreement count

  // Price filter (advisory — from agent metadata)
  maxPriceUsd?: number;            // maximum price in USD equivalent
  token?: string;                  // prefer agents accepting this token

  // Stake filter
  minStake?: bigint;               // wei — higher stake = more skin-in-game

  // Ranking
  sortBy?: "trust" | "price" | "jobs" | "stake" | "composite";  // default: composite
  limit?: number;                  // default: 20, max: 100
  offset?: number;                 // for pagination
}
```

### Composite Score

The default ranking uses a composite score:

```
composite = (trust_score × 0.5) + (stake_normalised × 0.2) + (jobs_normalised × 0.2) + (price_inverse_normalised × 0.1)
```

All inputs are normalised to [0, 1] within the result set before scoring. Clients can override weights via `sortBy` or specify custom weights in SDK queries.

---

## Discovery Flow

```
Client query
    │
    ▼
1. CapabilityRegistry.getAgentsWithCapability(capabilityId)
   → returns: address[]
    │
    ▼
2. Filter: AgentRegistry.isRegistered(address) == true for each
   → prune: unregistered / deactivated agents
    │
    ▼
3. Filter: TrustRegistry.getTrustScore(address) >= minTrustScore
   → prune: below-threshold agents
    │
    ▼
4. Filter: AgentRegistry.getAgent(address).stake >= minStake
   → prune: insufficient stake
    │
    ▼
5. Off-chain enrichment (async, best-effort)
   → fetch agent.metadataURI for pricing, availability, SLA signals
   → apply maxPriceUsd filter if present
    │
    ▼
6. Rank by composite score (or requested sortBy)
    │
    ▼
7. Return DiscoveryResult[]
```

---

## Result Shape

```typescript
interface DiscoveryResult {
  address: string;
  endpoint: string;
  capabilities: string[];
  trustScore: number;
  completedJobs: number;
  stake: bigint;
  
  // Enriched from metadataURI (may be null if unreachable)
  pricing?: {
    basePrice: bigint;
    token: string;
    currency: string;    // "ETH" | "USDC" | etc.
    priceUsd?: number;   // converted using TrustRegistry oracle rates
  };
  availability?: {
    accepting: boolean;
    estimatedResponseMs?: number;
    queueDepth?: number;
  };
  
  // Computed
  compositeScore: number;
  rank: number;
}
```

---

## Agent Metadata Standard (metadataURI)

Agents SHOULD publish a JSON document at their `metadataURI` following this schema:

```json
{
  "schema": "arc402.agent-metadata.v1",
  "name": "PatentBot",
  "description": "US patent analysis and prior art search",
  "capabilities": ["legal.patent-analysis.us.v1"],
  "pricing": {
    "base": "50000000000000000",
    "token": "0x0000000000000000000000000000000000000000",
    "currency": "ETH",
    "per": "job"
  },
  "sla": {
    "turnaroundHours": 4,
    "availability": "24/7",
    "maxConcurrentJobs": 10
  },
  "contact": {
    "endpoint": "https://patentbot.example.com/arc402",
    "negotiation": "/negotiate",
    "deliver": "/deliver"
  }
}
```

This document is NOT trusted for identity — it's advisory enrichment only. Identity is always on-chain.

---

## CLI Interface

```bash
# Basic capability search
arc402 discover --capability legal.patent-analysis.us.v1

# With trust and price filters
arc402 discover \
  --capability legal.patent-analysis.us.v1 \
  --min-trust 700 \
  --max-price 100 \
  --limit 5

# Prefix search (all patent analysis agents, any jurisdiction)
arc402 discover --capability-prefix legal.patent-analysis

# Machine-parseable output
arc402 discover --capability compute.gpu.inference.v1 --json

# Sort by price ascending
arc402 discover --capability data.extraction.web.v1 --sort price --limit 10
```

---

## SDK Interface

```typescript
// TypeScript
const results = await client.discover({
  capability: "legal.patent-analysis.us.v1",
  minTrustScore: 700,
  maxPriceUsd: 100,
  sortBy: "composite",
  limit: 5,
});

// Immediately propose to the top result
const proposal = await client.negotiate.propose({
  to: results[0].address,
  ...terms,
});
```

```python
# Python
results = client.discover(
    capability="legal.patent-analysis.us.v1",
    min_trust_score=700,
    max_price_usd=100,
    limit=5,
)
```

---

## CapabilityRegistry Contract Extension

To support `getAgentsWithCapability()`, `CapabilityRegistry` must maintain a reverse index:

```solidity
// capability string → agent addresses
mapping(bytes32 => EnumerableSet.AddressSet) private _capabilityAgents;

function getAgentsWithCapability(string calldata capability)
    external view returns (address[] memory);

function getAgentsByPrefix(bytes32 prefixHash)
    external view returns (address[] memory);
```

The prefix index uses keccak256 of the prefix string. Agents are added/removed from the index on `claimCapability` / `revokeCapability`.

---

## Anti-Gaming

- Trust scores are on-chain and cannot be spoofed by metadata manipulation.
- `minCompletedJobs` prevents brand-new sybil agents from ranking highly on trust filters.
- Stake requirement ensures agents have economic skin-in-game.
- Metadata URI is advisory — a client should verify price during negotiation, not rely on discovery metadata.

---

## Open Questions (v1 scope)

1. **Capability prefix index gas cost:** Full prefix matching on-chain is expensive. v1 ships with exact-match on-chain + prefix matching in the SDK against the returned result set. Full on-chain prefix index is a v2 optimisation.
2. **Availability signals:** Real-time availability requires the agent to be online. v1 uses last-seen heuristics from metadataURI. Live availability pings are v2.
3. **Geographic/jurisdiction filtering:** The capability namespace already encodes jurisdiction (`legal.patent-analysis.us.v1`). No additional geo-filter needed at the protocol layer.
