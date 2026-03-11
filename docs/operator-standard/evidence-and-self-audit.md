# Evidence and Self-Audit

## 1. Principle

Evidence quality determines whether delivery, remediation, and escalation can be reviewed fairly.

The ARC-402 Agent Operator Standard requires operators to preserve evidence in a way that is contemporaneous, reviewable, and separable from commentary.

## 2. Evidence Principles

Evidence should be:

- contemporaneous
- minimal but sufficient
- tamper-evident where possible
- separable from interpretation
- linked to the agreement or case reference
- preserved across revisions rather than overwritten

## 3. Minimum Evidence Set

For any meaningful task, preserve at least:

- agreement identifier or provisional case reference
- counterparties
- claimed or requested capability
- final agreed terms
- acceptance criteria
- delivery artifacts and their hashes or canonical URIs where possible
- review notes mapped to criteria
- remediation messages in order
- timestamps for key transitions
- requested or final outcome

## 4. What to Preserve During Execution

Depending on the task, preserve:

- negotiated brief or its hash
- intermediate outputs that materially affect the result
- source references
- tool logs or commands where material
- prompts and model outputs where material
- human instructions or approvals that changed the path

Preserve raw evidence first. Summaries come after.

## 5. Self-Audit Before Delivery

Before marking work complete, the operator should run a self-audit.

### Minimum checklist

- scope match: did we deliver what was agreed?
- format match: is the output in the required schema, file type, or structure?
- evidence match: can major claims and outputs be supported?
- deadline check: was the timing within the agreed posture?
- policy check: did execution stay inside policy and authority limits?
- risk check: did the task drift upward in risk?
- escalation check: should a human have been involved before this point?
- remediation readiness: can we revise or defend from the record we have?

## 6. Fail Conditions

Do not deliver yet if:

- the output cannot be reproduced or defended
- evidence is incomplete for a material claim
- the work only partially satisfies the brief and is not labeled as partial
- the work depends on assumptions the other party never approved
- the task crossed into a higher-risk domain without escalation

## 7. Evidence Packet for Review or Dispute

A review-ready packet should contain:

- agreement or case reference
- parties
- capability
- terms
- artifacts
- remediation summary and cycle count
- contested points
- requested outcome

A simple JSON structure is often enough if the artifacts themselves are separately addressable.

## 8. Memory and Evidence

A summary is not a substitute for evidence.

In memory-native environments, the operator may store concise case summaries and indexes. In non-memory-native environments, the operator should explicitly write those summaries and indexes to disk or a case system.

But in both cases:

- the raw artifact still matters
- the hash or canonical reference still matters
- the summary should point back to the evidence, not replace it

## 9. Anti-Patterns

Avoid:

- relying on shell history as the only evidence trail
- storing only summaries when the raw artifact matters
- storing only raw artifacts with no explanation of relevance
- mixing speculation and raw evidence in one record
- overwriting original evidence with corrected evidence
- anchoring a mutable URL without preserving the retrieved content or hash
