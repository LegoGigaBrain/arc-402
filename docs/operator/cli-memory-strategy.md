# CLI and Memory Strategy

## 1. Purpose

ARC-402 can be used from a plain CLI or from an OpenClaw-aware operator environment. They are not the same thing.

This document explains:

- what each mode is good for
- what is memory-native and what is not
- how negotiation, remediation, and evidence can be preserved in OpenClaw memory without confusing memory with protocol settlement

---

## 2. Plain CLI vs OpenClaw-Aware Operator Mode

## Plain CLI

A plain ARC-402 CLI is best for:

- direct command execution
- local scripting and automation
- wallet operations
- discovery, agreement, delivery, and trust inspection
- environments where no long-lived operator memory layer exists

Characteristics:

- command-oriented
- stateless unless the CLI explicitly writes files or config
- good for deterministic operational actions
- weak at preserving negotiation context unless you build that in yourself

A plain CLI can execute protocol actions. It does not automatically create operator memory, decision history, or reusable remediation context.

## OpenClaw-aware operator mode

An OpenClaw-aware mode is best for:

- negotiation with memory of prior interactions
- operator doctrine enforcement
- evidence routing and summarization
- remediation workflows across multiple turns or channels
- deciding when a human should be looped in

Characteristics:

- conversation-aware
- can preserve structured traces outside the chain
- can attach operational memory to counterparties, agreements, or disputes
- useful for building a real operator layer on top of ARC-402

OpenClaw-aware mode does **not** replace on-chain settlement. It adds memory, routing, and operational discipline around it.

---

## 3. What Is Memory-Native and What Is Not

## Memory-native in OpenClaw

These can be made memory-native if the operator routes them through OpenClaw-aware flows:

- negotiation summaries
- remediation transcripts
- human feedback and strategy decisions
- evidence indexes and references
- counterparty behavior notes
- operator self-audit outcomes
- dispute preparation notes

These are memory-native because their value comes from continuity across turns, not from one command alone.

## Not memory-native by default

These are **not** memory-native just because they happened:

- CLI commands run in a shell
- local files created without registration or linking
- on-chain events unless indexed into memory
- ad hoc DMs or emails that never enter the operator system
- browser actions or API calls that are not captured into a case record

A command happening is not the same as a memory being formed.

---

## 4. What Belongs On-Chain vs In Operator Memory

## On-chain

Use the protocol for:

- agreement creation and acceptance
- escrow status
- delivery commitments and verification points
- trust-affecting outcomes
- formal dispute state
- evidence anchors such as hashes and canonical URIs

On-chain state should answer: **what was committed, when, by whom, and with what economic consequence?**

## In operator memory

Use OpenClaw memory for:

- negotiation rationale
- remediation explanations
- why a revision was accepted or rejected
- human guidance received during the process
- internal self-audit results
- link maps between evidence, files, messages, and agreement IDs

Operator memory should answer: **how did we get here, what was considered, and what should be remembered next time?**

---

## 5. Recommended Routing Pattern

For memory-aware ARC-402 operation:

1. **Negotiate through an OpenClaw-aware interface** when context matters
2. **Write a structured case record** keyed to the agreement or negotiation reference
3. **Store evidence references, not just prose**
4. **Anchor canonical artifacts on-chain or by content hash**
5. **Store remediation transcripts in memory with links to the original case**
6. **Before dispute, compile from memory into a dispute-ready evidence package**

This gives a clean split:

- protocol state for enforceable commitments
- memory state for operational continuity

---

## 6. How Negotiation and Remediation Can Be Stored Properly

Negotiation or remediation can be preserved in OpenClaw memory if the workflow routes them through the operator system instead of side channels.

A good memory-aware pattern is:

- create a case or record for the opportunity
- append negotiation summaries with timestamps and counterparty identifiers
- attach hashes or URIs for documents, deliverables, and supporting evidence
- append remediation turns as separate structured entries
- label whether a human provided feedback, strategy, or approval
- record final outcome: delivered, revised, partially settled, canceled, or disputed

### Minimal case schema

A practical record should include:

- agreement ID or provisional negotiation ID
- client and provider identifiers
- service type / capability
- economic terms
- acceptance criteria summary
- evidence index
- remediation history
- escalation decisions
- final outcome

### Important constraint

OpenClaw memory is useful because it preserves context. It is **not** the settlement layer.

Do not treat a memory note as equivalent to:

- an accepted agreement
- a paid escrow
- a deliverable commitment
- a trust update
- a formal dispute filing

If an outcome matters economically or institutionally, it must still be represented in the protocol or in anchored evidence.

---

## 7. Anti-Patterns

Avoid these mistakes:

- using plain CLI for rich negotiation but keeping no transcript
- assuming shell history is an evidence trail
- storing only summaries when the raw artifact matters
- storing only raw artifacts when no one can understand their relevance later
- letting remediation happen in scattered channels with no case link
- confusing OpenClaw memory with objective protocol truth

---

## 8. Practical Recommendation

Use:

- **plain CLI** for direct wallet and agreement operations
- **OpenClaw-aware mode** for negotiation, remediation, evidence indexing, human escalation, and institutional memory

The strongest ARC-402 operator stack is:

**transport-agnostic negotiation + policy-bounded execution + evidence anchoring + memory-aware operator routing.**
