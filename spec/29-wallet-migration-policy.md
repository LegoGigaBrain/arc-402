# ARC-402 Spec — 29: Wallet Migration Policy

**Status:** DRAFT
**Version:** 1.0.0
**Created:** 2026-03-13

---

## Abstract

ARC402Wallet is immutable once deployed. When the protocol evolves and new contract versions are released, existing wallet owners need a path to upgrade without losing their operational history and trust scores. This spec defines the migration mechanism, trust score handling, and the governance guardrails that prevent migration from becoming a reputation laundering mechanism.

---

## Why Migration Exists

Immutable contracts cannot be patched. If a vulnerability is discovered in ARC402Wallet v1.0 after launch, the protocol needs a path to move users to v1.1 without destroying their accumulated trust scores and agreement history.

Migration is also the path for users who want to take advantage of new features in future contract versions — session channel improvements, new DeFi integrations, expanded NFT governance.

---

## What Migration Is and Is Not

**It IS:** A continuity mechanism for the same owner, upgrading to a new contract implementation.

**It IS NOT:**
- A trust score transfer mechanism
- A way to sell or give away your operational history
- A way to start fresh with someone else's history
- An escape from anomaly records

The soulbound identity NFT (Spec 27) anchors agent identity to the originating wallet address. Migration preserves continuity of this identity — it does not transfer it.

---

## Migration Mechanics

### The MigrationRegistry Contract

A single governance-controlled contract that records approved migrations:

```solidity
struct Migration {
    address oldWallet;
    address newWallet;
    address owner;          // Must be the same for both
    uint256 migratedAt;
    uint256 scoreAtMigration;
    uint256 appliedDecay;   // Decay percentage applied (in BPS)
}

mapping(address => address) public migratedTo;   // old → new
mapping(address => address) public migratedFrom; // new → old

function registerMigration(address oldWallet, address newWallet) external onlyOwner {
    // Verify both wallets have the same owner
    // Verify newWallet is a valid ARC402Wallet
    // Apply trust score decay
    // Record migration
}
```

### Owner Verification

Both old and new wallets must have the same registered owner address in AgentRegistry. This prevents migration-as-transfer: you cannot migrate your wallet to one owned by someone else.

If ownership of the old wallet has been transferred (private key sold), migration is blocked. The protocol does not facilitate identity transfer via this path.

---

## Trust Score on Migration

### The 10% Decay Rule

When a wallet migrates, the trust score carries a 10% decay to the new wallet:

```
new_effective_score = old_score × 0.90
```

**Why 10%:** Legitimate upgrades are rare and valuable. Charging 10% is meaningful enough to deter casual migration-hopping while not being punitive for genuine technical upgrades.

**Compounding on multiple migrations:**
- v1.0 → v1.1: 1000 → 900
- v1.1 → v2.0: 900 → 810
- v2.0 → v2.1: 810 → 729

After 3 migrations: 72.9% of original score retained. The cost compounds.

### What Carries Over

| Attribute | Carries over | Notes |
|-----------|-------------|-------|
| Trust score | Yes (with decay) | Decayed at migration |
| Agreement history (on-chain) | Yes | Immutable, indexed by agreementId |
| Capability claims | No | Must re-register on new wallet |
| Policy configuration | No | Must re-configure on new wallet |
| Anomaly record | Yes | Cannot be escaped via migration |
| Soulbound NFT | Stays at old address | Identity continuity via MigrationRegistry |
| Relay configuration | No | Must re-configure |

### Anomaly Records Cannot Be Erased

Migration does not reset anomaly history. The TrustRegistry records all anomalies tied to the identity lineage (old wallet → new wallet via MigrationRegistry). A wallet with 5 anomaly penalties cannot migrate away from them.

Implementation: `recordAnomaly()` checks the identity lineage and applies the penalty to the current active wallet in the lineage chain.

---

## Governance Controls

### Protocol-Approved Migration Targets

New ARC402Wallet contract versions must be approved by protocol governance before they can be migration targets. This prevents:
- Migration to a malicious contract that steals escrowed funds
- Migration to a downgraded contract that removes security features
- Arbitrary contract addresses being accepted as valid wallets

```solidity
mapping(address => bool) public approvedWalletImplementations;

function approveMigrationTarget(address implementation) external onlyGovernance {
    approvedWalletImplementations[implementation] = true;
}
```

### Rate Limiting

One migration per 90-day period. Prevents rapid compounding abuse:
- Migrate, then immediately migrate back to reset decay
- Coordinate wallet swaps to launder reputation

```solidity
mapping(address => uint256) public lastMigratedAt;

modifier migrationCooldown(address wallet) {
    require(block.timestamp >= lastMigratedAt[wallet] + 90 days, "MigrationRegistry: cooldown active");
    _;
}
```

---

## The Sale Problem (Explicit Statement)

If an agent sells their private key to a new owner, that new owner controls a high-trust wallet. This is a known limitation.

**What the protocol cannot prevent:** Key sales. If someone transfers control of their private key, protocol mechanisms cannot detect this. The new controller inherits the wallet's policy access and can enter into agreements.

**What the protocol prevents:**
- Formal migration to a new owner (ownership verification blocks it)
- Trust score transfer to a different address (score stays with the identity lineage)
- Soulbound NFT transfer (technically impossible)

**The economic deterrent:** Selling a private key with high trust score is selling your entire operational history. If the buyer behaves badly, the trust score decays rapidly (anomaly penalties). The sale price should reflect this: a high-trust wallet is only valuable if maintained.

This is an honest scope statement. The protocol does not claim to prevent informal identity transfer. It makes such transfer increasingly costly and increasingly detectable over time.

---

## TrustRegistry Interaction

The TrustRegistry resolves the "current active wallet" for a given identity lineage:

```solidity
function resolveActiveWallet(address wallet) public view returns (address) {
    address current = wallet;
    while (migrationRegistry.migratedTo(current) != address(0)) {
        current = migrationRegistry.migratedTo(current);
    }
    return current;
}
```

Score queries for any address in the lineage return the score of the current active wallet. Historical agreement records are indexed by agreementId, not wallet address, so they remain queryable regardless of migration.
