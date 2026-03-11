# Integration Patterns

## 1. Purpose

The ARC-402 Agent Operator Standard is designed to be implemented through adapters.

The doctrine stays stable. The environment-specific wiring changes.

This document explains how to map the standard into real systems without binding it to a single product.

## 2. Implementation Stack

A practical ARC-402 operator implementation usually has four layers:

1. **Protocol layer**
   - agreements
   - escrow
   - delivery commitments
   - verification and dispute state
   - evidence anchors

2. **Execution layer**
   - SDKs
   - CLI tools
   - agent runtimes
   - workflow services

3. **Operator layer**
   - risk classification
   - self-audit
   - remediation flow
   - evidence indexing
   - human escalation logic

4. **Memory or case layer**
   - negotiation summary
   - remediation history
   - human decisions
   - compact continuity record

## 3. Mapping Table

| Layer | Typical implementation choices |
|---|---|
| Protocol | smart contracts, chain indexers, settlement service |
| SDKs | TypeScript SDK, Python SDK, internal client library |
| CLI | shell tool, wallet CLI, operator command wrapper |
| Operator adapter | prompt, skill, middleware, policy service, workflow engine |
| Memory/case adapter | local files, database, ticketing system, chat memory, enterprise case system |

## 4. OpenClaw Mapping

OpenClaw can implement the standard through:

- an operator skill or workflow
- memory-aware chat/session state
- structured evidence references
- human escalation through the operator interface
- protocol actions executed through CLI or SDK wrappers

Why it fits well:

- it can be memory-native across turns
- it can distinguish routine execution from escalation
- it can preserve concise summaries that survive context limits

Caution:

- OpenClaw memory is not protocol settlement
- memory notes must not be treated as accepted agreements or final economic state

## 5. Claude Code Mapping

Claude Code can implement the standard through:

- a system or task prompt that encodes the doctrine
- scripts or wrappers that save negotiation state and evidence indexes
- local case files for summaries, risk, and next actions
- explicit escalation instructions for high-risk or approval-bound actions

Strengths:

- strong reasoning and structured drafting
- good fit for evidence packet preparation and self-audit

Caution:

- plain CLI sessions are not memory-native by default
- unless wrapped, negotiation context and remediation history can be lost between runs

## 6. Codex Mapping

Codex-based workflows can implement the standard through:

- a governing agent prompt or runbook
- helper scripts that create case JSON files
- SDK or CLI calls for protocol actions
- explicit pre-delivery self-audit and escalation gates

Strengths:

- efficient execution and tool use
- good fit for structured operator loops and automation wrappers

Caution:

- tool activity alone is not case memory
- logs should be summarized into durable operator state

## 7. Custom Python or TypeScript Agent Mapping

A custom agent can implement the standard as middleware or workflow stages.

Recommended components:

- `risk_classifier`
- `policy_gate`
- `negotiation_manager`
- `evidence_index`
- `self_audit`
- `remediation_manager`
- `escalation_router`
- `case_store`

This is often the cleanest way to make the standard first-class in production systems.

## 8. Enterprise Agent System Mapping

Enterprise systems can map the standard into:

- workflow orchestration engines
- ticketing or case-management systems
- policy engines
- compliance review queues
- signer or approval systems
- audit logging infrastructure

Recommended split:

- protocol operations handled by a service client
- operator doctrine enforced by workflow rules
- memory continuity handled by a case system
- approvals handled by enterprise routing

## 9. Minimal Implementation Pattern

A minimal but credible implementation should include:

- protocol client or SDK
- structured negotiation and remediation schema
- risk classifier with authority thresholds
- self-audit checklist before delivery
- evidence packet builder
- human escalation hook
- compact case summary written after each meaningful transition

## 10. Memory Strategy by Environment

### Plain CLI

Not memory-native by default.

Required additions:

- explicit case file or summary file
- saved negotiation transcript or hash
- saved evidence index
- saved risk and next-action record

### Wrapped CLI

Can become memory-aware if the wrapper creates and updates case state automatically.

### Chat-native operator environment

Can be memory-native if it preserves structured state across turns and links summaries back to raw evidence.

### Enterprise workflow system

Usually memory-native through tickets, databases, and audit logs, if the operator doctrine is actually encoded in the workflow.

## 11. Reference Adapter Model

The same standard can be expressed in multiple adapter forms:

- **protocol**: ARC-402 on-chain and off-chain specs
- **SDK**: client libraries that expose structured negotiation, evidence, and case helpers
- **CLI**: commands plus case-state scaffolding
- **operator skill or prompt**: doctrine encoded in instructions
- **workflow adapter**: state machine and escalation logic in software

That is the implementation mapping the standard expects.

## 12. Conformance Question

The key question is not whether the system uses a specific brand or runtime.

The key question is:

**Does this implementation preserve the doctrine, produce reviewable evidence, and stop when human judgment is required?**
