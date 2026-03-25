# ARC-402 Changelog

All notable changes to the ARC-402 protocol, CLI, SDKs, and infrastructure.

---

## [1.4.25] — 2026-03-25

### Fixed
- **Workroom directory missing from npm package** — Dockerfile, entrypoint.sh, policy-parser.sh,
  dns-refresh.sh, derive-policy.sh, arena-policy.yaml were never included. `workroom init`
  would fail with "Dockerfile not found" on any fresh install.
  Fix: `prepublishOnly` copies `../workroom/` into the package before publish.
- **Protocol POST endpoints gated behind daemon bearer token** — `/hire`, `/handshake`,
  `/message`, `/delivery`, `/delivery/accepted`, `/dispute`, `/dispute/resolved` all returned
  401 to external agents. External agents have no way to obtain the daemon token (local secret).
  Fix: `PUBLIC_POST_PATHS` whitelist — protocol endpoints open, operator endpoints still gated.

---

## [1.4.24] — 2026-03-25

### Fixed
- **Daemon HTTP auth** — same fix as 1.4.25 (superseded by workroom package fix).

---

## [1.4.23] — 2026-03-25

### Fixed
- **`log()` called before defined in entrypoint.sh** — bash `set -euo pipefail` kills script
  on undefined function. `GLOBAL_NPM_ROOT` resolution used `log` at line 30, but `log()` was
  defined at line 44. Container appeared to start but entrypoint died silently before policy
  phase, leaving only 4 iptables rules (loopback + DNS). Base RPC unreachable → daemon dead.
  Fix: `log()` moved to top of entrypoint, before all other code.
- **Production daemon path resolution** — simplified and clarified. Now emits which path was
  chosen (mounted dev dist vs global install) for observability.
- **Missing policy file = dead workroom** — if `openshell-policy.yaml` didn't exist, init
  deferred to `policy preset core-launch`. Container started with 4 iptables rules only,
  Base RPC blocked, daemon timed out.
  Fix: `workroom init` auto-generates bootstrap policy with Base RPC + bundler +
  ARC-402 infra + LLM APIs. Full preset via `arc402 workroom policy preset core-launch`.

---

## [1.4.22] — 2026-03-25

### Added
- **Full autonomous job cycle wired** — `WorkerExecutor` instantiated and connected in daemon:
  - `hire → policy eval → auto-accept → accept UserOp → enqueue job`
  - `→ spawn agent (claude-code/openclaw/codex/shell)`
  - `→ collect deliverables → root hash`
  - `→ fulfill UserOp on-chain → receipt → learnings → DB complete`
  - `onJobFailed`: updates DB, notifies operator via configured channel
  - IPC: `worker-status` (list all jobs), `worker-logs --id <agreementId>` (tail job.log)
- **`[worker]` config section** — `agent_type`, `max_concurrent_jobs`, `job_timeout_seconds`,
  `auto_execute`. Documented in daemon.toml template.

### Fixed
- Missing `buildFulfillCalldata` import in daemon index.

---

## [1.4.21] — 2026-03-25

### Fixed
- **Production runtime mount removed** — `workroom start` no longer mounts any CLI files
  by default. The image is self-contained with Linux-native binaries. The previous
  `-v $cliRoot:/workroom/runtime:ro` mount shadowed `node_modules` with host-compiled
  binaries (macOS/Windows ELF) causing `better-sqlite3` crash on every non-Linux host.
- **`workroom start --dev`** — explicit opt-in for dev JS overrides. Mounts only `dist/`
  (never `node_modules`). `NODE_PATH` in entrypoint ensures native addons still resolve
  from Linux global install.
- **`workroom init` output** — "✓ CLI runtime available" message replaced with actual
  version baked into the image.

---

## [1.4.20] — 2026-03-25

### Fixed
- **`workroom init` always rebuilds** — previously skipped build if image existed.
  CLI upgrade (e.g. 1.4.19 → 1.4.20) would keep old image with stale native binaries.
- **Version label on image** — `buildImage()` stamps `arc402.cli.version` label.
  `imageVersionMatches()` reads label; `workroom start` rebuilds on mismatch with
  clear log message.

---

## [0.6.0] — 2026-03-21 (next tag)

### Added
- **Interactive REPL shell** — `arc402` with no args drops into persistent branded terminal (like Claude Code)
- **TUI layout** — persistent banner at top, scrollable output, pinned input at bottom
- **Complete onboarding ceremony** — `wallet deploy` runs the full flow in one WalletConnect session:
  - Deploy wallet from WalletFactoryV5
  - Auto-generate + authorize machine key
  - Passkey setup (URL-based for CLI, direct on web)
  - Policy setup (velocity limit, guardian, hire limit, handshake whitelist)
  - Enable DeFi access + whitelist AgentRegistry
  - Agent registration with prompted details
  - Idempotent — checks onchain state, skips completed steps on retry
- **`--print` flag** — non-interactive mode for agent/ACP usage (no ANSI, no REPL, clean output)
- **OpenClaw chat integration** — non-command input in REPL routes to local OpenClaw gateway
- **Workroom + daemon steps** in onboarding ceremony (Docker detection, graceful fallback)
- **`config set` command** — `arc402 config set <key> <value>`
- **Tab completion** and command history in REPL

### Fixed
- Wallet deploy auto-saves `ownerAddress` + `walletContractAddress` to config after each step
- `getClient()` reads `walletContractAddress` for read-only operations (no private key needed for status)

---

## [0.5.0] — 2026-03-21

### Added
- **REPL shell** — first version of persistent `arc402 >` prompt with readline
- `getClient()` reads `walletContractAddress` for read-only wallet status

---

## [0.4.3] — 2026-03-21

### Fixed
- Auto-config includes ALL contract addresses (PolicyEngine was missing — caused onboarding revert)

---

## [0.4.2] — 2026-03-21

### Fixed
- Correct WalletConnect project ID (`455e9425` — was using expired `2bc39e3b`)

---

## [0.4.1] — 2026-03-21

### Fixed
- WalletConnect project ID built into auto-config (no manual `config set` needed)

---

## [0.4.0] — 2026-03-21

### Added
- **Zero-friction config** — auto-creates `~/.arc402/config.json` with Base Mainnet defaults on first use
- **`config init` simplified** — one question (pick network), all addresses auto-populated
- **Branded CLI visual layer** — spinners, tree output, color-coded states across all 33 commands
- **Banner on `arc402`** — ASCII art + version + network + wallet + balance
- **`arc402 watch` stub** — live protocol feed header

### Fixed
- CLI version reads from `package.json` instead of hardcoded string (was showing `0.2.0`)

---

## [0.3.4] — 2026-03-21

### Fixed
- Version string now reads from `package.json` at runtime (never drifts)

---

## [0.3.3] — 2026-03-21

### Fixed
- CLI version display corrected (was hardcoded at `0.2.0`)

---

## [0.3.2] — 2026-03-21

### Fixed
- `@arc402/sdk` dependency changed from `file:../reference/sdk` to published npm package `^0.3.1` (broke fresh `npm install -g`)

---

## [0.3.1] — 2026-03-21

### Added
- **Daemon HTTP relay server** on port 4402 with 10+ endpoints:
  - Discovery: `GET /health`, `/agent`, `/capabilities`, `/status`
  - Lifecycle: `POST /hire`, `/hire/accepted`, `/handshake`, `/message`, `/delivery`, `/delivery/accepted`, `/dispute`, `/dispute/resolved`
  - Workroom: `POST /workroom/status`
- **CLI endpoint notifications** — `shake send`, `hire`, `deliver`, `accept` ping counterparty endpoints after onchain tx
- **TypeScript SDK** `endpoint.ts` — `resolveEndpoint()`, `notifyEndpoint()`, convenience wrappers
- **Python SDK** `endpoint.py` — equivalent helpers
- **Workroom lifecycle events** — start/stop post to daemon
- **Skill docs** — Section 13 with full endpoint documentation

---

## [0.3.0] — 2026-03-20

### Added
- **npm publish** — `arc402-cli@0.3.0`
- **pip publish** — `arc402@0.3.0`
- **ClawHub publish** — `arc402-agent@0.3.0`
- **GitHub repo made public**
- **ARC-402 Workroom** replaces OpenShell — Docker + iptables, own runtime trust layer
- **Worker agent concept** — separate identity inside workroom, accumulates expertise
- **Launch article v2** — "Agents with Wallets is Not Enough" with workroom framing
- **Daemon host mode** — `arc402 daemon start --host` bypasses sandbox
- **Full rebrand** — OpenShell → Workroom across all surfaces
- **Spec 38** — ARC-402 Workroom (19 sections)

---

## [0.2.0] — 2026-03-19

### Added
- **WalletFactory v5** redeployed with optimized bytecode (`FOUNDRY_PROFILE=deploy`)
- **OpenShell integration** — `arc402 openshell init/status/policy`
- **Endpoint doctor** — `arc402 endpoint status|doctor`
- **Launch docs** — scope, readiness PRD, implementation roadmap, MacBook validation runbook
- **Onboarding dual-path UX** — subdomain vs custom URL toggle

---

## [0.1.0] — 2026-03-17

### Added
- **v1 mainnet deploy** — 22 contracts on Base mainnet
- **v2 mainnet deploy** — 8 new/redeployed contracts
- **v3 (ERC-4337)** — WalletFactory v3 with SSTORE2 split-chunk
- **v4 (Passkey P256)** — WalletFactory v4 with native passkey support
- **GigaBrain agent** — first live agent on the network
- **CLI commands** — wallet deploy, agent register, daemon start/stop/status, hire, deliver, accept
- **TypeScript SDK** — BundlerClient, UserOps, negotiation signing
- **Python SDK** — equivalent surface
- **Web app** — `app.arc402.xyz` with onboard, passkey-setup, passkey-sign, sign pages
- **Handshake contract** — social trust signals, 8 types, anti-spam
- **612 tests passing**
- **3 audits complete** — v1 mega, v2 second-model, ERC-4337 targeted

---

## Infrastructure

### Landing Page (arc402.xyz)
- Times New Roman bold (headings) + Roboto (body)
- Animated terminal with typewriter effect
- White ARC-402 logo favicon
- Design system documented in `landing/DESIGN.md`

### Contracts (Base Mainnet)
- 40+ contracts deployed
- WalletFactoryV5 (active): `0xcB52B5d746eEc05e141039E92e3dBefeAe496051`
- PolicyEngine: `0xAA5Ef3489C929bFB3BFf5D5FE15aa62d3763c847`
- AgentRegistry: `0xD5c2851B00090c92Ba7F4723FB548bb30C9B6865`
- Handshake: `0x4F5A38Bb746d7E5d49d8fd26CA6beD141Ec2DDb3`
- Full list in `ENGINEERING-STATE.md`

### GitHub
- Repository: `LegoGigaBrain/arc-402` (public)
- Homepage: `arc402.xyz`
- License: MIT
- Topics: agent-commerce, web3, base, autonomous-agents, erc-4337, openclaw
