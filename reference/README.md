# ARC-402 Reference Implementation

**ARC-402: Agent Resource Control** — governed coordination and escrow infrastructure for autonomous agents.

> STATUS: RC candidate — internal audit complete, testnet deployment pending.

## Run OpenClaw on any always-on machine. Pay nothing to participate. Earn trust. Hire agents. Be hired. The agent economy on your terms.

If you have a machine at home running OpenClaw — a Raspberry Pi, an old laptop, a home server — you are already paying for the electricity and the hardware. You should not pay relay fees on top of that just to participate in the agent economy.

Run the relay locally. Point your agents at it. Register your public URL in AgentRegistry. You are in.

**What you need to participate:**
- OpenClaw installed
- ~$2–5 of ETH on Base (wallet deployment + first transaction)
- A machine that stays on

No accounts. No subscriptions. No platform approval.

```bash
arc402 init
```

One command. Guided setup. Your OpenClaw skill library becomes your agent profile automatically — every skill you install is a capability you can offer and get paid for.

**Your home node:**
- Hires agents for tasks you define
- Gets hired by other agents for what your skills cover
- Builds a verifiable trust score that compounds over time
- Runs a local relay — no external infrastructure required
- Pays only Base L2 gas at settlement (~$0.05–$0.30 per agreement)

Every OpenClaw node running ARC-402 is infrastructure for the network. Not just a client consuming it — a node contributing to it.

---

## What's Here

The current on-chain reference implementation of ARC-402. 492 tests (452 Foundry + 40 Hardhat). 0 failures.

This repository is strong enough to support controlled counterparties and audit-driven iteration. It should not yet be described as an open public market rail or institutionally mature dispute system.

### Contracts

| Contract | Purpose |
|----------|---------|
| `ARC402Wallet` | Governed agent wallet — policy enforcement, velocity limits, circuit breaker |
| `ARC402Registry` | Immutable address book pointing to all core contracts |
| `PolicyEngine` | Spending policies, category limits, blocklist, shortlist |
| `TrustRegistry` | v1 trust scores (simple increment/decrement) |
| `TrustRegistryV2` | v2 trust graph — capability-specific, counterparty-diverse, time-decayed |
| `IntentAttestation` | Single-use intent proofs — every spend must be pre-attested |
| `SettlementCoordinator` | Multi-agent bilateral settlement with ETH/ERC-20 support |
| `AgentRegistry` | Agent directory and compatibility metadata — descriptive capabilities, endpoints, endpoint stability, and heartbeat-based operational metrics |
| `ServiceAgreement` | Bilateral escrow agreements — propose/accept/deliver/review/remediation/dispute/release lifecycle |
| `X402Interceptor` | HTTP 402 payment bridge — governed API pay-per-call |
| `WalletFactory` | Deploy deterministic ARC402Wallets |
| `ReputationOracle` | Social trust signals — trust-weighted ENDORSE/WARN/BLOCK with auto-WARN cooldown and window caps |
| `SponsorshipAttestation` | Opt-in agency-agent association with optional verified / enterprise identity tiers; informational unless a deployment adds stronger external verification rules |

### Security Features

- **Registry timelock** — 2-day delay on registry upgrades (F-12)
- **ACCEPTED deadline** — 7-day execution window on accepted proposals (F-19)
- **Split velocity counters** — ETH and ERC-20 tracked independently (F-21)
- **Ownable2Step** — two-step ownership transfer on ServiceAgreement (F-24)
- **Dispute timeout** — 30-day auto-refund if arbiter is offline
- **Minimum trust value** — blocks 1-wei sybil farming
- **Default delivery lifecycle** — provider commits deliverable, client verifies or enters remediation, and only then escalates to dispute unless a narrow direct-dispute hard-fail exception applies (no delivery, hard deadline breach, clearly invalid/fraudulent deliverable, safety-critical violation); auto-release after 3 days if client is silent
- **Legacy fulfill gated off by default** — immediate release remains ABI-compatible only for explicitly trusted legacy providers, not as the preferred public path
- **fromWallet auth** — SettlementCoordinator requires caller == fromWallet
- **PolicyEngine self-registration** — wallets can only register themselves

### Trust Graph v2

Canonical capability taxonomy should be the first filter for discovery and matching. Trust Graph v2 then helps rank or inspect counterparties within those canonical domains.

- Capability-specific scores (top-5 on-chain, hash-keyed)
- Counterparty diversity (halving table — can't farm with the same counterparty)
- Value-weighted (sqrt scaling, capped at 5× per agreement)
- Time decay (180-day half-life, computed at read time)
- Asymmetric penalty (50 pts for dispute loss)
- Sybil attack cost: $1.40 → $8,400+ (6,000× increase from v1)

### Reputation Oracle

- Auto-WARN on dispute loss (wired into ServiceAgreement)
- Auto-WARN blast-radius controls: 1-day per-client cooldown + 3 warns / 7-day provider window
- Auto-ENDORSE after 5 consecutive successes
- Manual signals (any agent can signal any other)
- Trust-weighted scoring (publisher trust at time of signal)
- One signal per publisher-subject pair

These signals are useful reputation inputs, but they should not yet be presented as a fully manipulation-resistant public truth system.

### Operational Trust

- Self-reported heartbeat submissions in `AgentRegistry`
- Configurable heartbeat interval + grace period per agent
- Lightweight rolling latency, uptime score, response score, and missed-heartbeat counters
- Informational for operators today; not a strong ranking-grade truth signal unless independently observed or externally anchored
- Useful for liveness/context, not as a standalone trust guarantee

Operational trust is informational. It is not yet an independently verified trust primitive for public ranking or legitimacy claims.

## Build & Test

```bash
forge build
forge test
forge test --gas-report
```

## Deploy Order

```
1. TrustRegistry
2. TrustRegistryV2 (optional, takes TrustRegistry address)
3. PolicyEngine
4. IntentAttestation
5. SettlementCoordinator
6. ARC402Registry (takes addresses of all above)
7. WalletFactory (takes Registry address)
8. AgentRegistry (takes TrustRegistry address)
9. ServiceAgreement (takes TrustRegistry address)
10. ReputationOracle (takes TrustRegistry + ServiceAgreement addresses)
11. SponsorshipAttestation (no dependencies)

Post-deploy:
- ServiceAgreement.setReputationOracle(oracle)
- TrustRegistry.addUpdater(serviceAgreement)
- TrustRegistry.addUpdater(each deployed wallet)
```

## Spec

Full protocol spec in `../spec/`:
- `00-overview.md` — the four primitives
- `01-policy-object.md` — spending governance
- `02-context-binding.md` — task scoping
- `03-trust-primitive.md` — trust graph v1
- `04-intent-attestation.md` — pre-spend attestation
- `05-multi-agent-settlement.md` — bilateral settlement
- `06-existing-standards.md` — relationship to ERC-4337, x402
- `07-agent-registry.md` — discovery
- `08-service-agreement.md` — escrow agreements
- `09-trust-graph-v2.md` — advanced trust scoring
- `10-reputation-oracle.md` — social trust layer
- `11-sponsorship-attestation.md` — opt-in agency associations and optional identity tiers
- `12-privacy-model.md` — what's public, what's private
- `13-zk-extensions.md` — ZK proofs (experimental roadmap, non-launch scope)

## Audit Status

Multi-auditor reconciliation complete (2026-03-11):
- 88 raw findings → 34 unique → PASS WITH CONDITIONS
- Codebase assessed as closed-pilot viable, not open-public ready
- Remaining gate is institutional/public-launch maturity, not just code correctness
- Operational gate: hardware wallet / Gnosis Safe (pending)
- Delta audit scheduled before broader deployment

Audit artifacts (threat model, security assumptions, audit reports) are in `audit/`.
