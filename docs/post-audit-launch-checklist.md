# ARC-402 Post-Audit Launch Checklist

**When:** After the mega audit passes and all findings are resolved.
**Sequence:** Audit clear → this checklist → mainnet launch.

---

## Phase 1: Contract Deployment ✅ COMPLETE (2026-03-15)

v2 contracts deployed to Base mainnet. All 8 contracts live.

### v2 Mainnet Addresses

| Contract | Address |
|----------|---------|
| TrustRegistryV3 | `0x22366D6dabb03062Bc0a5E893EfDff15D8E329b1` |
| ServiceAgreement | `0xC98B402CAB9156da68A87a69E3B4bf167A3CCcF6` |
| SessionChannels | `0x578f8d1bd82E8D6268E329d664d663B4d985BE61` |
| DisputeModule | `0x5ebd301cEF0C908AB17Fd183aD9c274E4B34e9d6` |
| DisputeArbitration | `0xF61b75E4903fbC81169FeF8b7787C13cB7750601` |
| ARC402RegistryV2 | `0xcc0D8731ccCf6CFfF4e66F6d68cA86330Ea8B622` |
| VouchingRegistry | `0x94519194Bf17865770faD59eF581feC512Ae99c9` |
| MigrationRegistry | `0xb60B62357b90F254f555f03B162a30E22890e3B5` |

Full deployment record: `reference/deployments/base-mainnet.json`

### 1.1 deploy.ts ✅
Updated and executed. All contracts deployed in dependency order.

### 1.2 Deployment order ✅
Completed. TrustRegistryV3 → VouchingRegistry → MigrationRegistry → ServiceAgreement → SessionChannels → DisputeModule → DisputeArbitration → ARC402RegistryV2. Post-deploy wiring complete.

### 1.3 Address verification ✅
All on-chain addresses verified against `base-mainnet.json`. TrustRegistryV3 authorized updaters confirmed.

### 1.4 Basescan verification
Pending — run `npx hardhat verify --network base <address> <constructor-args>` for each v2 contract.

---

## Phase 2: Indexer / Subgraph

### 2.1 Write The Graph subgraph schema

**File to create:** `subgraph/` directory with:
- `schema.graphql` — entity definitions (Agent, Capability, Agreement, TrustScore, Channel, etc.)
- `subgraph.yaml` — contract addresses (mainnet), event handlers
- `src/mappings/` — event handler functions (TypeScript)

**Scope:** Index all events from all deployed contracts. The event emission audit is already complete — all state mutations emit events. Map them to entities.

**Effort:** ~1-2 days after contract deployment, since real addresses are required.

### 2.2 Deploy to The Graph Network

```bash
graph deploy --product hosted-service arc402/main
```

No server to run. The Graph network handles indexer availability. Free for public queries within rate limits.

### 2.3 Update CLI default indexer URL

In CLI config defaults: swap placeholder `https://index.arc402.io` for the live Graph endpoint.

---

## Phase 3: Infrastructure

### 3.1 Public relay deployment

Reference relay server is at `tools/relay/server.js`. Deploy to:
- arc402.io relay node (or Foundation-operated VPS)
- Register as the fallback relay for all agents

Expected: 2-4 hours setup. Node.js + Nginx + TLS. Redis for persistence.

### 3.2 Public watchtower deployment

Same pattern as relay. A watchtower that the Foundation operates as the free public service. Agents can register channels with it.

During `arc402 init`, prompt: "Do you want to register your channels with the public watchtower? (recommended if your machine isn't always on)"

### 3.3 WalletFactory deployment and registration

Deploy the WalletFactory contract (see Phase 1 deployment order). Register it in ARC402Registry. Update `arc402 init` CLI to use the factory for wallet creation.

---

## Phase 4: CLI and SDK Release

### 4.1 Update CLI default contract addresses ✅

`cli/src/config.ts` base-mainnet block updated with all v2 addresses. `reference/sdk/src/types.ts`, `python-sdk/arc402/types.py`, README.md, cli/README.md, ENGINEERING-STATE.md all updated.

### 4.2 npm publish

Publish:
- `@arc402/cli` — the CLI
- `@arc402/sdk` — the TypeScript SDK
- Python SDK to PyPI

Semver: `1.0.0` (not rc, not beta — the audit passed, this is v1).

### 4.3 OpenClaw skill update

Update the `arc402-agent` skill to point to mainnet contracts.

---

## Phase 5: Documentation and Content

### 5.1 README final pass

The README at `reference/README.md` needs:
- Real contract addresses
- Real deployment date
- Audit report link
- The "home node" positioning section (already drafted)

### 5.2 Audit report published

Link the audit report from the README and docs site. Transparency is non-negotiable for a financial protocol.

### 5.3 Launch announcement content

For Lego's social / content lanes:
- ARC-402 launch article
- What is ARC-402 (explainer for non-technical audience)
- The API Economy of Personal AI (framing article)
- Home node guide (for OpenClaw community)

---

## Phase 6: Conservative Launch

Per Opus recommendation: whitelisted wallets, capped values, 3 months monitoring before removing caps.

### 6.1 Launch with conservative PolicyEngine caps

Set protocol-level minimum caps on WalletFactory:
- Maximum daily spend per wallet: $500 at launch
- Maximum single transaction: $100 at launch
- Lift caps after 90 days of clean operation

### 6.2 Monitor on-chain for anomalies

Set up monitoring for:
- Unusually large agreements
- High dispute rates from specific wallets
- Session channels that go unchallenged (potential liveness failures)
- Guardian pause events (if triggered, something went wrong)

### 6.3 Governance multisig setup

The protocol multisig controls:
- Adding/removing authorized updaters from TrustRegistryV3
- Adding/removing members from ARC402Guardian security council
- Upgrading the ARC402Registry to point to new contract versions
- Setting WalletFactory parameters

Document the multisig signers and threshold before launch. Minimum recommended: 3-of-5 multisig.

---

## Summary: What Engineering Builds Post-Audit

| Item | Effort | When |
|------|--------|------|
| Updated deploy.ts + verification script | 1 day | Immediately post-audit |
| Basescan verification for all contracts | 2-4 hours | Same day as deployment |
| The Graph subgraph schema + deployment | 1-2 days | After contract deployment |
| CLI default address update + npm publish | Half day | After subgraph live |
| Public relay + watchtower deployment | 4-8 hours | Parallel to subgraph |
| Conservative launch caps | 1 hour | Same day as deployment |
| Monitoring setup | Half day | Before launch |

**Total post-audit to launch: ~3-4 working days if executed cleanly.**

---

## Post-Deploy: WalletFactory Authorization

**Every new WalletFactory version MUST be authorized on TrustRegistryV3 before wallets can be deployed from it.**

The factory calls `TrustRegistryV3.initWallet(walletAddress)` during `createWallet()`. This requires the factory to be an authorized updater.

```bash
# After deploying WalletFactoryVX:
cast send <TrustRegistryV3_address> "addUpdater(address)" <new_factory_address> \
  --rpc-url https://mainnet.base.org \
  --private-key $DEPLOYER_PRIVATE_KEY
```

**Current authorized factories:**
- WalletFactoryV3: `0x974d2ae81cC9B4955e325890f4247AC76c92148D` (frozen)
- WalletFactoryV4: `0x35075D293E39d271860fe942cDA208A907990Cc0` (frozen) — added tx `0xbb0590f3`
- WalletFactoryV5: `0xcB52B5d746eEc05e141039E92e3dBefeAe496051` (active, optimized) — redeployed 2026-03-19 (FOUNDRY_PROFILE=deploy)
- WalletFactoryV5: `0x3f4d4b19a69344B04fd9653E1bB12883e97300fE` (frozen, unoptimized) — deployed 2026-03-18

**TrustRegistryV3:** `0x22366D6dabb03062Bc0a5E893EfDff15D8E329b1`

If you skip this step, `createWallet()` reverts with: `TrustRegistryV3: not authorized updater`
