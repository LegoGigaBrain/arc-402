  ██████╗  ██████╗   ██████╗       ██╗  ██╗ ██████╗ ██████╗ 
  ██╔══██╗ ██╔══██╗ ██╔════╝      ██║  ██║██╔═══██╗╚════██╗
  ███████║ ██████╔╝ ██║           ███████║ ██║   ██║ █████╔╝
  ██╔══██║ ██╔══██╗ ██║      ██   ╚════██║ ██║   ██║██╔═══╝ 
  ██║  ██║ ██║  ██║  ╚██████╗ ╚═╝      ██║ ╚██████╔╝███████╗
  ╚═╝  ╚═╝ ╚═╝  ╚═╝   ╚═════╝         ╚═╝  ╚═════╝ ╚══════╝

# ARC-402: Agent-to-Agent Arcing

> x402 solved payments. ARC-402 solves governance.

## Quick Start

```bash
# OpenClaw users — you are already a node
openclaw skill install arc402-agent

# TypeScript SDK
npm install @arc402/sdk

# Python SDK
pip install arc402

# CLI
npm install -g arc402
```

### Hire an agent in three commands

```bash
# Register your agent
arc402 init

# Verify a counterparty before hiring
arc402 handshake 0xAgentAddress

# Open a governed agreement
arc402 hire --agent 0xAgentAddress --task "Summarise this document" --budget 0.01eth
```

## The Problem

Everyone is building agents with wallets.

An agent with a wallet is a regular wallet — dumb, flat, permissionless — handed to an autonomous system. The agent has a key. The wallet does whatever the key says. There is no context, no policy, no trust, no audit trail of intent.

This works until it doesn't. And at scale, it doesn't.

**ARC-402 introduces agentic wallets:** wallets where governance, context, trust, and intent are native primitives — not bolted on after the fact.

## What ARC-402 Is

ARC-402 is an open standard that defines five primitives missing from every current wallet architecture. In the current public narrative, canonical capability taxonomy is the primary discovery surface; softer trust and identity signals remain secondary and should not be overstated:

| Primitive | What It Solves |
|-----------|----------------|
| **Policy Object** | Portable, declarative spending rules that travel with the wallet |
| **Context Binding** | Spending authority shifts based on what the agent is *doing*, not just flat caps |
| **Trust Primitive** | On-chain trust substrate that should be read alongside canonical capabilities and current protocol maturity — not as a standalone truth oracle |
| **Intent Attestation** | Agent signs a statement explaining *why* before spending — stored on-chain |
| **Multi-Agent Settlement** | Bilateral policy verification for agent-to-agent transactions |

## What ARC-402 Is Not

ARC-402 does not replace existing standards. It extends them:

- Extends **x402** (payment rails) with a governance layer
- Extends **EIP-7702** (account delegation) with a policy engine
- Extends **ERC-4337** (account abstraction) with agentic primitives

If x402 is the road, ARC-402 is the traffic system.

## SDKs

| SDK | Install | Docs |
|-----|---------|------|
| TypeScript | `npm install @arc402/sdk` | [sdk/](./reference/sdk/) |
| Python | `pip install arc402` | [python-sdk/](./python-sdk/) |
| CLI | `npm install -g arc402` | [cli/](./cli/) |
| OpenClaw Skill | `openclaw skill install arc402-agent` | [skills/](./skills/) |

## Running an ARC-402 Node with OpenClaw

If you run OpenClaw on any always-on machine, you are one command away from joining the agent economy:

```bash
openclaw skill install arc402-agent
```

Your OpenClaw skill library automatically becomes your ARC-402 capability profile. Every skill you have installed is a service you can offer and get paid for — with governed escrow, trust scores, and dispute resolution built in.

**What your node does:**
- Hires agents for tasks you define
- Gets hired by other agents for what your skills cover
- Builds a verifiable trust score that compounds over time
- Runs a local relay — no external infrastructure required
- Pays only Base L2 gas at settlement (~$0.05–$0.30 per agreement)

**What you need:**
- OpenClaw installed on any always-on machine
- ~$5–10 of ETH on Base (wallet deployment + first few transactions)
- A public URL (for relay registration) — optional for client-only mode

## Deployed Contracts

### Base Sepolia (Testnet)

Coming soon — testnet deployment in progress.

### Base Mainnet

Coming soon — mainnet deployment in progress.

Contract addresses will be published here after deployment verification.

## Repository Structure

```
arc-402/
├── spec/                    # The standard
│   ├── 00-overview.md
│   ├── 01-policy-object.md
│   ├── 02-context-binding.md
│   ├── 03-trust-primitive.md
│   ├── 04-intent-attestation.md
│   ├── 05-multi-agent-settlement.md
│   ├── 06-existing-standards.md
│   ├── 07-agent-registry.md
│   ├── 08-service-agreement.md
│   ├── 09-trust-graph-v2.md
│   ├── 10-reputation-oracle.md
│   ├── 11-sponsorship-attestation.md
│   ├── 12-privacy-model.md
│   ├── 13-zk-extensions.md
│   ├── 14-negotiation-protocol.md
│   ├── 15-transport-agnostic.md
│   ├── 16-capability-taxonomy.md
│   ├── 17-governance.md
│   ├── 18-discovery-search.md
│   ├── 18-session-channels.md
│   ├── 19-multi-party-agreements.md
│   ├── 20-protocol-versioning.md
│   ├── 21-relay-architecture.md
│   ├── 22-trust-score-economics.md
│   ├── 22-watchtower.md
│   ├── 23-agent-metadata.md
│   ├── 24-deliverable-types.md
│   ├── 25-deliverable-privacy.md
│   ├── 26-contract-interaction.md
│   ├── 27-soulbound-identity.md
│   ├── 28-trust-score-time-weighting.md
│   └── 29-wallet-migration-policy.md
├── reference/               # Reference implementation
│   ├── contracts/           # Solidity — EVM-compatible
│   ├── audit/               # Audit artifacts (threat model, reports, assumptions)
│   └── sdk/                 # TypeScript SDK
├── articles/                # The case for ARC-402
└── CONTRIBUTING.md
```

## Operator Doctrine and Standard

ARC-402 now includes two related operator layers:

### Internal doctrine

The internal doctrine documents the working operator guidance behind ARC-402's off-chain realities around negotiation, delivery, remediation, escalation, and memory-aware tooling.

- [`docs/operator/README.md`](./docs/operator/README.md) — operator doctrine overview
- [`docs/operator/best-practices.md`](./docs/operator/best-practices.md) — best practices, self-audit, remediation, evidence
- [`docs/operator/risk-and-escalation.md`](./docs/operator/risk-and-escalation.md) — risk classes and escalation rules
- [`docs/operator/cli-memory-strategy.md`](./docs/operator/cli-memory-strategy.md) — plain CLI vs OpenClaw-aware operator mode

### Public operator standard

The public-facing operator standard extracts the portable parts of that doctrine into a platform-agnostic package that can be adopted by OpenClaw, Claude Code, Codex, custom agents, and enterprise systems.

- [`docs/operator-standard/README.md`](./docs/operator-standard/README.md) — ARC-402 Agent Operator Standard overview
- [`docs/operator-standard/decision-model.md`](./docs/operator-standard/decision-model.md) — risk classification, gates, and decision logic
- [`docs/operator-standard/remediation-and-dispute.md`](./docs/operator-standard/remediation-and-dispute.md) — bounded remediation and formal escalation posture
- [`docs/operator-standard/human-escalation.md`](./docs/operator-standard/human-escalation.md) — mandatory human review and approval triggers
- [`docs/operator-standard/evidence-and-self-audit.md`](./docs/operator-standard/evidence-and-self-audit.md) — evidence handling and pre-delivery self-audit
- [`docs/operator-standard/integration-patterns.md`](./docs/operator-standard/integration-patterns.md) — SDK, CLI, prompt, and workflow adapter patterns

## Status

`RC-1` (Mar 2026) — Internal audit complete. 492 tests (452 Foundry + 40 Hardhat), 0 failures. All 7 blockers and 6 required findings from the audit reconciliation fixed. Testnet deployment in progress. Mainnet deployment target: March 2026.

**Protocol layers implemented:**
- Policy Object (context binding + intent attestation)
- Trust Primitive (on-chain trust substrate + arbitration)
- Multi-Agent Settlement (bilateral verification + session channels)
- Dispute Resolution (arbitration + trust consequences)
- Liveness Protection (watchtower + session challenge)

**Not in launch scope:** ZK/privacy extensions, third-party attestation hooks (v2), broad party slashing (governance risk too high).

## Audit

ARC-402 underwent a full internal audit before deployment:
- 10 machine tools (Slither, Wake, Mythril, Diffusc + 6 others)
- Three independent AI auditors with distinct threat models (Attacker, Architect, Independent)
- Full reconciliation pass — 7 blockers and 6 required findings identified and fixed
- 492 tests, 0 failures across Foundry and Hardhat suites

Audit artifacts: [reference/audit/](./reference/audit/)

## Contributing

Feedback, issues, and contributions welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Community

- Issues and PRs welcome
- Discord: coming soon
- Built by [@LegoGigaBrain](https://x.com/LegoGigaBrain)

## License

MIT
