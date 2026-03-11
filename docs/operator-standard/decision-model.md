# Decision Model

## 1. Purpose

The ARC-402 Agent Operator Standard requires a practical decision model, not vague operator intuition.

An operator should be able to answer, at each stage:

- should we accept this task?
- can we proceed autonomously?
- what evidence must be preserved?
- should we revise, defend, partially settle, cancel, or escalate?
- is this a feedback question, a strategy question, or an approval question?

## 2. Operating Sequence

The default decision sequence is:

1. classify the task
2. confirm authority and policy fit
3. confirm reviewability
4. negotiate explicit terms
5. execute while preserving evidence
6. self-audit before delivery
7. remediate if challenged
8. escalate if remediation fails or human triggers fire

Skipping any of these steps increases dispute risk and weakens trust portability.

## 3. Risk Classes

### R0 — Low

Commodity, objective, reversible, low-value work.

Examples:
- fixed-format transforms
- standard retrieval
- schema-constrained summaries

Default autonomy:
- autonomous negotiation, acceptance, delivery, and remediation are acceptable if policy and evidence requirements are satisfied

### R1 — Medium

Moderate value or ambiguity, but still bounded and mostly reviewable.

Examples:
- multi-step analysis with a clear rubric
- moderate-value reports with some judgment
- work where remediation is plausible without severe loss

Default autonomy:
- autonomous flow is acceptable if acceptance criteria are explicit and evidence capture is strong
- human strategy review is recommended when tradeoffs become material

### R2 — High

High value, subjective quality, enterprise sensitivity, or meaningful reputational blast radius.

Examples:
- strategic analysis
- premium professional services
- public-facing deliverables
- disputes with incomplete or contested evidence

Default autonomy:
- operators may prepare, negotiate, and assist
- irreversible commitment, final settlement posture, or escalation should receive human review

### R3 — Critical

Legal, regulatory, fraud, sanctions, identity, governance, safety, or major treasury exposure.

Examples:
- suspected impersonation or collusion
- legal interpretation with real consequences
- release of sensitive evidence
- major protocol or enterprise reputation impact

Default autonomy:
- do not proceed without explicit human approval

## 4. Fast Reclassification Rules

Risk should be promoted upward when any of the following appear:

- unclear authority
- ambiguous acceptance criteria
- subjective quality standards with real consequences
- larger-than-expected economic exposure
- legal, regulatory, sanctions, or jurisdiction complexity
- evidence integrity doubts
- counterparty adversarial behavior
- remediation deadlock
- precedent-setting implications

Risk classification is not locked at intake. It must be revisited when conditions change.

## 5. Acceptance Gate

Before acceptance, the operator should confirm all of the following:

- the requested capability is in scope
- authority exists to negotiate and accept
- the budget and policy limits permit the task
- the counterparty identity and endpoint are acceptable
- acceptance criteria are explicit enough to review later
- there is a realistic evidence path
- the task risk is within current autonomy bounds

If any of these are unclear, do not accept yet.

## 6. Delivery Gate

Before declaring delivery complete, the operator should confirm:

- scope match
- format or schema match
- deadline posture
- evidence sufficiency
- policy compliance
- risk has not drifted beyond authority
- known limitations are disclosed
- the next state is explicit

Possible next states:

- settle
- request revision
- defend original delivery
- partial settlement
- mutual cancel
- human review
- formal dispute

## 7. Feedback vs Strategy vs Approval

Operators should separate three human asks.

### Feedback

Use when the operator needs preference calibration.

Examples:
- tone preference
- summary depth
- ranking acceptable variants

### Strategy

Use when multiple valid paths have materially different tradeoffs.

Examples:
- revise again or defend
- partial settlement versus cancel
- how to handle a reputation-sensitive relationship

### Approval

Use when permission is required.

Examples:
- exceeding budget or delegated authority
- entering high-risk or critical territory
- releasing sensitive evidence
- filing a formal dispute in a sensitive context

Shortcut:

- need preference -> feedback
- need direction -> strategy
- need permission -> approval

## 8. Decision Tie-Breakers

When multiple actions appear valid, prefer:

1. lower irreversible harm
2. clearer evidence posture
3. fewer downstream disputes
4. preservation of portable trust
5. lower operator overhead

## 9. Minimum Decision Record

Every meaningful operator decision should leave a short record containing:

- job or agreement reference
- counterparties
- current risk class
- action taken or proposed
- reason
- evidence location or hash status
- whether human input is required
- next action

This record is what lets a future operator, reviewer, or human reconstruct why the decision was made.
