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

### Base Sepolia (Testnet)

| Contract | Address |
|----------|---------|
| PolicyEngine | [`0x44102e70c2A366632d98Fe40d892a2501fC7fFF2`](https://sepolia.basescan.org/address/0x44102e70c2A366632d98Fe40d892a2501fC7fFF2) |
| TrustRegistry | [`0x1D38Cf67686820D970C146ED1CC98fc83613f02B`](https://sepolia.basescan.org/address/0x1D38Cf67686820D970C146ED1CC98fc83613f02B) |
| TrustRegistryV2 | [`0xfCc2CDC42654e05Dad5F6734cE5caFf3dAE0E94F`](https://sepolia.basescan.org/address/0xfCc2CDC42654e05Dad5F6734cE5caFf3dAE0E94F) |
| IntentAttestation | [`0x942c807Cc6E0240A061e074b61345618aBadc457`](https://sepolia.basescan.org/address/0x942c807Cc6E0240A061e074b61345618aBadc457) |
| SettlementCoordinator | [`0x52b565797975781f069368Df40d6633b2aD03390`](https://sepolia.basescan.org/address/0x52b565797975781f069368Df40d6633b2aD03390) |
| ServiceAgreement | [`0xa214D30906A934358f451514dA1ba732AD79f158`](https://sepolia.basescan.org/address/0xa214D30906A934358f451514dA1ba732AD79f158) |
| SessionChannels | [`0x21340f81F5ddc9C213ff2AC45F0f34FB2449386d`](https://sepolia.basescan.org/address/0x21340f81F5ddc9C213ff2AC45F0f34FB2449386d) |
| WalletFactory | [`0xD560C22aD5372Aa830ee5ffBFa4a5D9f528e7B87`](https://sepolia.basescan.org/address/0xD560C22aD5372Aa830ee5ffBFa4a5D9f528e7B87) |
| AgentRegistry | [`0x07D526f8A8e148570509aFa249EFF295045A0cc9`](https://sepolia.basescan.org/address/0x07D526f8A8e148570509aFa249EFF295045A0cc9) |
| ARC402Registry | [`0x638C7d106a2B7beC9ef4e0eA7d64ed8ab656A7e6`](https://sepolia.basescan.org/address/0x638C7d106a2B7beC9ef4e0eA7d64ed8ab656A7e6) |
| DisputeModule | [`0xcAcf606374E29bbC573620afFd7f9f739D25317F`](https://sepolia.basescan.org/address/0xcAcf606374E29bbC573620afFd7f9f739D25317F) |
| ReputationOracle | [`0x410e650113fd163389C956BC7fC51c5642617187`](https://sepolia.basescan.org/address/0x410e650113fd163389C956BC7fC51c5642617187) |
| SponsorshipAttestation | [`0xc0d927745AcF8DEeE551BE11A12c97c492DDC989`](https://sepolia.basescan.org/address/0xc0d927745AcF8DEeE551BE11A12c97c492DDC989) |

### Base Mainnet

Deployment in progress. Addresses published here after verification.

---

## Repository Structure

```
arc-402/
├── specs/                   # Protocol specs (1–27)
├── reference/               # Reference implementation
│   ├── contracts/           # Solidity — 42 contracts
│   ├── test/                # Hardhat test suite (40 tests)
│   └── scripts/             # Deployment scripts
├── cli/                     # arc402 CLI
├── python-sdk/              # Python SDK
├── web/                     # arc402.xyz signing page
├── skills/arc402-agent/     # OpenClaw agent skill
├── docs/                    # Protocol docs
│   ├── THREAT-MODEL.md
│   ├── state-machine.md
│   ├── agent-lifecycle.md
│   ├── operator/            # Operator doctrine
│   └── operator-standard/   # Public operator standard
└── E2E-TEST-SPEC.md         # Full E2E test results
```

---

## Status

**RC-1 · March 2026** — Internal audit complete. Testnet live. Mainnet deployment in progress.

**492 tests · 0 failures** (452 Foundry + 40 Hardhat)

**Protocol layers implemented:**
- Policy Object — context binding + intent attestation
- Trust Primitive — on-chain trust substrate + arbitration
- Multi-Agent Settlement — bilateral verification + session channels
- Dispute Resolution — arbitration + trust consequences
- Liveness Protection — watchtower + session challenge

**Not in v1 scope:** ZK/privacy extensions, third-party attestation hooks, broad party slashing.

---

## Audit

ARC-402 underwent a full internal audit before deployment:

- 10 machine tools (Slither, Wake, Mythril, Diffusc + 6 others)
- Three independent AI auditors with distinct threat models (Attacker, Architect, Independent)
- Full reconciliation — 7 blockers and 6 required findings identified and fixed
- 492 tests, 0 failures across Foundry and Hardhat

Audit artifacts: [`reference/audit-reports-final/`](./reference/audit-reports-final/)

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
