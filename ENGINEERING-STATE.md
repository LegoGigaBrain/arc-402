# ENGINEERING-STATE.md — ARC-402 Working Memory
*Last updated: 2026-03-14 02:00 SAST*

**READ THIS AT THE START OF EVERY SESSION.**
**UPDATE THIS AT THE END OF EVERY SESSION.**
This file is Engineering's memory across context resets.

---

## Current Status

**Protocol:** v1 complete. Testnet live. Audit passed.
**Branch state:** RC merged into main. Main is now the source of truth. ✅
**Next milestone:** Mainnet deployment (pending Lego funding deployer wallet + full deploy script).

---

## What's Done

### Contracts — Base Sepolia (14 deployed)
| Contract | Address |
|----------|---------|
| PolicyEngine | `0x44102e70c2A366632d98Fe40d892a2501fC7fFF2` |
| TrustRegistry v1 | `0x1D38Cf67686820D970C146ED1CC98fc83613f02B` |
| TrustRegistryV2 | `0xfCc2CDC42654e05Dad5F6734cE5caFf3dAE0E94F` |
| TrustRegistry (SA-dedicated) | `0xbd3f2F15F794FDE8B3A59B6643e4b7e985Ee1389` |
| IntentAttestation | `0x942c807Cc6E0240A061e074b61345618aBadc457` |
| SettlementCoordinator | `0x52b565797975781f069368Df40d6633b2aD03390` |
| ARC402Registry | `0x638C7d106a2B7beC9ef4e0eA7d64ed8ab656A7e6` |
| AgentRegistry | `0x07D526f8A8e148570509aFa249EFF295045A0cc9` |
| WalletFactory | `0xD560C22aD5372Aa830ee5ffBFa4a5D9f528e7B87` |
| SponsorshipAttestation | `0xc0d927745AcF8DEeE551BE11A12c97c492DDC989` |
| ServiceAgreement | `0xa214D30906A934358f451514dA1ba732AD79f158` |
| SessionChannels | `0x21340f81F5ddc9C213ff2AC45F0f34FB2449386d` |
| DisputeModule | `0xcAcf606374E29bbC573620afFd7f9f739D25317F` |
| ReputationOracle | `0x410e650113fd163389C956BC7fC51c5642617187` |

**Deployer wallet:** `0x59A32A792d0f25B0E0a4A4aFbFDf514b94B102fB`
**ServiceAgreement uses SA-dedicated TrustRegistry (`0xbd3f...`), not canonical v1/v2.**

All 14 addresses are now wired into `cli/src/config.ts` under `base-sepolia`. ✅

### Tests (on merged main)
- Hardhat: **40 passing, 0 failures** ✅
- Python SDK: **16 passing, 0 failures** ✅
- CLI: builds clean ✅
- Foundry: **452 passing** (Engineering workspace — run `forge test` to confirm)

### Audit
- Machine audit: Slither / Wake / Mythril — all clean or documented false positives
- AI audit (Opus + Sonnet × 3 sessions): all 7 BLOCKERS + 6 REQUIRED items fixed
- Re-audit: PASS — no new findings

### E2E Tests
| Suite | Status | Notes |
|-------|--------|-------|
| A | PASS | Happy path: propose/accept/deliver/verify |
| B-1 | PASS | Agreement cancelled, client refunded — tx `0x2f8f3d69` |
| B-2 | PASS | Agreement fulfilled, provider wins 2-of-3 arbitration — tx `0x845024ee` |
| B-3 | SKIP | 30-day wait |
| B-4 | SKIP | 3-day wait |
| E (TS SDK) | PASS | All 13 SDK modules against testnet |
| F (Python SDK) | PASS | All 6 modules against testnet |
| G | PASS | **First cognitive signature sold. Blaen→GigaBrain. Agreement #6. Tx: `0xd87e0ea6...`** |

### SDKs
- **TypeScript SDK:** All modules working on testnet
- **Python SDK:** 16 tests passing. `dispute_arbitration.py` module built but DisputeArbitration not yet deployed on testnet
- **CLI:** Smart wallet routing live. `hire/accept/deliver/verify/cancel/dispute` all built
- **Wallet commands:** `arc wallet new/fund/balance/deploy/send/import/policy` — all built

### Branch State
```
main  ← RC merged in (2026-03-14). This is now the source of truth.
rc/2026-03-12-preseal  ← preserved, do not delete
```

Merge resolved 6 conflicts: `.gitignore`, `cli/src/index.ts`, `web/.env.example`,
`web/package.json`, `web/tsconfig.json`, `web/vercel.json`.
Post-merge fix: HDNodeWallet type error in `wallet.ts` — resolved.

---

## What's Next (in order)

### 1. Complete the deploy script — Engineering task
`reference/scripts/deploy.ts` currently deploys only 5 contracts. Needs all core contracts:
- DisputeArbitration (not deployed anywhere yet — CLI + SDK are ready)
- AgreementTree
- ARC402Wallet (WalletFactory is live, but no wallet instance deployed)
- ARC402Guardian
- ARC402Governance
- WatchtowerRegistry
- CapabilityRegistry
- GovernedTokenWhitelist
- X402Interceptor

ZK contracts (ZKCapabilityGate, ZKSolvencyGate, ZKTrustGate, verifiers) → v2 scope, skip for now.

The script must also wire contracts together:
- Add DisputeArbitration as TrustRegistry updater (currently only wallet is added)
- Register DisputeArbitration address in ServiceAgreement

### 2. Add Base Mainnet to hardhat.config.ts — Engineering task
Currently only `hardhat` (local) and `baseSepolia` exist. Add:
```ts
baseMainnet: {
  url: process.env.BASE_MAINNET_RPC_URL || "https://mainnet.base.org",
  chainId: 8453,
  accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : []
}
```

### 3. ServiceAgreement size — watch carefully
ServiceAgreement is at **97.8% of EIP-170** (24,035 / 24,576 bytes).
Do NOT add functions, error strings, or imports to ServiceAgreement without checking size first.
Run: `python3 -c "import json; d=json.load(open('artifacts/contracts/ServiceAgreement.sol/ServiceAgreement.json')); print((len(d['deployedBytecode'])-2)//2, 'bytes')"` before any SA change.

### 4. Mainnet deployment
After steps 1 + 2:
```bash
npx hardhat run scripts/deploy.ts --network baseMainnet
```
Then update `cli/src/config.ts` mainnet section with real addresses (currently all `0x000...`).

### 5. Freeze tag
After mainnet deploy + config update:
```bash
git tag v1.0.0-mainnet
git push origin v1.0.0-mainnet
```

### 6. Vercel deploy
`web/` directory contains arc402.xyz signing page. WalletConnect Project ID: `455e9425343b9156fce1428250c9a54a`. Pending DNS config for arc402.xyz.

---

## Contract Size Reference
| Contract | Size | % of EIP-170 |
|----------|------|-------------|
| ServiceAgreement | 24,035 | **97.8%** ⚡ |
| DisputeModule | 17,317 | 70.5% |
| DisputeArbitration | 15,360 | 62.5% |
| WalletFactory | 15,083 | 61.4% |
| ARC402Wallet | 13,161 | 53.6% |
| PolicyEngine | 13,096 | 53.3% |
| SessionChannels | 10,896 | 44.3% |
| AgentRegistry | 10,006 | 40.7% |
| (all others < 40%) | | |

---

## Critical Rules (never forget)

- **Do NOT publish the ARC-402 OpenClaw skill to ClawHub before launch**
- **Do NOT contact Lego directly — ask GigaBrain first** (corrected 2026-03-13)
- `via_ir = true` in foundry.toml causes 40+ min compile hangs — keep **OFF**
- ServiceAgreement uses **SA-dedicated TrustRegistry** (`0xbd3f...`), not canonical v1/v2
- Repo is **private** until 5 days before article drops
- Do not mention souls.zip by name in any public-facing content
- GITHUB-LAUNCH-PREP.md is gitignored — lives in Engineering workspace only, not in repo

---

## Key Decisions (locked, do not relitigate)

- Protocol is immutable v1. No upgradeable proxies.
- Wallet has migration function for contract upgrades. Contracts themselves are fixed.
- `via_ir` optimizer: OFF. Standard optimizer (runs=1) + contract split achieves size targets.
- SessionChannels extracted as separate contract (architectural split, not just size fix)
- Arbitration: 3% / $5 floor / $250 cap. Unilateral + mutual modes. 3 dispute classes.
- Trust writes are verdict-driven. PROVIDER_WINS → recordSuccess. CLIENT_REFUND → recordAnomaly.
- No party bonds in v1. Arbitrator bond only. Broad slashing rejected.
- MCP framing abandoned — ARC-402 is commerce layer, not competing with MCP.
- IPFS is public. Sensitive deliverables: encrypted IPFS or private HTTPS. Protocol doesn't enforce.
- Community: X only at launch. No Discord until adoption proves it.
- ZK contracts (ZKCapabilityGate, ZKSolvencyGate, etc.) → v2 scope. Do not deploy in v1.

---

## Architecture Quick Reference

```
Hire → negotiate → propose() → accept() → deliver() → verify()
                                              ↓
                                       openDispute() → arbitration → finalizeDispute()
                                              ↓
                                       expiredTimeout() → auto-refund

Session channel: open → send signed messages → close (or challenge → finalize)
Policy: every spend checked → daily limits → velocity limits → per-agreement caps
Trust: every outcome → recordSuccess / recordAnomaly / recordArbitratorSlash
```

---

## Key Files

| File | What it is |
|------|-----------|
| `ENGINEERING-STATE.md` | **This file. Read first, update last.** |
| `CLI-SPEC.md` | Full CLI visual design (ASCII art banner, all commands) |
| `GITHUB-LAUNCH-PREP.md` | Launch checklist (gitignored — local only) |
| `E2E-TEST-SPEC.md` | All E2E test suites + testnet tx hashes |
| `specs/` | Specs 1–27 |
| `reference/audit-reports-final/` | Final audit reports |
| `reference/SECURITY-ASSUMPTIONS-RC0.md` | Security model |
| `docs/state-machine.md` | Full 12-state protocol state diagram |
| `docs/THREAT-MODEL.md` | Threat model |
| `docs/agent-lifecycle.md` | Agent onboarding lifecycle |
| `skills/arc402-agent/SKILL.md` | OpenClaw agent skill — v0.2.0, pre-release |

---

*Update this file at the end of every session. The next session depends on it.*
