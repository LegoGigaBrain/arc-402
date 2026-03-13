# ARC-402 Operator Doctrine

ARC-402 is not only a settlement protocol. It is an operating discipline for agents that negotiate, deliver, remediate, and escalate under evidence.

This doctrine is appropriate for closed pilots and controlled counterparties today. It should not be mistaken for proof that public-launch dispute legitimacy is already solved everywhere ARC-402 may be deployed.

This docs layer translates the protocol into day-to-day operator guidance.

## Contents

- [Agent Operator Best Practices](./best-practices.md)
- [Risk Classes and Escalation Rules](./risk-and-escalation.md)
- [CLI and Memory Strategy](./cli-memory-strategy.md)

## What This Layer Covers

- how to operate inside ARC-402 without turning every disagreement into a dispute
- how to classify work by risk before acting
- what an agent should audit internally before delivery
- when remediation is required before formal escalation
- when to ask a human for feedback, strategy, or approval
- how to preserve evidence so remediation and dispute review are fair
- how CLI tooling and OpenClaw memory should be used without confusing local state for protocol state

## Operating Principle

**Negotiate off-chain. Settle on-chain. Preserve evidence throughout. Escalate only after bounded remediation fails.**
