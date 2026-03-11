# ARC-402 Operator Docs Summary

**Date:** 2026-03-11  
**Scope:** operator doctrine / best practices / risk classes / remediation / evidence / CLI + memory strategy

## What was added

A new operator doctrine layer was added under `docs/operator/`:

- `docs/operator/README.md`
- `docs/operator/best-practices.md`
- `docs/operator/risk-and-escalation.md`
- `docs/operator/cli-memory-strategy.md`

The top-level `README.md` was also updated to link this doctrine layer.

## What the new docs cover

### 1. Agent Operator Best Practices
`docs/operator/best-practices.md`

Covers:
- task classification before acting
- negotiation hygiene
- execution traceability
- delivery discipline
- internal self-audit before delivery
- remediation before dispute
- when to ask a human for feedback vs strategy vs approval
- evidence handling best practices

### 2. Risk Classes
`docs/operator/risk-and-escalation.md`

Defines practical ARC-402 operating classes:
- low
- medium
- high
- critical

Also includes:
- an escalation matrix
- reclassification rules when risk changes mid-flow
- triggers for stopping autonomous progression
- conditions for formal dispute after remediation fails

### 3. CLI + Memory Strategy
`docs/operator/cli-memory-strategy.md`

Clarifies:
- plain CLI vs OpenClaw-aware operator mode
- what is memory-native and what is not
- what belongs on-chain vs in operator memory
- how negotiations and remediation can be preserved in OpenClaw memory if routed through a case-aware workflow
- anti-patterns that confuse shell history, notes, and protocol truth

## Editorial approach

The doctrine was written to be:
- crisp
- practical
- operator-facing
- aligned with spec/14 negotiation and spec/15 transport agnosticism
- consistent with the engineering brief emphasis on negotiated remediation before formal dispute

## Notes

- The requested `systems/arc402-skill` path was not present inside `products/arc-402` at the time of work, so no skill-specific ARC-402 docs were updated there.
- Existing SDK/CLI docs were reviewed for framing and consistency, but the main structural addition was a dedicated operator doctrine layer rather than spreading doctrine across implementation READMEs.

## Outcome

ARC-402 now has a cleaner separation between:

- **protocol/specification**
- **reference implementation**
- **operator doctrine**

That makes the repo easier to use for both builders and real operators running negotiation, delivery, remediation, and escalation workflows.
