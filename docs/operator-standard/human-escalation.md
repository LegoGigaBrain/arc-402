# Human Escalation

## 1. Principle

Human escalation exists because some decisions are judgment-heavy, authority-bound, safety-sensitive, or institutionally consequential.

The ARC-402 Agent Operator Standard does not treat human escalation as failure. It treats it as required control.

## 2. Mandatory Escalation Triggers

An operator must pause autonomous progression and request human review or approval when any of the following are true:

- value is high relative to delegated budget, treasury tolerance, or local policy
- legal, regulatory, compliance, or jurisdiction interpretation is required
- identity, sanctions, impersonation, fraud, or collusion is suspected
- the task touches real-world safety, critical infrastructure, or public harm
- the counterparty asks for off-protocol side deals, hidden terms, or policy exceptions
- dispute posture could materially affect reputation, sponsorship, governance optics, or enterprise relationships
- evidence appears tampered, selectively withheld, contradictory, or otherwise unreliable
- the requested action conflicts with policy, authority, or contract terms
- arbitration would require strategic judgment rather than straightforward rule application
- the operator cannot tell whether it still has authority to proceed

Once such a trigger fires, the operator must not continue autonomous escalation unless an explicit emergency policy says otherwise.

## 3. Review-Recommended Triggers

Human review should be requested when:

- work quality is subjective and acceptance criteria remain fuzzy
- multiple providers or settlement paths are strategically different, not merely numerically different
- remediation reaches cycle 2 without convergence
- settlement choice has reputational effects beyond the ticket value
- a partial settlement is plausible but materially changes economics or precedent

## 4. Types of Human Involvement

### Feedback

Use when preference calibration is needed.

### Strategy

Use when the operator needs direction between valid but meaningfully different paths.

### Approval

Use when permission is needed to proceed, commit funds, disclose sensitive material, or escalate in a consequential situation.

## 5. Escalation Packet

When escalating, the operator should send a compact packet containing:

- one-sentence problem statement
- counterparties
- current state
- agreed or proposed terms
- risk level
- key risks
- recommended action
- evidence packet location or hash
- exact decision required from the human

The human should not have to reconstruct the case from scratch.

## 6. Escalation Quality Standard

A good escalation is:

- timely
- specific
- bounded to an actual decision
- supported by evidence
- clear about whether the human is being asked for feedback, strategy, or approval

A poor escalation is late, vague, or framed as a data dump with no decision request.

## 7. Enterprise Interpretation

Enterprise implementations may map human escalation to:

- a named approver
- legal or compliance review
- a risk committee
- a treasury signer threshold
- a customer success or account lead
- a governance board or incident lead

The mapping can vary. The trigger logic should not.
