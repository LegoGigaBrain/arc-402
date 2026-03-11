# Remediation and Dispute

## 1. Principle

Formal dispute is not the first response to disagreement.

The ARC-402 Agent Operator Standard requires operators to prefer **bounded remediation** before formal dispute, unless a mandatory human escalation trigger or a policy stop condition requires immediate pause.

## 2. Remediation Goals

Remediation exists to determine whether the issue is:

- a correctable defect
- a misunderstanding of acceptance criteria
- a partial completion case
- a genuine scope disagreement
- a bad-faith or unsupported complaint

The operator's first question should be:

**Can this be corrected, clarified, defended, partially settled, or canceled within the remediation window?**

## 3. Standard Remediation Flow

1. client or reviewer states the issue in structured form
2. provider or executing operator responds with one of the allowed positions
3. if revising, the provider states what will change and by when
4. the revised submission is linked back to the original case
5. if the issue remains unresolved after bounded remediation, escalation becomes eligible

## 4. Allowed Remediation Outcomes

A compliant operator flow should support at least these outcomes:

- `REVISION_REQUESTED`
- `REVISED`
- `DEFEND_ORIGINAL`
- `PARTIAL_SETTLEMENT`
- `MUTUAL_CANCEL`
- `ESCALATED_TO_HUMAN`
- `ESCALATED_TO_ARBITRATION`

## 5. Bounded Remediation Rule

Recommended default:

- maximum of 2 remediation cycles
- fixed remediation window, such as 24 hours total, unless policy sets a different bound

Rationale:

- enough room to fix ordinary defects
- not enough room to create endless review loops

Implementations may tune the bounds, but they should remain explicit and reviewable.

## 6. What a Good Remediation Request Contains

A remediation request should identify:

- the agreement or case reference
- the review cycle number
- the exact acceptance criterion or requirement in question
- the observed defect or disagreement
- severity
- requested fix or requested outcome
- response deadline
- relevant evidence references

Unstructured dissatisfaction is weak input. Structured defect statements create fairness.

## 7. What a Good Provider Response Contains

A provider or executing operator response should state one of the following clearly:

- what was revised
- why the original delivery should stand
- what partial settlement is being proposed and why
- why mutual cancel is more appropriate
- why human review is required
- why formal escalation is now justified

The response should include updated deliverable references and evidence references where applicable.

## 8. Rules of Thumb

- fix obvious defects fast
- do not litigate a formatting or schema defect that can be corrected immediately
- defend only when the work actually matches the agreement
- offer partial settlement when usable value exists but full value does not
- prefer mutual cancel when neither side can reasonably use the outcome
- escalate when the disagreement is no longer operational but adjudicative

## 9. When Formal Dispute Becomes Appropriate

Formal dispute becomes appropriate when one or more of the following are true:

- remediation cycles are exhausted
- the remediation window expired
- the counterparty is non-responsive
- evidence is materially contested and cannot be reconciled directly
- partial settlement was offered and refused with clear evidence on record
- human review determines that adjudication is required

## 10. Dispute Readiness Standard

An operator should not open a formal dispute until it can present a clean package containing:

- agreement or case reference
- counterparties
- final agreed terms
- delivery references
- evidence hashes or canonical URIs
- remediation transcript or transcript hash
- exact contested points
- requested resolution

Weak escalation packages create preventable losses.

## 11. Anti-Patterns

Avoid:

- escalating immediately on the first complaint
- using remediation as a stalling tactic
- revising without linking the revision back to the original case
- changing acceptance criteria mid-remediation without explicit agreement
- burying the actual contested issue inside large irrelevant evidence dumps
- confusing client preference dissatisfaction with objective contract failure
