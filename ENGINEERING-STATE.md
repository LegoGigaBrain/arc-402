# ARC-402 Engineering State
*Last updated: 2026-03-19 18:33 SAST (ARC-402 OpenShell policy UX presets/toggles shipped)*

---

## 2026-03-19 Launch-scope web/runtime sweep

- Launch-facing framing was corrected again: ARC-402 is now described as a singular product for agent-to-agent hiring with governed sandboxed execution, while OpenShell is consistently treated as underlying runtime safety infrastructure rather than a separate launch product.
- Launch hub now links the real launch pages (`/onboard`, `/passkey-setup`, `/passkey-sign`, `/sign`) instead of a dead coming-soon placeholder.
- Onboarding web flow is aligned to launch scope only: normal owner-wallet gas, no paymaster/gas sponsorship path, no Privy/email assumptions.
- Launch docs were rewritten to match the current production surface: onboarding web flow, passkey signing flow, and OpenClaw/OpenShell as the default runtime home.
- Documentation sweep added a dedicated `docs/launch-scope.md` covering what ARC-402 is / is not, supported payment patterns, user stories, and explicit post-launch boundaries.
- Documentation now treats daemon behavior as absorbed into OpenShell for launch architecture; standalone daemon commands remain tooling/fallback, not the default story.
- User-facing launch wiring was tightened again after founder decision: startup language now consistently frames `arc402 daemon start` as the OpenShell-owned runtime start path, never the primary standalone architecture.
- Spec 35 was corrected to the active WalletFactory v5 / AgentRegistry addresses and explicitly marked as launch-scope only.
- Device E2E for onboarding/passkey flow has been completed once already; planned rerun is from a clean MacBook OpenClaw/OpenShell setup.
- Added `docs/launch-readiness-prd.md` as the tracked execution plan for remaining launch work.
- Local runtime validation on PC progressed: Docker installed and running; OpenShell installed (`openshell 0.0.10`); gateway bootstrapped; ARC-402 OpenShell policy/providers/sandbox configured and `arc402 openshell status` now reports OpenShell-owned daemon mode.
- Ergonomics smoothing pass applied across launch-facing surfaces: README/getting-started now make the phone-vs-machine split explicit, OpenShell version quirks are framed as ARC-402 implementation detail, launch PRD now tracks setup-friction tasks, and SDKs expose operator-centric aliases (`ARC402OperatorClient`, `ARC402Operator`).
- OpenShell one-click pass shipped the missing runtime-provisioning seam: `arc402 openshell init` now packages the local ARC-402 CLI runtime (`dist` + `node_modules` + package metadata), uploads it into the sandbox, records the remote runtime root, and `arc402 daemon start` launches from that provisioned in-sandbox bundle instead of assuming host paths exist inside OpenShell.
- Secret-injection blocker is now diagnosed and fixed at the ARC-402 launch seam: OpenShell SSH sessions expose provider env placeholders like `openshell:resolve:env:ARC402_MACHINE_KEY`, so ARC-402 now overlays the real machine-key / notification env values from local CLI config at daemon launch time, and `arc402 openshell status` explicitly reports this materialization mode.
- Tunnel/endpoint launch architecture has now been locked at the PRD level: support multiple tunnel modes later, but ship host-managed Cloudflare Tunnel outside the sandbox as the launch default; use `agentname.arc402.xyz` as the canonical public endpoint shape; and require explicit allowlist policy entries for sandboxed inter-agent HTTPS calls rather than wildcard trust across `.arc402.xyz`.
- Added `docs/launch-implementation-roadmap.md` as the concrete next-phase build sequence covering OpenShell premium hardening, endpoint/tunnel CLI, policy UX presets/toggles, MacBook validation, and GitHub polish order. Launch-facing CLI/skill/spec wording now explicitly separates sandboxed runtime, public ingress, and outbound sandbox policy.
- First endpoint CLI scaffold shipped: `arc402 endpoint init|status|claim|doctor` now persist canonical endpoint config in `~/.arc402/endpoint.json`, keep host-managed public ingress separate from sandboxed runtime, and diagnose the current scaffold layers (config, tunnel process, local target, OpenShell runtime, claim state). DNS parity, AgentRegistry endpoint sync parity, and peer allowlist helpers remain follow-up work.
- Publication-facing install/docs surfaces were normalized around the actual current packages and commands: `arc402-cli` provides the `arc402` command, `openclaw install arc402-agent` is the canonical skill install phrase, TypeScript/Python SDK READMEs now point back to that operator path, and the SDK docs/examples were nudged toward the launch/mainnet mental model.
- First usable OpenShell-facing policy UX layer is now implemented in the CLI: `arc402 openshell policy concepts`, launch-safe presets (`core-launch`, `harness`, `search`, `all`), explicit peer-agent HTTPS allowlist helpers (`peer add|remove|list`), category-aware `policy list`, and clearer status wording that separates public ingress from sandbox outbound policy.

## True Current State

### v1 — LIVE ON BASE MAINNET ✅
Deployed 2026-03-14 at 03:56 SAST. 22 contracts live. Agreement flow functional.

### v2 — LIVE ON BASE MAINNET ✅
Deployed 2026-03-15. 8 new/redeployed contracts live.

### v3 (ERC-4337) — LIVE ON BASE MAINNET ✅ (frozen)
WalletFactory v3 deployed 2026-03-17 using SSTORE2 split-chunk pattern.
Wallet bytecode is 24,300 bytes (runtime) — under EIP-170 limit.
`authorizeMachineKey` confirmed in deployed bytecode.
E2E tested on Base Sepolia before mainnet deploy.

- `WalletFactory_v3_chunk1`: `0x113C2Fc826c6989D03110Ee6bB1357f526e8DE75`
- `WalletFactory_v3_chunk2`: `0x05CCeC2EbD262752cb033F5a73ca0601E7DbcEd8`
- `WalletFactoryV3` (frozen): `0x974d2ae81cC9B4955e325890f4247AC76c92148D`
- Registry: ARC402RegistryV2 `0xcc0D8731ccCf6CFfF4e66F6d68cA86330Ea8B622`
- EntryPoint v0.7: `0x0000000071727De22E5E9d8BAf0edAc6f37da032`

### v4 (Passkey P256) — LIVE ON BASE MAINNET ✅ (frozen)
WalletFactory v4 deployed 2026-03-17 with native passkey (Face ID) P256 signature support. Superseded by V5.

- `WalletFactoryV4` (frozen): `0x35075D293E39d271860fe942cDA208A907990Cc0`
- `WalletCodeOracle v4` (frozen): `0x9D19DB7511C06B8D0bD3aB49c20b3eF13d19C592`

### v5 (Passkey P256, current) — LIVE ON BASE MAINNET ✅
WalletFactory v5 redeployed 2026-03-19 with optimized bytecode (FOUNDRY_PROFILE=deploy). Previous v5 (`0x3f4d…`) frozen — unoptimized bytecode.

- `WalletFactoryV5` ← active: `0xcB52B5d746eEc05e141039E92e3dBefeAe496051`
- `WalletCodeOracle v5` ← active: `0x594B1afdBb899F598fdbe468449EC202f4c4D7BD`
- `WalletFactoryV5` (frozen, unoptimized): `0x3f4d4b19a69344B04fd9653E1bB12883e97300fE`
- `WalletFactoryV5 chunk1` / `WalletCodeOracle v5` (frozen): `0xd5e015a3F6A608888fe7d3EEd0A990562F692a43`
- `WalletFactoryV5 chunk2` (frozen): `0xca331Db70228875acC57eda60127Af7c38Ab53D2`
- Registry: ARC402RegistryV2 `0xcc0D8731ccCf6CFfF4e66F6d68cA86330Ea8B622`
- EntryPoint v0.7: `0x0000000071727De22E5E9d8BAf0edAc6f37da032`

### GigaBrain Agent Wallet v5 (ACTIVE) — FULLY OPERATIONAL ✅
`0xCC0Ee5899787607C01D2a97fC4c488f64694bbb1`
- Deployed 2026-03-17 (protocol bypass fix — no whitelist needed for core protocol contracts)
- Owner: `0x7745772d67Cd52c1F38706bF5550AdcD925c7c00` (Lego's MetaMask)
- Factory: WalletFactoryV5 `0xcB52B5d746eEc05e141039E92e3dBefeAe496051`
- Machine key: ✅ AUTHORIZED — `0x747024C2e59C523E3B1621A4b3F92366C1E28A30`
- PE registered: ✅ | DeFi enabled: ✅ | general limit: 0.001 ETH ✅
- AgentRegistry: ✅ registered (name: GigaBrain, type: intelligence)
- Balance: ~0.000771 ETH
- CLI config: ✅ pointing here

### GigaBrain Agent Wallet v4 (OLD — drain pending)
`0xb4aF8760d349a6A4C8495Ae4da9089bC84994eE6`
- Owner: `0x7745772d67Cd52c1F38706bF5550AdcD925c7c00` (Lego's MetaMask)
- Factory: WalletFactoryV3
- Machine key: ✅ authorized — `0x747024C2e59C523E3B1621A4b3F92366C1E28A30`
- Balance: 0.0005 ETH — ⏳ PENDING DRAIN to MetaMask (blocked by MetaMask crash)
- v5 already whitelisted on PolicyEngine ✅
- Auth tx: `0x3b906fb2f1a9948bca0c1a3f32e7019a97459a06fe42716813398483925e1d1d`

---

## v2 Mainnet Contract Addresses (Base Mainnet, chain 8453)

Active v2 contracts (use these):

| Contract | Address |
|----------|---------|
| PolicyEngine | `0xAA5Ef3489C929bFB3BFf5D5FE15aa62d3763c847` |
| TrustRegistry (v1, keep) | `0x6B89621c94a7105c3D8e0BD8Fb06814931CA2CB2` |
| TrustRegistryV2 (ref only) | `0xdA1D377991B2E580991B0DD381CdD635dd71aC39` |
| TrustRegistryV3 ← active | `0x22366D6dabb03062Bc0a5E893EfDff15D8E329b1` |
| IntentAttestation | `0x7ad8db6C5f394542E8e9658F86C85cC99Cf6D460` |
| SettlementCoordinator | `0x6653F385F98752575db3180b9306e2d9644f9Eb1` |
| ARC402Registry (v1, frozen) | `0xF5825d691fcBdE45dD94EB45da7Df7CC3462f02A` |
| ARC402RegistryV2 ← active | `0xcc0D8731ccCf6CFfF4e66F6d68cA86330Ea8B622` |
| AgentRegistry | `0xD5c2851B00090c92Ba7F4723FB548bb30C9B6865` |
| WalletFactory v1 (frozen) | `0x0092E5bC265103070FDB19a8bf3Fa03A46c65ED2` |
| WalletFactory v2 (frozen) | `0x67b92B842Ee44671762E44D347d76a6895EFF9e2` |
| WalletFactory v3 (frozen) | `0x974d2ae81cC9B4955e325890f4247AC76c92148D` |
| WalletFactory v3 chunk1 | `0x113C2Fc826c6989D03110Ee6bB1357f526e8DE75` |
| WalletFactory v3 chunk2 | `0x05CCeC2EbD262752cb033F5a73ca0601E7DbcEd8` |
| WalletFactory v4 (frozen) | `0x35075D293E39d271860fe942cDA208A907990Cc0` |
| WalletCodeOracle v4 (frozen) | `0x9D19DB7511C06B8D0bD3aB49c20b3eF13d19C592` |
| WalletFactory v5 (frozen, unoptimized) | `0x3f4d4b19a69344B04fd9653E1bB12883e97300fE` |
| WalletFactory v5 chunk1 / WalletCodeOracle v5 (frozen) | `0xd5e015a3F6A608888fe7d3EEd0A990562F692a43` |
| WalletFactory v5 chunk2 (frozen) | `0xca331Db70228875acC57eda60127Af7c38Ab53D2` |
| WalletFactory v5 ← active (optimized) | `0xcB52B5d746eEc05e141039E92e3dBefeAe496051` |
| WalletCodeOracle v5 ← active | `0x594B1afdBb899F598fdbe468449EC202f4c4D7BD` |
| SponsorshipAttestation | `0xD6c2edE89Ea71aE19Db2Be848e172b444Ed38f22` |
| ServiceAgreement (v1, frozen) | `0x78C8e4d26D74d8da80d03Df04767D3Fdc3D9340f` |
| ServiceAgreement ← active | `0xC98B402CAB9156da68A87a69E3B4bf167A3CCcF6` |
| SessionChannels (v1, frozen) | `0xA054d7cE9aEa267c87EB2B3787e261EBA7b0B5d0` |
| SessionChannels ← active | `0x578f8d1bd82E8D6268E329d664d663B4d985BE61` |
| DisputeModule (v1, frozen) | `0x1c9489702B8d12FfDCd843e0232EB59C569e1fA6` |
| DisputeModule ← active | `0x5ebd301cEF0C908AB17Fd183aD9c274E4B34e9d6` |
| DisputeArbitration (v1, frozen) | `0xc5e9324dbd214ad5c6A0F3316425FeaC7A71BE2D` |
| DisputeArbitration ← active | `0xF61b75E4903fbC81169FeF8b7787C13cB7750601` |
| VouchingRegistry (new) | `0x94519194Bf17865770faD59eF581feC512Ae99c9` |
| MigrationRegistry (new) | `0xb60B62357b90F254f555f03B162a30E22890e3B5` |
| ReputationOracle | `0x359F76a54F9A345546E430e4d6665A7dC9DaECd4` |
| ARC402Governance | `0xE931DD2EEb9Af9353Dd5E2c1250492A0135E0EC4` |
| ARC402Guardian | `0xED0A033B79626cdf9570B6c3baC7f699cD0032D8` |
| ARC402Wallet (factory instance) | `0xfd5C8c0a08fDcdeD2fe03e0DC9FA55595667F313` |
| AgreementTree | `0x6a82240512619B25583b9e95783410cf782915b1` |
| CapabilityRegistry | `0x7becb642668B80502dD957A594E1dD0aC414c1a3` |
| GovernedTokenWhitelist | `0xeB58896337244Bb408362Fea727054f9e7157451` |
| WatchtowerRegistry | `0xbC811d1e3c5C5b67CA57df1DFb08847b1c8c458A` |
| X402Interceptor | `0x47aEbD1d42623e78248f8A44623051bF7B941d8B` |

**EntryPoint (Base mainnet v0.7):** `0x0000000071727De22E5E9d8BAf0edAc6f37da032`

**Lego's personal agent wallet:** `0xB7840152eB82bBdA0Ca9f6012bd42C63C96dCD2b`
- Live on Base mainnet (v2 wallet — old contract, no ERC-4337)
- Pending `proposeRegistryUpdate(ARC402RegistryV2)` → 2-day timelock → `executeRegistryUpdate()`

---

## What Was Built (2026-03-17 Session — Launch Day)

### GigaBrain Agent — FULLY OPERATIONAL ✅

| Milestone | Details |
|-----------|---------|
| Wallet deployed | `0xb4aF8760d349a6A4C8495Ae4da9089bC84994eE6` via WalletFactoryV3 |
| Machine key authorized | `0x747024C2` — tx `0x3b906fb2` |
| AgentRegistry registration | tx `0x7e1e4c0b` — **first ERC-4337 UserOp by machine key** |
| Capabilities update | `["cognitive.signature"]` — tx `0xb1c75ac3` |
| PolicyEngine: DeFi access | Enabled for wallet |
| PolicyEngine: AgentRegistry whitelisted | tx `0xdf74410d` |
| Subdomain transfer | `gigabrain.arc402.xyz` → `0xb4aF8760` |
| Cloudflare tunnel | `7a101bba` — 4 connections live (cpt01 + jnb01) |

### CLI

| Command / Change | Description |
|-----------------|-------------|
| `arc402 wallet wc-reset` | Clears stale WalletConnect sessions (file + directory formats) |
| `arc402 wallet whitelist-contract <target>` | Whitelists contract on PolicyEngine |
| `arc402 agent register/update` | Rerouted through `executeContractWriteViaWallet` |
| `arc402 agent claim-subdomain` | New command |
| Bug fix: agent commands | Use `agentRegistryV2Address` not `ARC402RegistryV2` |
| `cli/scripts/register-agent-userop.ts` | Standalone ERC-4337 UserOp — machine key signs, no MetaMask |

---

## What Was Built (2026-03-16 Session)

### Contracts

| Thing | Status | Notes |
|-------|--------|-------|
| Fix 1: machine key auth | ✅ Done | `openContext`, `closeContext`, `attest`, `executeSpend` now accept machine keys |
| ERC-4337 IAccount implementation | ✅ Built | `validateUserOp`, governance op detection, ECDSA owner sig |
| ERC-4337 security audit | ✅ Done | 6 findings: 1 Critical + 1 High fixed. Full report: `audit/AUDIT-ERC4337-2026-03-16.md` |
| WalletFactory v3 | ✅ Built | Passes EntryPoint address to new wallets |
| Bytecode: 23,072 bytes | ✅ Under limit | Was 29,651 before optimization |

### CLI

| Thing | Status |
|-------|--------|
| `hire`/`deliver`/`accept` → wallet routing | ✅ Done | Now routes through `wallet.executeContractCall()` |
| `arc402 daemon start/stop/status/logs` | ✅ Built | Full daemon process with IPC, SQLite, PID file |
| `arc402 daemon init` | ✅ Built | Generates template `daemon.toml` |
| `arc402 daemon approve/reject <id>` | ✅ Built | Manual hire approval flow |

### TypeScript SDK

| Thing | Status |
|-------|--------|
| `BundlerClient` class | ✅ Done | `sendUserOperation`, `getUserOperationReceipt`, `estimateUserOperationGas` |
| `buildUserOp` helper | ✅ Done | Pulls live fee data, fills gas limits |
| ERC-4337 v0.7 `UserOperation` type | ✅ Done |

### Specs

| Spec | Status |
|------|--------|
| 30 — ERC-4337 Wallet Standard | ✅ Complete |
| 31 — Bundler Network | ✅ Written 2026-03-16 |
| 32 — Daemon | ✅ Written 2026-03-16 |
| 33 — Passkey Authentication | ✅ Written 2026-03-16 |

### Web App (`app.arc402.xyz`)

| Page | Status |
|------|--------|
| `/sign` — WalletConnect governance signing | ✅ Live |
| `/passkey-setup` — Face ID registration | ✅ Live |
| `/passkey-sign` — Face ID governance signing | ✅ Live |
| Deployment to Cloudflare Pages | ✅ Live at app.arc402.xyz |

---

## Next Steps (in order)

```
1.  ✅ Fix 1: machine key auth
2.  ✅ ERC-4337 wallet implementation + audit (mega audit 2026-03-16)
3.  ✅ Daemon built (CLI)
4.  ✅ BundlerClient SDK (TypeScript + Python)
5.  ✅ Passkey signing pages built + app.arc402.xyz live on Cloudflare Pages
6.  ✅ WalletFactory v3 deployed to mainnet (SSTORE2 split-chunk, E2E tested) — 2026-03-17
7.  ✅ E2E tests written
8.  ✅ SettlementCoordinatorV2 deployed + registry updated — 2026-03-17
9.  ✅ All docs/SDK/CLI updated with new addresses — 2026-03-17
10. ✅ Lego deployed GigaBrain wallet — `0xb4aF8760d349a6A4C8495Ae4da9089bC84994eE6`
11. ✅ Machine key authorized — `0x747024C2` on wallet `0xb4aF8760`
12. ✅ gigabrain.arc402.xyz transferred to `0xb4aF8760`
13. ✅ GigaBrain registered in AgentRegistry — tx `0x7e1e4c0b` (ERC-4337 UserOp)
14. ✅ PolicyEngine: DeFi access enabled + AgentRegistry whitelisted — tx `0xdf74410d`
15. ✅ Cloudflare tunnel live — `7a101bba`, 4 connections (cpt01 + jnb01)
16. ✅ Daemon config written (`~/.arc402/daemon.toml`)
17. ✅ wc-reset command shipped (stale session fix + ping-before-resume)
18. ✅ WalletFactory v4 deployed to mainnet — passkey P256 support live — 2026-03-17 (now frozen)
18b. ✅ WalletFactory v5 deployed to mainnet (unoptimized, now frozen) — `0x3f4d4b19a69344B04fd9653E1bB12883e97300fE` — 2026-03-18
18c. ✅ WalletFactory v5 redeployed with optimized bytecode (FOUNDRY_PROFILE=deploy) — `0xcB52B5d746eEc05e141039E92e3dBefeAe496051` — 2026-03-19
19. → Re-validate one-click OpenShell runtime path end to end (`arc402 openshell init` provisions runtime bundle, then `arc402 daemon start` launches that in-sandbox bundle)
20. ~~Lego: `proposeRegistryUpdate(ARC402RegistryV2)` on `0xB7840152`~~ — OBSOLETE (personal wallet deprecated)
21. → Passkey governance test (`/passkey-setup` + `/passkey-sign`)
22. → ERC-4337 full mega audit (before tagging v1.0)
23. → Article: "Agents with Wallets is Not Enough" — first draft
24. → Docs, README polish, v1.0 tag
```

**HARD RULE:** No deployments happen without explicit Lego approval.
**HARD RULE:** Protocol deployer key (`0x59A32A...`) must NEVER be used to deploy agent wallets.

---

## Key Architecture Decisions (locked)

- **Registry is the version signal.** ARC402RegistryV2 = v2 system.
- **v1 is immutable.** 22 contracts on mainnet, untouched forever.
- **v2 is additive.** New contracts + redeployments. Users migrate via `proposeRegistryUpdate()`.
- **No admin setters.** Immutability preserved.
- **ERC-4337 wallet is v3.** New deployments via WalletFactory v3. Old wallets (v2) stay immutable.
- **Master key = governance only.** Signs governance UserOps (setGuardian, proposeRegistryUpdate, etc). Never operational.
- **Machine key = autonomous operations.** hot key, bounded by PolicyEngine. Authorized via `authorizeMachineKey()`.
- **Guardian key = emergency freeze only.** Cannot unfreeze — only owner can.
- **EntryPoint v0.7.** Base mainnet: `0x0000000071727De22E5E9d8BAf0edAc6f37da032`.
- **`via_ir = false`.** Causes 40+ min compile hangs. Keep OFF.
- **`FOUNDRY_PROFILE=deploy` is MANDATORY for all deployments.** The default profile produces unoptimized bytecode that exceeds EIP-170 (24KB). The `deploy` profile enables the optimizer (runs=200). Lesson from 2026-03-19: v5 factory `0x3f4d…` was deployed without optimizer — bytecode was valid but unoptimized, now frozen.
- **Repo private** until 5 days before article.
- **Launch daemon path:** OpenShell owns daemon startup for launch (`arc402 openshell init` → `arc402 daemon start`). Do not frame standalone daemon startup as a launch step.
- **Launch onboarding scope excludes phase 2:** no Privy/email/social auth and no gas sponsorship in the launch web flow.

---

## Audit Status

| Audit | Status |
|-------|--------|
| v1 mega audit (2026-03-14) | ✅ Complete — 6 blockers fixed |
| v2 second-model audit (2026-03-14) | ✅ Complete |
| ERC-4337 targeted audit (2026-03-16) | ✅ Complete — 2 Critical/High fixed. Report: `audit/AUDIT-ERC4337-2026-03-16.md` |
| ERC-4337 full mega audit | ⏳ Needed before mainnet deploy |

---

## File Locations

| Thing | Path |
|-------|------|
| Protocol contracts | `reference/contracts/` |
| SDK | `reference/sdk/src/` |
| CLI | `cli/src/` |
| Daemon | `cli/src/daemon/` |
| Deploy scripts | `reference/script/` |
| Specs | `spec/` |
| Docs | `docs/` |
| Web app | `web/app/` |
| Subdomain worker | `subdomain-worker/` |
| Audit reports | `audit/` |
| Engineering workspace | `/home/lego/.openclaw/workspace-engineering/products/arc-402/` |

---

## Specs Status

| # | Name | Status |
|---|------|--------|
| 01-17 | Core protocol | ✅ v1 live on mainnet |
| 18 | Discovery/Search | ✅ |
| 19 | Multi-party agreements | ✅ |
| 20 | Protocol versioning | ✅ |
| 21 | Relay architecture | ✅ |
| 22 | Watchtower | ✅ |
| 23 | Agent metadata | ✅ |
| 24 | Deliverable types | ✅ |
| 25 | Deliverable privacy | ✅ |
| 26 | Contract interaction | ✅ |
| 28 | Trust score time-weighting | ✅ |
| 29 | Wallet migration policy | ✅ |
| 30 | ERC-4337 wallet standard | ✅ 2026-03-16 |
| 31 | Bundler network | ✅ 2026-03-16 |
| 32 | Daemon | ✅ 2026-03-16 |
| 33 | Passkey authentication | ✅ 2026-03-16 |
| 34 | OpenShell integration | ✅ 2026-03-19 — premium one-click pass landed; provider-placeholder launch blocker fixed by ARC-402 secret overlay at daemon start; remaining blocker is remote state bridge / proxy validation inside sandbox |
| 35 | Website (arc402.xyz) | ✅ 2026-03-17 — ready to build |
| 12 | Privacy model | 🔲 Post-launch |
| 13 | ZK extensions | 🔲 Post-launch (ceremony) |
| 15 | Transport agnostic | 🔲 Post-launch |
| 27 | Soulbound identity | 🔲 Post-launch |

---

## Wallets in Use

| Wallet | Address | Status |
|--------|---------|--------|
| Lego personal agent wallet | `0xB7840152eB82bBdA0Ca9f6012bd42C63C96dCD2b` | v2 contract, deprecated. Use v5 GigaBrain wallet instead. |
| GigaBrain agent wallet | `0xb4aF8760d349a6A4C8495Ae4da9089bC84994eE6` | Deployed 2026-03-17. Owner: Lego MetaMask. Machine key ✅ authorized. AgentRegistry ✅ registered. PolicyEngine ✅ configured. Tunnel ✅ live. |
| Old GigaBrain (v1, discard) | `0xC3207bFe22cba39AeC4e8540c97c29B028103c7F` | v1 contract, 0.00025 ETH parked, no machine key |
| Discard — old bytecode | `0x2D15d...` | Deployed today from stale oracle, no machine key |
| Discard — old bytecode | `0xC71d05...` | Deployed today from stale oracle, no machine key |
| Discard — unauthorized deploy | `0xe5E47ff...` | Has authorizeMachineKey but deployed by protocol deployer, not Lego |
| Protocol deployer (restricted) | `0x59A32A792d0f25B0E0a4A4aFbFDf514b94B102fB` | Protocol contracts only. Never for agent wallets. |
| Machine key (agent EOA) | `0x747024C2e59C523E3B1621A4b3F92366C1E28A30` | Authorized on-wallet via authorizeMachineKey() |
| Lego MetaMask (owner EOA) | `0x7745772d...` | Used to own/deploy GigaBrain wallet |

---

*Update this file at the end of every session.*
