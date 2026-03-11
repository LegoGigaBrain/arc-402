# ARC-402: Agent Resource Control

> x402 solved payments. ARC-402 solves governance.

## The Problem

Everyone is building agents with wallets.

An agent with a wallet is a regular wallet — dumb, flat, permissionless — handed to an autonomous system. The agent has a key. The wallet does whatever the key says. There is no context, no policy, no trust, no audit trail of intent.

This works until it doesn't. And at scale, it doesn't.

**ARC-402 introduces agentic wallets:** wallets where governance, context, trust, and intent are native primitives — not bolted on after the fact.

## What ARC-402 Is

ARC-402 is an open standard that defines five primitives missing from every current wallet architecture:

| Primitive | What It Solves |
|-----------|----------------|
| **Policy Object** | Portable, declarative spending rules that travel with the wallet |
| **Context Binding** | Spending authority shifts based on what the agent is *doing*, not just flat caps |
| **Trust Primitive** | On-chain trust score that evolves with behaviour — autonomy compounds over time |
| **Intent Attestation** | Agent signs a statement explaining *why* before spending — stored on-chain |
| **Multi-Agent Settlement** | Bilateral policy verification for agent-to-agent transactions |

## What ARC-402 Is Not

ARC-402 does not replace existing standards. It extends them:

- Extends **x402** (payment rails) with a governance layer
- Extends **EIP-7702** (account delegation) with a policy engine
- Extends **ERC-4337** (account abstraction) with agentic primitives

If x402 is the road, ARC-402 is the traffic system.

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
│   └── 06-existing-standards.md
├── reference/               # Reference implementation
│   ├── contracts/           # Solidity — EVM-compatible
│   └── sdk/                 # TypeScript SDK
├── articles/                # The case for ARC-402
└── CONTRIBUTING.md
```

## Operator Doctrine

ARC-402 now includes an operator doctrine layer for the off-chain realities around negotiation, delivery, remediation, escalation, and memory-aware tooling.

- [`docs/operator/README.md`](./docs/operator/README.md) — operator doctrine overview
- [`docs/operator/best-practices.md`](./docs/operator/best-practices.md) — best practices, self-audit, remediation, evidence
- [`docs/operator/risk-and-escalation.md`](./docs/operator/risk-and-escalation.md) — risk classes and escalation rules
- [`docs/operator/cli-memory-strategy.md`](./docs/operator/cli-memory-strategy.md) — plain CLI vs OpenClaw-aware operator mode

## Status

`DRAFT` — The specification is in active development. This is not yet a final standard.

Feedback, issues, and contributions welcome.

## License

MIT
