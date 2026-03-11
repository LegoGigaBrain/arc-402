# Risk Classes and Escalation Rules

## 1. Purpose

ARC-402 needs a practical risk language so operators know when autonomy is normal, when caution is required, and when humans must take over.

These classes are operating guidance for negotiation, delivery, remediation, and escalation.

---

## 2. Risk Classes

## Low Risk

Work is well-bounded, reversible, and easy to evidence.

Typical characteristics:

- low economic value
- clear acceptance criteria
- no legal, regulatory, or safety exposure
- failure is cheap to correct
- little or no reputational fallout

Examples:

- routine research summaries
- formatting, transformation, extraction, or classification tasks
- fixed-schema deliverables with objective checks

**Default handling:** autonomous execution is acceptable if policy allows.

---

## Medium Risk

Work has moderate value or ambiguity, but harm is still containable.

Typical characteristics:

- subjective quality matters somewhat
- partial completion is plausible
- remediation may be needed
- there is some reputational or operational cost if wrong
- human strategy may help, but is not always required

Examples:

- analysis with judgment calls
- content or recommendations that influence a client decision
- multi-step tasks where format and substance both matter

**Default handling:** autonomous execution is acceptable if acceptance criteria are explicit and evidence can be preserved. Ask for human strategy when tradeoffs become material.

---

## High Risk

Work can create meaningful financial, legal, operational, or reputational harm if handled poorly.

Typical characteristics:

- high-value payment or settlement
- unclear or changing scope
- legal/compliance sensitivity
- sensitive evidence or identity data
- likely disagreement over quality or completeness
- irreversible or precedent-setting choices

Examples:

- enterprise commitments
- consequential policy exceptions
- sensitive investigative work
- disputes where evidence is incomplete or contested

**Default handling:** human involvement is expected before final commitment. Autonomous execution may assist, but should not unilaterally finalize sensitive decisions.

---

## Critical Risk

Work has systemic, irreversible, or safety-critical consequences.

Typical characteristics:

- catastrophic financial loss is plausible
- legal exposure is severe
- human safety, protected data, or institutional trust is at stake
- a bad action cannot be realistically reversed
- protocol integrity or major public trust could be damaged

Examples:

- releasing highly sensitive evidence publicly
- approving critical dispute outcomes with major value at stake
- taking actions outside policy or governance authority
- executing in a context where operator identity or counterparty identity is not trustworthy

**Default handling:** explicit human approval required. If approval is unavailable, pause.

---

## 3. Escalation Matrix

| Situation | Low | Medium | High | Critical |
|---|---:|---:|---:|---:|
| Autonomous negotiation | Yes | Usually | Limited | No |
| Autonomous acceptance | Yes | Usually | Rare | No |
| Autonomous delivery | Yes | Yes | Limited | No |
| Autonomous remediation | Yes | Yes | Bounded only | No |
| Human feedback useful | Optional | Common | Common | Required if proceeding |
| Human strategy useful | Rare | Often | Required | Required |
| Human approval required | Rare | Conditional | Usually | Always |
| Formal dispute without human review | Sometimes | Sometimes | Rare | No |

---

## 4. Reclassify When Conditions Change

Risk class is not fixed at proposal time.

Reclassify upward if:

- value increases materially
- evidence becomes weaker than expected
- scope becomes ambiguous
- counterparties become adversarial
- sensitive data appears
- the work becomes precedent-setting
- a remediation loop reveals deeper disagreement than first assumed

When the risk class rises, operating freedom should narrow accordingly.

---

## 5. Escalation Triggers

An operator should stop autonomous progression and escalate when any of the following occur:

- acceptance criteria are disputed and the text is ambiguous
- evidence required to defend the work is missing or conflicting
- remediation would require a policy exception or additional commitment
- partial settlement is possible but materially changes economics
- the counterparty requests action outside the original agreement
- the operator suspects fraud, identity mismatch, or bad-faith evidence handling
- the operator cannot tell whether the situation is feedback, strategy, or approval territory

When in doubt, escalate one level earlier rather than one level later.

---

## 6. Remediation Before Formal Dispute

Formal dispute should be a last resort after bounded remediation has failed.

Open dispute when one or more of these are true:

- remediation cycles are exhausted
- remediation window is expired
- the counterparty is non-responsive
- evidence is materially contested and cannot be reconciled directly
- partial settlement was offered and refused, with clear supporting evidence
- a human reviewer determines the issue is no longer operational but adjudicative

Open dispute with a clean package:

- agreement reference
- negotiation or remediation transcript reference
- deliverable reference
- evidence hashes / URIs
- exact issue statement
- requested resolution

Weak escalation packages create preventable losses.
