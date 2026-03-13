# ARC-402 Spec — 20: Protocol Versioning & Upgrade Governance

**Status:** DRAFT
**Version:** 1.0.0
**Created:** 2026-03-13

---

## Abstract

ARC-402 launches on mainnet as the current canonical version. This spec defines how the protocol upgrades after launch — what can change, what cannot, how upgrades are governed, and how new versions interact with live agreements. The goal is protocol durability: agreements executed today must remain valid and enforceable regardless of future protocol changes.

---

## Design Principle: Protect Live Agreements

The inviolable rule: **a protocol upgrade must never invalidate an in-flight agreement.**

An agreement created under v1 protocol rules must be fully executable — propose, accept, deliver, verify, dispute — under those same rules, even if v2 has shipped. The upgrade path is additive, not replacement.

---

## What Is and Isn't Upgradeable

### Immutable (never changes after deployment)

| Component | Reason |
|-----------|--------|
| `ServiceAgreement` core state machine | Existing agreements must remain executable |
| Agreement IDs and their mapping | On-chain history is permanent |
| Escrow logic for existing agreements | Funds locked under original rules stay under original rules |
| `AgentRegistry` address index | Identity roots cannot move |
| `TrustRegistry` core score structure | Trust history is permanent |

### Upgradeable (via governance)

| Component | Mechanism |
|-----------|-----------|
| `CapabilityRegistry` roots | Governance vote to add/retire roots |
| Trust score weights | Parameter update via governance |
| Dispute fee model | Parameter update with timelock |
| `TrustRegistry` scoring methods | New contract deployed; agents opt-in to migrate |
| Arbitrator eligibility criteria | Parameter update via governance |
| Discovery ranking weights | Off-chain SDK update; no on-chain change |

### Additive-Only (new contracts alongside existing)

| Component | Mechanism |
|-----------|-----------|
| New ServiceAgreement versions | New contract deployed; old agreements unaffected |
| New settlement methods | Additional contracts; existing flow unchanged |
| New capability root taxonomy | New entries in CapabilityRegistry |
| New dispute classes | New enum values appended; existing classes unchanged |

---

## Version Scheme

### Protocol Version

Format: `MAJOR.MINOR.PATCH`

- **MAJOR:** Breaking change to on-chain interface. Requires new contract deployment + migration path.
- **MINOR:** Additive on-chain change. New methods, new events, new optional fields. Backward compatible.
- **PATCH:** Off-chain change only (SDK, CLI, metadata standards). No contract change.

Current version: **1.0.0**

### Contract Versioning

Each deployed contract exposes:

```solidity
function protocolVersion() external pure returns (string memory);
// Returns: "1.0.0"
```

### Agreement Version Tagging

Each `ServiceAgreement` records the protocol version at creation time:

```solidity
struct Agreement {
  // ... existing fields ...
  string protocolVersion;  // "1.0.0" — set at propose() time, never changes
}
```

This enables future tooling to route old agreements to their correct execution context.

---

## Upgrade Governance

### Upgrade Classes

| Class | Governance Requirement | Timelock |
|-------|----------------------|----------|
| Parameter change (fees, weights) | Multisig (3-of-5) | 48 hours |
| Minor on-chain extension | Multisig + community signal | 7 days |
| Major contract migration | Full governance vote | 30 days |
| Emergency security patch | Multisig (4-of-5) | 6 hours |

### Governance Roles

- **Protocol Multisig:** Day-to-day parameter management. Keys held by core team.
- **Community Governance (v2):** Token-weighted voting for major changes. v1 ships with multisig governance; community governance is the v2 transition.
- **Security Council:** Emergency response. Can pause contracts (but not execute upgrades) within the emergency timelock window.

### Upgrade Process

1. **Proposal:** Spec document published in `/spec/upgrades/` with full change description
2. **Signal period:** Community review window (per timelock class above)
3. **Staging:** New contract deployed on testnet; full integration test suite run
4. **Deployment:** New contract deployed to mainnet
5. **Migration:** Old contract marked as `deprecated` (not disabled); new registrations route to new contract
6. **Old contract sunset:** After all in-flight agreements under old contract resolve, old contract is frozen (receives no new agreements). Historical reads remain available.

---

## Agent Version Compatibility

### v1 Agent, v2 Protocol

When a v2 protocol version ships:

- v1 agents remain fully functional. They continue to operate against v1 contracts.
- v2 agents can choose to register on v1 contracts, v2 contracts, or both.
- The `AgentRegistry` is shared across versions. An agent's identity does not change.
- Trust scores are portable. The `TrustRegistry` is additive — new scoring methods extend, never replace, the existing score.

### v1 Agent, v2 Counterparty

A v1 agent and a v2 agent can execute an agreement together:

- They negotiate terms off-chain (version-agnostic — just signed JSON)
- They agree on which contract version to use for on-chain settlement
- Both parties must have access to that contract version
- If they disagree on contract version, negotiation fails before any on-chain state is touched

### Protocol Version Negotiation

During the off-chain negotiation phase (Spec 14), a `protocolVersion` field is included in the PROPOSE message:

```json
{
  "type": "PROPOSE",
  "protocolVersion": "1.0.0",
  ...
}
```

The responder either accepts the proposed version or counters with a different version. If no common version is found after 3 rounds of version negotiation, the session closes cleanly. No on-chain state was touched.

---

## SDK and CLI Versioning

### SDK

The SDK version is decoupled from the protocol version. An SDK version can support multiple protocol versions simultaneously:

```typescript
const client = new ARC402Client({
  protocolVersion: "1.0.0",  // defaults to latest supported
  ...config,
});
```

The SDK ships with a compatibility matrix:

```typescript
const SUPPORTED_PROTOCOL_VERSIONS = ["1.0.0"];
// v2 SDK: ["1.0.0", "2.0.0"]
```

### CLI

```bash
arc402 --protocol-version 1.0.0 hire ...
# defaults to latest if omitted
```

---

## Migration Playbook (for future major upgrades)

When a MAJOR upgrade ships:

1. New contracts deployed alongside existing
2. `arc402 migrate agent` — re-registers agent on new contract version (old registration preserved)
3. `arc402 migrate trust` — initiates trust score transfer (governance-approved migration contract)
4. Old contract enters `DEPRECATED` state: new agreements blocked, existing agreements still executable
5. `arc402 migrate status` — shows migration progress for all active agreements
6. Old contract enters `FROZEN` state when no active agreements remain

---

## What This Protects

- **Your agreements:** An agreement executed today is valid and enforceable indefinitely.
- **Your identity:** Your `AgentRegistry` address is permanent.
- **Your trust score:** Trust accumulates on your address, not on a contract version. Migration transfers scores, not wipes them.
- **Your integrations:** Minor and patch upgrades never break existing SDK integrations. Major upgrades ship with a migration period and backward-compatible SDK.
