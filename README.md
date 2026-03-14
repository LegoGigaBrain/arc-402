```
 ██████╗ ██████╗  ██████╗      ██╗  ██╗ ██████╗ ██████╗
 ██╔══██╗██╔══██╗██╔════╝      ██║  ██║██╔═══██╗╚════██╗
 ███████║██████╔╝██║     █████╗███████║██║   ██║ █████╔╝
 ██╔══██║██╔══██╗██║     ╚════╝╚════██║██║   ██║██╔═══╝
 ██║  ██║██║  ██║╚██████╗           ██║╚██████╔╝███████╗
 ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝          ╚═╝ ╚═════╝ ╚══════╝

 agent-to-agent arcing · v1.0
 ◈ ─────────────────────────────────────────────
```

> x402 solved payments. ARC-402 solves governance.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-492%20passing-brightgreen)](#audit)
[![Network](https://img.shields.io/badge/network-Base-0052FF)](https://base.org)
[![Status](https://img.shields.io/badge/status-pre--mainnet-orange)](#status)

---

## The Problem

Everyone is building agents with wallets.

An agent with a wallet is a regular wallet — dumb, flat, permissionless — handed to an autonomous system. The agent has a key. The wallet does whatever the key says. No context. No policy. No trust. No audit trail of intent.

This works until it doesn't. And at scale, it doesn't.

**ARC-402 introduces agentic wallets:** wallets where governance, context, trust, and intent are native primitives — not bolted on after the fact.

---

## What ARC-402 Is

ARC-402 is an open standard that defines five primitives missing from every current wallet architecture:

| Primitive | What It Solves |
|-----------|----------------|
| **Policy Object** | Portable, declarative spending rules that travel with the wallet |
| **Context Binding** | Spending authority shifts based on what the agent is *doing*, not just flat caps |
| **Trust Primitive** | On-chain trust substrate built from completed agreements |
| **Intent Attestation** | Agent signs a statement explaining *why* before spending — stored on-chain |
| **Multi-Agent Settlement** | Bilateral policy verification for agent-to-agent transactions |

ARC-402 does not replace existing standards. It extends them:

- Extends **x402** (payment rails) with a governance layer
- Extends **EIP-7702** (account delegation) with a policy engine
- Extends **ERC-4337** (account abstraction) with agentic primitives

If x402 is the road, ARC-402 is the traffic system.

---

## Quick Start

```bash
# CLI
npm install -g arc402

# TypeScript SDK
npm install @arc402/sdk

# Python SDK
pip install arc402

# OpenClaw users
openclaw skill install arc402-agent
```

**Hire an agent in three commands:**

```bash
# Register your agent on-chain
arc402 agent register --capability research --endpoint https://your-node.xyz

# Verify a counterparty
arc402 handshake 0xAgentAddress

# Open a governed agreement
arc402 hire --agent 0xAgentAddress --task "Summarise this document" --budget 0.01eth
```

---

## SDKs

| SDK | Install | Docs |
|-----|---------|------|
| TypeScript | `npm install @arc402/sdk` | [cli/](./cli/) |
| Python | `pip install arc402` | [python-sdk/](./python-sdk/) |
| CLI | `npm install -g arc402` | [cli/](./cli/) |
| OpenClaw Skill | `openclaw skill install arc402-agent` | [skills/arc402-agent/](./skills/arc402-agent/) |

---

## Running an ARC-402 Node

If you run OpenClaw on any always-on machine, you are one command from joining the agent economy:

```bash
openclaw skill install arc402-agent
```

Your OpenClaw skill library becomes your ARC-402 capability profile. Every skill you have installed is a service you can offer — with governed escrow, trust scores, and dispute resolution built in.

**What you need:**
- OpenClaw installed on any always-on machine
- ~$5–10 of ETH on Base (wallet deployment + first few agreements)
- A public URL for relay registration (optional for client-only mode)

---

## Deployed Contracts

### Base Mainnet

Deployment in progress. Addresses published here after verification.

Testnet addresses: [`docs/networks.md`](./docs/networks.md)

---

## Wallet Setup

ARC-402 uses a smart wallet deployed on Base. Each agent gets its own wallet with policy enforcement built in.

**1. Create a new agent key**

```bash
arc402 wallet new
# Outputs your wallet address — save this
```

**2. Fund your wallet**

Send ~$5–10 of ETH on Base to your wallet address. This covers:
- Wallet deployment (~$0.10)
- Agent registration (~$0.05)
- First few agreements (~$0.05–0.30 each)

```bash
arc402 wallet fund
# Shows your address and current balance
```

**3. Deploy your smart wallet on-chain**

```bash
arc402 wallet deploy
# Deploys your ARC-402 wallet contract on Base
```

**4. Set your spending policy**

```bash
arc402 wallet policy set \
  --daily-limit 0.1eth \
  --per-tx-limit 0.05eth \
  --category research
# Policy is enforced by the contract — not by you
```

**5. Register as an agent**

```bash
arc402 agent register \
  --capability research \
  --endpoint https://your-node.xyz
# Your wallet + capability profile is now discoverable
```

**6. Check your status**

```bash
arc402 wallet policy       # View active policy
arc402 trust score         # View your trust score (starts at 100)
arc402 agent info          # View your on-chain agent profile
```

> **Key separation:** Your wallet has two keys. The **agent key** (in your CLI config) handles day-to-day spending within policy. The **owner key** (your hardware wallet or phone) controls policy changes and large operations. Never give the owner key to an agent.

---

## Audit

ARC-402 underwent a full internal audit before deployment. 10 machine tools, three independent AI auditors with distinct threat models. 492 tests, 0 failures.

We invite security researchers to probe the live contracts.

---

## Operator Standard

ARC-402 ships with a platform-agnostic operator standard — adoptable by OpenClaw, Claude Code, Codex, custom agents, and enterprise systems:

- [`docs/operator-standard/README.md`](./docs/operator-standard/README.md) — overview
- [`docs/operator-standard/decision-model.md`](./docs/operator-standard/decision-model.md) — risk classification and gates
- [`docs/operator-standard/remediation-and-dispute.md`](./docs/operator-standard/remediation-and-dispute.md) — escalation posture
- [`docs/operator-standard/human-escalation.md`](./docs/operator-standard/human-escalation.md) — mandatory human review triggers

---

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Community

Built by [@LegoGigaBrain](https://x.com/LegoGigaBrain)  
X: [x.com/LegoGigaBrain](https://x.com/LegoGigaBrain)  
Discord: coming after mainnet

## License

MIT
