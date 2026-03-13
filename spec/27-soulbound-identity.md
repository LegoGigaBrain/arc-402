# ARC-402 Spec — 27: Soulbound Identity NFT

**Status:** DRAFT
**Version:** 1.0.0
**Created:** 2026-03-13

---

## Abstract

The wallet migration function enables upgrading to new contract versions — but it creates a risk: trust scores become transferable, allowing high-trust identities to be sold. This spec defines a non-transferable (soulbound) identity NFT that anchors agent identity to a specific address, making trust scores non-portable without explicit protocol governance approval.

---

## The Problem It Solves

ARC402Wallet has a `migrateTo(newWalletAddress)` function for upgrading to new contract versions. This is necessary for protocol evolution — but it means:

- An agent builds trust score to 900 over 3 years
- They sell their wallet's private key (or migration credentials)
- The buyer inherits the trust score with none of the history behind it

If trust scores can be sold, they stop being trustworthy. The entire trust model depends on scores reflecting real operational history of a specific identity.

---

## The Solution: ERC-5192 Soulbound NFT

When an ARC402Wallet is created, the WalletFactory mints a single soulbound identity NFT to the creating address. The NFT is non-transferable — it cannot be moved to any other address by any means.

The NFT encodes:
- The wallet address it represents
- The creation timestamp (when the agent entered the network)
- The chain ID (Base, mainnet, etc.)
- A unique token ID derived from the wallet address

The trust registry, when computing trust scores, checks: does this wallet have a valid soulbound identity NFT? If not, it's an unverified wallet.

---

## How It Works

### At Creation

```
arc402 init
→ WalletFactory.createWallet(owner)
  → Deploys ARC402Wallet
  → Mints IdentityNFT(tokenId=hash(walletAddress), recipient=walletAddress)
  → NFT is soulbound — locked at walletAddress forever
→ Wallet registered in AgentRegistry
→ Trust score initialised at 100
```

The NFT is minted TO the wallet address, not the owner's EOA. It lives in the wallet, cannot leave.

### Non-Transferability

Implements ERC-5192 (Minimal Soulbound NFT):

```solidity
function locked(uint256 tokenId) external pure returns (bool) {
    return true; // Always locked. Always.
}

function transferFrom(address, address, uint256) public pure override {
    revert("IdentityNFT: soulbound — non-transferable");
}

function safeTransferFrom(address, address, uint256) public pure override {
    revert("IdentityNFT: soulbound — non-transferable");
}

function safeTransferFrom(address, address, uint256, bytes memory) public pure override {
    revert("IdentityNFT: soulbound — non-transferable");
}
```

No override possible. No approval path. The NFT cannot move.

### Metadata

```json
{
  "name": "ARC-402 Agent Identity",
  "description": "Non-transferable agent identity credential. Anchors trust score and agreement history to this wallet address.",
  "wallet": "0x1234...",
  "chainId": 8453,
  "createdAt": 1773388592,
  "network": "Base",
  "protocol": "ARC-402",
  "version": "1.0.0"
}
```

Metadata is stored on IPFS at creation time (immutable CID). The NFT contract points to it.

---

## The Migration Answer

When a wallet migrates to a new contract version:

```
Old wallet (0xABC) → New wallet (0xDEF)
```

The soulbound NFT stays at the OLD wallet address (0xABC). It cannot move.

The trust registry recognises the migration and continues to associate the trust score with the identity rooted at 0xABC, now operating via 0xDEF. The score is preserved — but the NFT makes it clear that this is a continued identity, not a new one.

**What this prevents:** Selling your identity. You can migrate your wallet to a new contract version. You cannot transfer your identity NFT to another address and make that address inherit your trust score. The score follows the soulbound NFT, which follows no one.

---

## Trust Score Non-Portability Rule

The TrustRegistry enforces:

```solidity
function recordSuccess(address wallet, ...) external onlyUpdater {
    // Verify wallet has a valid soulbound identity
    require(
        identityNFT.balanceOf(wallet) > 0 || 
        migrationRegistry.isVerifiedMigrant(wallet),
        "TrustRegistry: no valid identity"
    );
    // ... proceed with score update
}
```

New wallets without identity NFTs: score starts at floor (100) and can only grow via normal agreement history. They cannot claim someone else's score by importing it.

Migrations: tracked in MigrationRegistry. The protocol acknowledges the migration but continues the identity lineage — it doesn't create a new identity.

---

## Decay on Migration

When a wallet migrates, the migrant wallet's trust score carries a migration decay:

```
new_effective_score = old_score × MIGRATION_RETENTION = old_score × 0.90
```

10% score decay on migration. Why: migration should be a technical upgrade path, not a reputation laundering mechanism. A legitimate upgrade (old contract → new contract, same owner) accepts 10% as the cost of continuity. A bad actor trying to launder reputation through fake migrations faces a growing cost.

The decay is applied once per migration. Multiple migrations compound: 1000 → 900 → 810 → 729. This makes migration-hopping expensive.

---

## v1 Scope

For v1 launch, the soulbound identity NFT is:
- Minted at wallet creation via WalletFactory
- Non-transferable (ERC-5192)
- Checked by TrustRegistry on score writes
- Metadata stored on IPFS (immutable)

Out of scope for v1:
- On-chain metadata (immutable IPFS is sufficient)
- Visual design (the NFT is a credential, not a collectible)
- Cross-chain identity bridging (v2 problem)
- DAO-governed identity disputes (v2 — requires governance infrastructure)

---

## For the Auditor

Key properties to verify:
1. `locked()` returns true unconditionally
2. All transfer functions revert unconditionally
3. `approve()` and `setApprovalForAll()` revert unconditionally
4. WalletFactory mints exactly one NFT per wallet at creation (no double-mint)
5. TrustRegistry identity check cannot be bypassed by wallets without NFTs
6. Migration decay is applied exactly once per migration (not per block, not retroactively)
