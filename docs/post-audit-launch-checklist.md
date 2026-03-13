# ARC-402 Post-Audit Launch Checklist

**When:** After the mega audit passes and all findings are resolved.
**Sequence:** Audit clear → this checklist → mainnet launch.

This is not pre-audit work. None of it can be done until contracts are finalised and deployed on Base mainnet.

---

## Phase 1: Contract Deployment

### 1.1 Update deploy.ts for all post-freeze contracts

`reference/scripts/deploy.ts` was written before the audit pass. It is missing:
- TrustRegistryV2 (not original TrustRegistry)
- ServiceAgreement (with guardian + watchtower hooks)
- DisputeArbitration
- CapabilityRegistry
- ARC402Guardian (circuit breaker)
- WatchtowerRegistry
- AgreementTree

**Required before running on mainnet:**
Update `deploy.ts` to:
1. Deploy all contracts in correct dependency order
2. Wire authorised updaters on TrustRegistryV2 (ServiceAgreement, DisputeArbitration)
3. Set guardian address on ServiceAgreement
4. Set watchtowerRegistry address on ServiceAgreement
5. Set serviceAgreement address on WatchtowerRegistry and AgreementTree
6. Register WalletFactory with ARC402Registry
7. Verify each address on-chain after deployment
8. Write all addresses to `deployments/base-mainnet.json`

### 1.2 Correct deployment order

```
1. PolicyEngine
2. TrustRegistryV2 (pass v1 address or address(0) if no migration)
3. IntentAttestation
4. SettlementCoordinator
5. CapabilityRegistry
6. ARC402Guardian (circuit breaker)
7. ServiceAgreement (pass PolicyEngine, TrustRegistryV2, Guardian addresses)
8. DisputeArbitration (pass ServiceAgreement, TrustRegistryV2 addresses)
9. WatchtowerRegistry (pass ServiceAgreement address)
10. AgreementTree (pass ServiceAgreement address)
11. ARC402Registry (pass all contract addresses)

Post-deploy wiring:
- TrustRegistryV2.addUpdater(ServiceAgreement)
- TrustRegistryV2.addUpdater(DisputeArbitration)
- ServiceAgreement.setDisputeArbitration(DisputeArbitration)
- ServiceAgreement.setWatchtowerRegistry(WatchtowerRegistry)
- ARC402Guardian.addToCouncil(multisig address)
```

### 1.3 Address verification

After deployment, run a verification script that:
- Reads each contract's stored addresses
- Confirms they match `base-mainnet.json`
- Confirms contract code matches deployed bytecode (Basescan verification)
- Confirms TrustRegistryV2 has correct authorized updaters

**This verification script does not exist yet. Write it alongside the updated deploy.ts.**

### 1.4 Basescan verification

Verify all contract source code on Basescan via:
```
npx hardhat verify --network base <address> <constructor-args>
```

One command per contract. Public source builds trust. Required for serious builders.

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

### 4.1 Update CLI default contract addresses

`cli/src/config.ts` (or equivalent) has testnet addresses. Swap for mainnet addresses from `deployments/base-mainnet.json`.

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
- Adding/removing authorized updaters from TrustRegistryV2
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
