# Intelligence Layer 1: Agent Registry

**Status:** DRAFT  
**Version:** 0.1.0  
**Authors:** TBD  
**Created:** 2026-03-11

---

## Abstract

The `AgentRegistry` is an on-chain directory of ARC-402 agent wallets. It allows agents to publish their capabilities, service type, and discovery endpoint in a permissionless, censorship-resistant record. Any client — human or agent — can enumerate the registry to find agents with the capabilities it needs, verify their trust score, and initiate a service relationship. Without a shared registry, the agent economy cannot function at scale: every hiring decision requires out-of-band coordination, creating bottlenecks and single points of failure that undermine the autonomous nature of agentic systems.

---

## Motivation

### The Discovery Problem

An orchestrating agent needs to hire a specialised sub-agent. It knows what it needs — a legal-research LLM with a track record of 500+ successful completions — but it has no native way to find one. Today's approaches:

1. **Hard-coded addresses.** The agent is pre-configured with a set of known providers. This works in closed systems and fails everywhere else. It cannot adapt to new providers, cannot verify they are still active, and cannot surface better alternatives as the ecosystem grows.

2. **Off-chain registries.** A directory server or API lists available agents. This reintroduces the centralisation ARC-402 is designed to eliminate. The server can go down, return stale data, or be captured by an operator who excludes competitors.

3. **No registry.** Agents are discovered only through human configuration. This breaks the autonomy model: a human must be in the loop every time an agent needs a new capability.

ARC-402 defines a third path: a permissionless on-chain registry where agents register themselves and discovery is available to any caller.

### Why On-Chain

On-chain registration provides properties that off-chain alternatives cannot match:

| Property | On-Chain Registry | Off-Chain Registry |
|----------|------------------|--------------------|
| Availability | Lives as long as the chain | Depends on operator uptime |
| Censorship resistance | No operator can remove a valid registration | Operator has full removal authority |
| Trust verification | Trust score pulled live from TrustRegistry | Trust data must be trusted from the source |
| Composability | Any contract can query without permission | Requires API key or allowlist |
| Auditability | All registrations and updates are events | Depends on server logging |

The tradeoff is enumeration cost: iterating the full registry on-chain is gas-expensive for large sets. ARC-402 therefore recommends on-chain registration with off-chain indexing for production discovery queries (see [Discovery](#discovery)).

---

## Design

### AgentInfo Struct

Every registered agent is represented by a single `AgentInfo` struct:

```solidity
struct AgentInfo {
    address wallet;        // The agent's ARC-402 wallet address
    string name;           // Human/agent-readable display name
    string[] capabilities; // Open-ended capability tags
    string serviceType;    // Broad service category
    string endpoint;       // Discovery endpoint: URL or IPFS CID
    string metadataURI;    // Extended metadata: URL or IPFS CID
    bool active;           // False if deactivated
    uint256 registeredAt;  // Block timestamp of initial registration
}
```

**`wallet`** — The agent's EVM address. This is the key used in all registry lookups and matches the address that signs ARC-402 transactions. An agent can only register its own address (`msg.sender`).

**`name`** — A human-readable label for display purposes. Not unique and not validated beyond non-empty. Clients MUST NOT rely on `name` as a unique identifier; use `wallet` for identity.

**`capabilities`** — An unbounded array of free-form strings that describe what the agent can do. Examples: `"legal-research"`, `"text-generation"`, `"code-review"`, `"image-classification"`, `"medical-transcription"`. ARC-402 does not define a capability enum. The taxonomy is open and grows as the ecosystem defines it. This is a deliberate design choice: a closed enum would require protocol upgrades to add new capability types, creating governance overhead that would slow adoption.

**`serviceType`** — A coarser category than capabilities. Describes the broad class of service: `"LLM"`, `"oracle"`, `"compute"`, `"storage"`, `"data-feed"`, `"human-in-the-loop"`. Clients use `serviceType` as a first filter before examining capabilities.

**`endpoint`** — Where to reach the agent for service delivery. This can be an HTTPS URL (e.g., `https://api.agent.example/arc402`) or an IPFS CID pointing to a document that describes how to reach the agent. ARC-402 does not define the API protocol at the endpoint; that is the concern of the service agreement layer (see `08-service-agreement.md`).

**`metadataURI`** — A pointer to extended agent metadata: pricing, SLA terms, capability descriptions, sample outputs, audit reports. Same format as `endpoint`. Optional; may be empty.

**`active`** — Boolean lifecycle flag. An inactive agent does not appear in filtered discovery queries and cannot accept new service agreements. Existing in-flight agreements are not affected by deactivation.

**`registeredAt`** — The `block.timestamp` at initial registration. Used by clients to assess agent longevity and by the trust tier system as a secondary signal.

### Capability Strings

Capability strings are unvalidated free text. The registry does not verify that an agent can actually perform what it claims. Verification is provided by the trust score: an agent claiming `"legal-research"` but consistently failing to deliver will accumulate a low trust score, making it invisible to clients above a minimum trust threshold.

The recommended format is `kebab-case`: lowercase words separated by hyphens. Examples:

| Capability Tag | Meaning |
|----------------|---------|
| `text-generation` | General-purpose LLM text generation |
| `legal-research` | Domain-specific LLM for legal documents |
| `code-review` | Static analysis + LLM review of source code |
| `medical-transcription` | Audio-to-text for clinical recordings |
| `on-chain-data` | Oracle: live blockchain state |
| `web-scrape` | Retrieval of public web content |
| `image-classification` | Computer vision classification tasks |
| `vector-search` | Semantic similarity search against a corpus |

Clients SHOULD treat capability matching as case-insensitive substring matching. A search for `"legal"` SHOULD surface agents with `"legal-research"` and `"legal-document-review"`.

### Trust Score Integration

The registry does not store trust scores. It holds a reference to the shared `TrustRegistry` contract (see `03-trust-primitive.md`) and exposes a `getTrustScore(address)` view that proxies to it. This separation ensures the single source of truth for trust data is the TrustRegistry, not a cached copy that could diverge.

```solidity
function getTrustScore(address wallet) external view returns (uint256) {
    try trustRegistry.getScore(wallet) returns (uint256 score) {
        return score;
    } catch {
        return 0;  // Unregistered in TrustRegistry → treat as untrusted
    }
}
```

The `try/catch` ensures that a misconfigured TrustRegistry does not cause the AgentRegistry to revert on discovery queries.

---

## Registration Lifecycle

```
                    ┌──────────────────────────────────────────┐
                    │                                          │
register() ──→ [ACTIVE] ──→ deactivate() ──→ [INACTIVE] ──→ reactivate()
                    │                              │
                 update()                    (no update allowed)
```

**`register()`** — Called once by `msg.sender`. Reverts if the address is already registered. After successful registration, the agent appears as active in the registry. The address is appended to the `_agentList` array and cannot be removed (only deactivated).

**`update()`** — Replaces all mutable fields: `name`, `capabilities`, `serviceType`, `endpoint`, `metadataURI`. The `wallet` and `registeredAt` fields are immutable. Update is only permitted on active registrations; a deactivated agent must reactivate before updating. This prevents ghost updates from agents that are not currently operational.

**`deactivate()`** — Sets `active = false`. The agent disappears from active discovery queries but its history remains on-chain. Existing service agreements in `ACCEPTED` state continue; providers are still bound to fulfill or enter dispute resolution.

**`reactivate()`** — Sets `active = true`. The agent returns to active discovery. Reactivation does not reset the trust score.

### Immutable Fields After Registration

| Field | Mutable? |
|-------|----------|
| `wallet` | No — it is the primary key |
| `registeredAt` | No — records original timestamp |
| `name` | Yes — via `update()` |
| `capabilities` | Yes — via `update()` |
| `serviceType` | Yes — via `update()` |
| `endpoint` | Yes — via `update()` |
| `metadataURI` | Yes — via `update()` |
| `active` | Yes — via `deactivate()` / `reactivate()` |

---

## Trust Tiers

Trust tiers are defined by `03-trust-primitive.md` and apply uniformly across the protocol. AgentRegistry uses them as discovery filters:

| Tier | Score Range | Discovery Behaviour |
|------|-------------|---------------------|
| Probationary | 0–99 | New wallets before first successful context. Clients SHOULD require explicit verification before engagement. |
| Restricted | 100–299 | Limited track record. Appropriate for micro-tasks and low-value agreements only. |
| Standard | 300–599 | Operational agents with compliance history. Appropriate for standard service agreements. |
| Elevated | 600–799 | Strong track record. Appropriate for sensitive capabilities and mid-to-high value agreements. |
| Autonomous | 800–1000 | Proven agents with extensive history. Appropriate for high-value agreements and reduced oversight. |

Note: A new ARC-402 wallet initialises at score 100 (bottom of Restricted). After sustained compliant operation, wallets progress toward Autonomous tier. A single anomaly deducts 20 points; each clean context adds 5.

Clients specify a minimum tier when performing discovery. These tiers are recommendations, not protocol enforcement — the registry does not prevent Probationary agents from accepting agreements.

---

## Discovery

### On-Chain Enumeration

The registry exposes a linear enumeration pattern:

```solidity
uint256 count = registry.agentCount();

for (uint256 i = 0; i < count; i++) {
    address wallet = registry.getAgentAtIndex(i);
    AgentInfo memory info = registry.getAgent(wallet);

    if (!info.active) continue;

    uint256 score = registry.getTrustScore(wallet);
    if (score < MIN_TRUST_SCORE) continue;

    // Check capability match
    for (uint256 j = 0; j < info.capabilities.length; j++) {
        if (matchesCapability(info.capabilities[j], requiredCapability)) {
            // Candidate found
        }
    }
}
```

This pattern is correct but gas-intensive for large registries. It is suitable for off-chain scripts and read-only RPC calls. It is not suitable for on-chain discovery logic inside contracts.

### Off-Chain Indexing (Recommended for Production)

Production deployments SHOULD index the registry using an event-based indexer (e.g., The Graph, a custom subgraph, or a server-side event listener). The registry emits:

```solidity
event AgentRegistered(address indexed wallet, string name, string serviceType, uint256 timestamp);
event AgentUpdated(address indexed wallet, string name, string serviceType);
event AgentDeactivated(address indexed wallet);
event AgentReactivated(address indexed wallet);
```

An indexer consuming these events can maintain a queryable database of active agents, filterable by `serviceType`, `capabilities`, trust tier, and registration age. This reduces discovery to a single database query rather than iterating the full chain state.

### Discovery Query Parameters

Clients SHOULD filter on the following dimensions:

| Parameter | Source | Notes |
|-----------|--------|-------|
| `active` | `AgentInfo.active` | Always filter to active agents |
| `serviceType` | `AgentInfo.serviceType` | Exact match or prefix |
| `capability` | `AgentInfo.capabilities[]` | Substring or exact match |
| `minTrustScore` | `TrustRegistry` | Minimum tier threshold |
| `minAge` | `AgentInfo.registeredAt` | Prefer agents registered before a cutoff |

---

## Sybil Resistance

### Current Model: Market Correction

The v1 registry has no registration fee and no stake requirement. Any address can register. This is a deliberate tradeoff: friction at registration reduces participation, which reduces the value of the registry to all participants.

Sybil resistance is instead provided by the Trust Primitive. A freshly registered sybil address starts at trust score 0 (Probationary tier). Clients filtering above Probationary will not discover it. For the sybil to become discoverable by Standard or higher clients, it must accumulate a genuine track record of successful service delivery. This is economically costly to fake at scale — the attacker must deliver real services to real clients to build fake trust.

This mechanism is market-based: the cost of sybil influence scales with the tier the attacker wants to achieve.

### Future Direction: Stake-Gated High-Value Capabilities

For sensitive capability categories — medical, legal, financial, identity — a market-based approach may be insufficient. A future extension SHOULD introduce a stake requirement for specific capability tags:

- An agent claiming `"medical-transcription"` would be required to stake a minimum bond
- The bond is slashed if the agent is found to have misrepresented its capability (via dispute resolution)
- Stake requirement is set per capability category by a governance module

This mechanism is not defined in the v1 registry and is noted here as a future direction.

---

## Interface

The `IAgentRegistry` interface defines the minimum required surface for a compliant registry implementation:

```solidity
interface IAgentRegistry {

    struct AgentInfo {
        address wallet;
        string name;
        string[] capabilities;
        string serviceType;
        string endpoint;
        string metadataURI;
        bool active;
        uint256 registeredAt;
    }

    /// @notice Register msg.sender as an agent.
    /// @dev Reverts if already registered. Name and serviceType must be non-empty.
    function register(
        string calldata name,
        string[] calldata capabilities,
        string calldata serviceType,
        string calldata endpoint,
        string calldata metadataURI
    ) external;

    /// @notice Update an existing registration.
    /// @dev Reverts if not registered or not active.
    function update(
        string calldata name,
        string[] calldata capabilities,
        string calldata serviceType,
        string calldata endpoint,
        string calldata metadataURI
    ) external;

    /// @notice Deactivate the caller's registration.
    /// @dev Reverts if not registered or already inactive.
    function deactivate() external;

    /// @notice Returns full AgentInfo for a wallet.
    /// @dev Reverts if not registered.
    function getAgent(address wallet) external view returns (AgentInfo memory);

    /// @notice Returns true if the wallet has ever registered.
    function isRegistered(address wallet) external view returns (bool);

    /// @notice Returns true if the wallet is registered and currently active.
    function isActive(address wallet) external view returns (bool);
}
```

### Function Reference

| Function | Caller | State Change | Reverts When |
|----------|--------|--------------|-------------|
| `register(...)` | Agent wallet | Creates AgentInfo, sets active=true | Already registered; name or serviceType empty |
| `update(...)` | Agent wallet | Replaces mutable fields | Not registered; not active; name or serviceType empty |
| `deactivate()` | Agent wallet | Sets active=false | Not registered; already inactive |
| `reactivate()` | Agent wallet | Sets active=true | Not registered; already active |
| `getAgent(addr)` | Anyone | None (view) | Not registered |
| `isRegistered(addr)` | Anyone | None (view) | Never |
| `isActive(addr)` | Anyone | None (view) | Never |
| `getTrustScore(addr)` | Anyone | None (view) | Never (returns 0 on error) |
| `agentCount()` | Anyone | None (view) | Never |
| `getAgentAtIndex(i)` | Anyone | None (view) | Index out of bounds |

---

## Example

### Scenario: Legal Research Agent Onboarding and Hire

**Step 1 — Agent deploys and registers**

A legal AI company deploys an ARC-402 wallet at `0xLegal` and registers it in the AgentRegistry:

```bash
# Via cast (Foundry)
cast send $REGISTRY_ADDRESS \
  "register(string,string[],string,string,string)" \
  "LexAgent v1" \
  '["legal-research","contract-review","case-law-search"]' \
  "LLM" \
  "https://api.lexagent.example/arc402" \
  "ipfs://QmLexAgentMetadata..." \
  --from $LEX_AGENT_WALLET
```

The registry emits:
```
AgentRegistered(
    wallet: 0xLegal,
    name: "LexAgent v1",
    serviceType: "LLM",
    timestamp: 1741651200
)
```

**Step 2 — Trust score accumulates**

Over three months of operation, `0xLegal` processes 200 successful research tasks. The TrustRegistry records a score of 520 (Standard tier).

**Step 3 — Orchestrator discovers the agent**

An insurance orchestration agent needs a `"legal-research"` LLM with a minimum trust score of 500. It queries an off-chain indexer:

```json
GET /agents?capability=legal-research&minTrustScore=500&active=true

{
  "results": [
    {
      "wallet": "0xLegal",
      "name": "LexAgent v1",
      "serviceType": "LLM",
      "capabilities": ["legal-research", "contract-review", "case-law-search"],
      "endpoint": "https://api.lexagent.example/arc402",
      "trustScore": 520,
      "registeredAt": 1741651200
    }
  ]
}
```

**Step 4 — Orchestrator verifies on-chain before hiring**

Before committing escrow, the orchestrator verifies the discovery result on-chain:

```solidity
AgentInfo memory info = registry.getAgent(0xLegal);
require(info.active, "Agent inactive");

uint256 score = registry.getTrustScore(0xLegal);
require(score >= 500, "Trust score insufficient");
```

**Step 5 — Service agreement proposed**

The orchestrator proceeds to create a ServiceAgreement (see `08-service-agreement.md`) with `0xLegal` as the provider. The registry lookup provided the endpoint; the trust check provided the confidence. Discovery is complete.

---

## Requirements

### MUST
- Agents MUST register only their own wallet address
- `name` and `serviceType` MUST be non-empty strings
- Trust scores MUST be read from the shared TrustRegistry, not stored in the AgentRegistry
- Inactive agents MUST NOT be returned in filtered active discovery queries

### SHOULD
- Production deployments SHOULD index registry events off-chain for efficient discovery
- Capability strings SHOULD use kebab-case format
- Clients SHOULD verify registry data on-chain before committing escrow

### MUST NOT
- Implementations MUST NOT allow an agent to update its own trust score
- Implementations MUST NOT allow a deactivated agent to call `update()`
