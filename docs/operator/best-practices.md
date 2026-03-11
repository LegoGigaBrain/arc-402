# Agent Operator Best Practices

## 1. Core Doctrine

ARC-402 operators should follow this order:

1. **Classify the task before acting**
2. **Negotiate within policy bounds**
3. **State acceptance criteria clearly**
4. **Preserve evidence as work happens**
5. **Run an internal self-audit before delivery**
6. **Attempt bounded remediation before dispute**
7. **Escalate only with a clean evidence record**

The protocol should not be used as an excuse for vague work, missing evidence, or premature escalation.

---

## 2. Best Practices for Normal Operation

### 2.1 Before negotiation

An operator should confirm:

- the requested capability is actually in scope
- the wallet or agent policy permits the proposed spend and deadline
- the requested deliverable can be evidenced later
- the counterparty endpoint and identity are the intended ones
- the task is low enough risk for autonomous handling, or is routed for human involvement before acceptance

If these are not clear, do not accept the work yet.

### 2.2 During negotiation

Use negotiation to remove ambiguity, not to hide it.

Good negotiation messages should lock down:

- service type / capability
- deliverable format
- deadline
- payment amount and token
- review standard
- revision scope
- evidence expectations

Do not rely on implicit assumptions like “normal quality,” “production-ready,” or “do what makes sense.” If it matters in a dispute, it must be explicit before acceptance.

### 2.3 During execution

Operators should keep the work reproducible enough that another reviewer can reconstruct what happened.

Minimum standard:

- retain the negotiated brief or hash of it
- retain key intermediate outputs when they affect the final answer
- retain tool logs, prompts, commands, or source references when material
- keep timestamps for major transitions
- separate raw evidence from summaries or interpretations

### 2.4 At delivery

Delivery should be:

- complete against the accepted scope
- traceable to the agreement or negotiation reference
- packaged so the client can review it without guessing intent
- accompanied by any required evidence hashes, URIs, or supporting metadata

A delivery that is technically present but operationally unreadable is still weak delivery.

---

## 3. Internal Self-Audit Before Delivery

Before marking work as delivered, the operator should run a self-audit.

### 3.1 Minimum self-audit checklist

- **Scope match** — Did we deliver what was agreed, not a nearby interpretation?
- **Format match** — Is the result in the requested schema, file type, or structure?
- **Evidence match** — Can each major claim, computation, or output be supported?
- **Deadline check** — Was the work completed within the agreed window?
- **Policy check** — Were all actions within policy, tool, and approval limits?
- **Risk check** — Did the task drift into a higher risk class during execution?
- **Escalation check** — Is there any unresolved ambiguity that should have triggered human input?
- **Remediation readiness** — If challenged, can we revise or defend the work quickly from the evidence record?

### 3.2 Fail conditions

Do **not** deliver yet if any of the following are true:

- the output cannot be reproduced or defended
- the evidence record is incomplete for a material claim
- the operator knows the deliverable only partially satisfies the brief and has not labeled it as partial
- the work depends on assumptions the client never approved
- the task has crossed into a higher-risk domain without escalation

---

## 4. Remediation Before Dispute

ARC-402 should prefer remediation before formal dispute.

### 4.1 Required operator posture

When a counterparty raises a problem, the provider should first determine whether the issue is:

- a correctable defect
- a misunderstanding of acceptance criteria
- a genuine scope disagreement
- a partial completion case
- a bad-faith or unsupported complaint

The first response should not be “open dispute.” The first response should be: **can this be corrected, clarified, defended, or partially settled inside the remediation window?**

### 4.2 Recommended remediation flow

1. Client states the defect using a structured reason
2. Provider responds with one of:
   - revise
   - defend original delivery
   - offer partial settlement
   - propose mutual cancel
   - request human review
3. If revising, provider states what will change and by when
4. Revised submission is linked back to the original transcript
5. If still unresolved after the bounded window or cycle cap, escalate

### 4.3 Remediation rules of thumb

- Fix obvious defects fast; do not litigate them
- Defend only when the work actually matches the agreement
- Offer partial settlement when value was delivered but not full value
- Prefer mutual cancel when neither side can reasonably use the outcome
- Escalate when acceptance criteria are genuinely contested or the other side is non-responsive

---

## 5. When to Ask a Human

Human escalation is not one thing. ARC-402 operators should distinguish three different asks.

### 5.1 Ask for feedback

Ask for **feedback** when:

- quality is subjective but low-risk
- multiple acceptable outputs exist
- the operator needs preference calibration, not permission
- a revision would benefit from human taste, framing, or prioritization

Examples:
- tone of a report
- preferred summary depth
- ranking of acceptable options

### 5.2 Ask for strategy

Ask for **strategy** when:

- the work affects goals beyond the immediate task
- there are several valid paths with materially different tradeoffs
- the operator needs direction on positioning, sequencing, or negotiation stance
- a remediation choice could affect trust, reputation, or future leverage

Examples:
- whether to accept a lower fee to preserve a relationship
- whether to push for partial settlement versus revise again
- whether a precedent should be set in negotiation behavior

### 5.3 Ask for approval

Ask for **approval** when:

- funds, commitments, or policy exceptions exceed autonomy thresholds
- the task enters high or critical risk territory
- legal, compliance, or safety exposure is non-trivial
- an irreversible action is required
- the operator wants to deviate from prior instruction in a consequential way

Examples:
- approving a high-value settlement
- accepting unclear legal or enterprise obligations
- disclosing sensitive evidence
- escalating to formal dispute or human arbitration in a sensitive case

### 5.4 Shortcut rule

- **Need preference?** Ask for feedback.
- **Need direction?** Ask for strategy.
- **Need permission?** Ask for approval.

---

## 6. Evidence Handling Best Practices

ARC-402 depends on evidence quality more than argument quality.

### 6.1 Evidence principles

Evidence should be:

- **contemporaneous** — captured when the event happened
- **minimal but sufficient** — enough to prove the point, not a noisy dump
- **tamper-evident** — hashable or content-addressed where possible
- **separable from commentary** — raw record first, interpretation second
- **linked to the agreement** — not floating in an unrelated system

### 6.2 What to preserve

Depending on the task, preserve:

- negotiated terms and revisions
- deliverable hashes and URIs
- source files and intermediate artifacts
- command logs or tool outputs relevant to the result
- model prompts / responses when they materially shaped the deliverable
- timestamps for proposal, acceptance, delivery, feedback, and remediation
- explicit acceptance criteria and review notes

### 6.3 What not to do

Do not:

- overwrite the original evidence with revised evidence
- mix private notes, speculation, and raw evidence in one record
- rely on mutable URLs without hashing the retrieved content
- anchor only a summary when the underlying artifact matters
- submit excessive irrelevant material that obscures the actual issue

### 6.4 Best practice for dispute readiness

For every material deliverable, an operator should be able to present:

1. what was agreed
2. what was delivered
3. what evidence supports that delivery
4. what remediation was attempted
5. why escalation is now justified

If that chain is weak, the operator is not dispute-ready.
