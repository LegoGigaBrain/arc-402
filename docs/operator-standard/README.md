# ARC-402 Agent Operator Standard

The ARC-402 Agent Operator Standard defines how an agent should operate around the ARC-402 protocol lifecycle: negotiation, execution, delivery, remediation, evidence handling, and escalation.

It is intentionally **platform-agnostic**.

The standard does **not** assume OpenClaw, Claude Code, Codex, any particular SDK, or any specific transport. It defines the operator doctrine that should remain stable across all of them, then describes how different environments can implement that doctrine through adapters.

## Purpose

ARC-402 is not only a settlement protocol. In practice, agents also need an operator layer that decides:

- whether a task is safe to accept
- whether the terms are explicit enough to defend later
- what evidence must be preserved during execution
- whether delivery is actually complete
- whether a complaint should trigger revision, defense, partial settlement, cancelation, or escalation
- when human judgment is required

This standard provides that layer.

## Core Principle

**Negotiate off-protocol. Settle on-protocol. Preserve evidence throughout. Escalate only after bounded remediation fails or a mandatory human trigger fires.**

## Scope

This standard covers:

- task triage and risk classification
- structured negotiation posture
- delivery self-audit
- remediation before dispute
- evidence preservation and review readiness
- human escalation rules
- memory and continuity expectations for operator environments
- implementation mappings for SDKs, CLIs, prompts, and workflow adapters

This standard does **not** replace:

- ARC-402 protocol commitments
- escrow or settlement logic
- transport-specific message formats
- application-specific legal, safety, or enterprise policy

## The Standard at a Glance

An ARC-402-compliant operator should follow this order:

1. **Classify** the task and its risk
2. **Confirm authority** and policy bounds before accepting
3. **Negotiate explicitly** enough that acceptance criteria can be reviewed later
4. **Execute with evidence preservation**
5. **Self-audit before delivery**
6. **Attempt bounded remediation before dispute**
7. **Escalate to humans when triggers require it**
8. **Create a clean evidence package before formal escalation**
9. **Preserve a concise state summary for future continuity**

## Architecture Split

The ARC-402 Agent Operator Standard has two layers.

### 1. Core doctrine

Portable rules that should remain true across implementations:

- classify risk before acting
- stay within authority and policy limits
- make terms explicit
- preserve sufficient evidence
- distinguish feedback, strategy, and approval
- remediate before disputing
- escalate early when judgment or safety matters
- keep a compact continuity record

### 2. Environment adapters

Implementation-specific layers that apply the doctrine inside a given environment:

- SDK wrapper
- CLI workflow
- operator prompt or skill
- case-management service
- enterprise workflow engine

The adapter may change. The doctrine should not.

## Required Documents

- [Decision Model](./decision-model.md)
- [Remediation and Dispute](./remediation-and-dispute.md)
- [Human Escalation](./human-escalation.md)
- [Evidence and Self-Audit](./evidence-and-self-audit.md)
- [Integration Patterns](./integration-patterns.md)

## Compliance Baseline

An implementation should not claim alignment with this standard unless it can do all of the following:

- classify jobs by risk and narrow autonomy accordingly
- preserve terms and evidence in a reviewable form
- run a pre-delivery self-audit
- support bounded remediation before formal dispute
- stop autonomous progression when mandatory escalation triggers fire
- distinguish protocol state from operator memory/state
- produce a concise case summary that survives tool or session boundaries

## Mandatory Safety Rules

Every implementation of this standard must enforce these rules:

1. Do not fabricate evidence, transcript history, acceptance criteria, or delivery status.
2. Do not continue autonomous escalation once a mandatory human trigger has fired.
3. Do not treat a subjective disagreement as an objective pass/fail claim unless the criteria actually support that claim.
4. Do not overwrite original evidence with revised evidence.
5. Do not confuse local tool history, shell history, or chat context with canonical protocol state.
6. Do not finalize high-risk or critical decisions outside delegated authority.
7. Do not conceal known uncertainty, incompleteness, or policy drift.

## Plain CLI vs Memory-Native Operator Environments

A plain CLI is **not memory-native by default**.

A shell can execute commands and even complete protocol operations, but it does not automatically preserve:

- negotiation rationale
- remediation history
- decision summaries
- evidence indexes
- human approvals
- future-ready handoff context

A wrapped operator environment can be memory-native if it deliberately stores structured case state across turns, channels, or sessions.

That distinction matters. A command having happened is not the same as operator memory having been formed.

## Intended Adopters

This standard is designed so it can be implemented by:

- OpenClaw
- Claude Code workflows
- Codex workflows
- custom Python or TypeScript agents
- enterprise agent platforms and internal orchestration systems

## Relationship to ARC-402 Specs

This operator standard complements, but does not replace, the protocol specifications, especially:

- negotiation protocol
- transport-agnostic operation
- capability taxonomy
- governance

Those specs define the settlement and coordination substrate. This standard defines how an operator should behave around it.
