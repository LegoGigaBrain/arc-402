# ARC-402 Mega Audit — Auditor B (Architect)

## Executive Summary

ARC-402 has a credible **direction** as a policy-governed agent commerce rail, but it is **not yet structurally legitimate as an open public escrow/reputation network** in the form currently described by the docs and surrounding surfaces.

The strongest parts are:
- a bounded remediation concept exists on-chain
- evidence anchoring exists in a minimal form
- capability taxonomy governance exists in a narrow but useful form
- trust is beginning to move from generic scorekeeping toward capability-aware scoring
- operator doctrine is substantially more mature than the average early protocol

But the critical architectural problem is this:

**the doctrine, protocol narrative, and product surfaces describe a multi-layer institutional system; the enforceable core is still mostly a bilateral escrow contract with owner-controlled dispute resolution and weak truth-convergence guarantees.**

That mismatch matters. ARC-402 claims to be:
- policy-governed
- dispute-aware
- portable-trust-bearing
- human-escalation-safe
- scalable across a shared public market

Today it is better described as:
- a promising closed-pilot framework
- with useful escrow/trust primitives
- plus partially implemented remediation/dispute metadata
- plus operator doctrine that runs ahead of enforceable governance and review institutions

My verdict:

**Viable as a closed pilot with known operators, bounded value, and explicit human oversight.**

**Not yet legitimate for open launch as a public policy-governed escrow/reputation rail.**

The main blockers are not just bugs. They are invariant failures in:
- dispute authority
- truth-convergent reputation
- operational trust semantics
- state-machine closure
- composition between optional layers
- cross-surface consistency

## Critical Invariants

1. **Escrow finality invariant**  
   Every agreement must end in exactly one economically final, authority-legible outcome with no ambiguous or contradictory terminal path.

2. **Remediation-to-dispute progression invariant**  
   Remediation must be bounded, non-looping, transcript-linked, and escalate only under explicit, reviewable eligibility conditions.

3. **Authority clarity invariant**  
   Every actor with power over funds, trust, capability visibility, or dispute posture must be explicit, bounded, and institutionally legitimate.

4. **Truth-convergence invariant**  
   Repeated protocol use should drive trust and reputation toward more accurate beliefs about agent reliability, not merely toward popularity, deal volume, or coalition behavior.

5. **Taxonomy integrity invariant**  
   Capability discovery must converge on canonical meaning fast enough that search, trust specialization, arbitration specialization, and policy enforcement reference the same work domain.

6. **Operational trust legitimacy invariant**  
   Liveness and endpoint metrics must reflect meaningful operational reliability, not self-asserted theater that is cheap to spoof.

7. **Human escalation legitimacy invariant**  
   When human review is triggered, the system must clearly identify who the human authority is, what they are allowed to decide, and how that authority is constrained.

8. **Cross-surface consistency invariant**  
   Contract semantics, SDKs, CLI, docs, and operator doctrine must describe the same protocol, not different maturity levels presented as one coherent system.

9. **Scale invariance**  
   The protocol must preserve decision quality and anti-spam posture at 10, 1,000, and 100,000 agents without relying on hidden manual curation.

10. **Optional-layer composability invariant**  
    Identity, sponsorship, heartbeat, and ZK layers must not create false confidence, contradictory eligibility semantics, or governance bypasses when combined.

## Findings

### ID
ARC402-B-01

- Severity: Critical
- Launch Severity: Blocker
- Category: Governance / Dispute Authority
- Violated invariant: Authority clarity invariant; Human escalation legitimacy invariant
- Structural issue: The protocol narrative describes tiered remediation, peer arbitration, and human escalation, but the enforceable dispute core is still an `owner`-resolved `ServiceAgreement` with no on-chain peer arbitrator set, no arbitrator selection logic, no conflict-of-interest controls, no appeal layer, and no explicit mapping from “human review” to an accountable authority. `ESCALATED_TO_HUMAN` is therefore mostly a label plus owner discretion, not an institution.
- Impact at scale: At 10 agents this can work as a founder-operated pilot. At 1,000 agents it becomes trust bottlenecking around a hidden operator. At 100,000 agents it is not a protocol; it is a centralized adjudication service with protocol branding.
- Recommendation: Reframe current launch as closed-pilot only, or complete the authority stack before open launch: explicit adjudicator roles, selection rules, recusals, deadlines, review powers, evidence standards, and governance over parameter changes. If “human review” remains off-chain, define the accountable authority model explicitly in docs and tooling.

### ID
ARC402-B-02

- Severity: Critical
- Launch Severity: Blocker
- Category: State Machine / Escrow Semantics
- Violated invariant: Escrow finality invariant; Remediation-to-dispute progression invariant
- Structural issue: The state machine is not fully institution-safe. `fulfill()` still performs immediate escrow release from `ACCEPTED`/`REVISED`, bypassing the verification window path entirely; `commitDeliverable()` creates a different path with client review. This makes “delivery” semantically bifurcated: one path is reviewable, one path is unilateral release. In the same system that claims remediation-before-dispute, the provider can choose a path that reduces review symmetry.
- Impact at scale: At low scale, counterparties may coordinate socially. At market scale, providers will optimize for the path that maximizes payout certainty, clients will demand bespoke rules, and surface consistency will collapse. Discovery ranking and trust interpretation also become ambiguous because a “successful completion” may mean very different review depth.
- Recommendation: Unify delivery finalization semantics. Either all nontrivial agreements pass through verification/remediation gates, or immediate-release must be restricted to an explicitly typed agreement class with policy-level opt-in and lower trust weight.

### ID
ARC402-B-03

- Severity: High
- Launch Severity: Blocker
- Category: State Machine / Resolution Correctness
- Violated invariant: Escrow finality invariant
- Structural issue: `expiredDisputeRefund()` relies on `resolvedAt + DISPUTE_TIMEOUT`, but formal dispute opening currently sets `resolvedAt = block.timestamp` rather than a distinct dispute-open clock. This overloads “resolved” and “opened” semantics and makes timeout logic conceptually wrong even where behavior may still approximately work. A legitimacy rail cannot afford semantically inverted timestamps in the core adjudication path.
- Impact at scale: Timeout disputes become hard to reason about, audit, and mirror across SDKs and ops tooling. At scale, semantic ambiguity becomes operator error, inconsistent customer messaging, and possible governance conflict.
- Recommendation: Split timestamps cleanly: `disputedAt`, `lastEscalationAt`, `resolvedAt`, and if needed `verificationStartedAt`. Make timeout semantics derive from the correct event.

### ID
ARC402-B-04

- Severity: High
- Launch Severity: High
- Category: Remediation Design
- Violated invariant: Remediation-to-dispute progression invariant
- Structural issue: Remediation is transcript-linked and bounded, which is good, but structurally incomplete. `DEFEND` and `COUNTER` both collapse back into `REVISED`, meaning the on-chain state cannot distinguish “provider revised” from “provider defended original” or “provider counterproposed.” This weakens downstream review because the state machine erases adjudicatively relevant posture.
- Impact at scale: At 10 agents humans can inspect raw transcripts. At 1,000+, tooling and analytics will rely on state labels; losing posture semantics means weaker dispute triage, bad metrics, and poorer arbitrator assignment.
- Recommendation: Preserve response semantics in state or in a normalized review model used by all SDKs/CLI/docs. If contract-level state should stay compact, then formalize a canonical derived state machine off-chain and force all clients to use it consistently.

### ID
ARC402-B-05

- Severity: Critical
- Launch Severity: Blocker
- Category: Reputation Economics
- Violated invariant: Truth-convergence invariant
- Structural issue: Reputation and trust do not yet reliably converge toward truth. `ReputationOracle` permits one manual signal per publisher→subject pair for life, weighted by publisher trust at publication time, with no robust anti-collusion, no domain review institution, and no downgrade of stale or adversarial coalitions. Meanwhile trust gains derive largely from successful agreement completions and counterparty diversity heuristics, not actual correctness. This creates a path toward coalition-amplified belief, not verified truth.
- Impact at scale: At 10 agents, social context can compensate. At 1,000 agents, cliques and repeat-trade clusters can manufacture reputational moats. At 100,000 agents, portable trust drifts toward “network position + throughput + alliance structure,” not reliability.
- Recommendation: Separate at least three layers explicitly: execution reliability, domain competence, and adjudicated misconduct. Weight them differently. Add stronger decay or revalidation for social signals, and do not let raw signal accumulation masquerade as truth.

### ID
ARC402-B-06

- Severity: High
- Launch Severity: High
- Category: Operational Trust
- Violated invariant: Operational trust legitimacy invariant
- Structural issue: Agent heartbeat and latency metrics are self-reported by the agent itself in `AgentRegistry.submitHeartbeat()`. That makes “operational trust” primarily self-attested. It can measure willingness to ping, not actual endpoint reliability, availability to counterparties, or consistency under load.
- Impact at scale: At 1,000+ agents, self-reported uptime becomes a cheap SEO layer in discovery. At 100,000 agents, it becomes spam-friendly signaling noise unless paired with external observation, challenge-response, or marketplace-verified outcomes.
- Recommendation: Reclassify heartbeat metrics as weak telemetry, not trust. Introduce verifier-observed liveness, counterparty-confirmed responsiveness, or cryptographic challenge-response before operational metrics influence ranking materially.

### ID
ARC402-B-07

- Severity: High
- Launch Severity: High
- Category: Taxonomy / Discovery
- Violated invariant: Taxonomy integrity invariant
- Structural issue: `CapabilityRegistry` improves canonical taxonomy governance, but `ServiceAgreement.serviceType`, `AgentRegistry.capabilities`, docs, CLI examples, and some trust/reputation flows still admit or encourage loose strings. The system therefore has two parallel capability realities: canonical taxonomy and free-text service typing.
- Impact at scale: At 10 agents this is manageable. At 1,000 agents search fragmentation appears. At 100,000 agents specialization trust, peer arbitration routing, and anti-spam discovery all weaken because the protocol lacks one universally binding capability identity.
- Recommendation: Make canonical capability IDs the primary protocol object for new agreements, reputation specialization, discovery filtering, and arbitration eligibility. Free text should become metadata, not the authoritative domain label.

### ID
ARC402-B-08

- Severity: High
- Launch Severity: High
- Category: Cross-Surface Consistency
- Violated invariant: Cross-surface consistency invariant
- Structural issue: The docs and doctrine present a mature remediation/dispute stack, but the CLI and README still surface a simplified “hire / accept / deliver / dispute” model, and even mark contracts as not yet deployed or placeholders in parts of the interface. The architecture the user sees depends heavily on which surface they read.
- Impact at scale: Misaligned user expectations become protocol risk. Operators will assume features are institutionally real because docs say so, while implementers find thinner semantics on-chain and in the CLI. That is exactly how false-legitimacy incidents happen.
- Recommendation: Enforce a release discipline where README, CLI help, SDK methods, and doctrine are generated or at least gated against one source-of-truth lifecycle spec. Anything not enforceable yet should be labeled “operator convention” rather than “protocol behavior.”

### ID
ARC402-B-09

- Severity: Medium
- Launch Severity: High
- Category: CLI / SDK Safety
- Violated invariant: Cross-surface consistency invariant
- Structural issue: Surface APIs encode the protocol inconsistently. The CLI remediation command uses a parameter ordering that appears inconsistent with the Python SDK and contract ABI conventions. More broadly, the SDK/CLI expose advanced flows as if the protocol semantics are already stable, while operator doctrine still treats many layers as bounded conventions.
- Impact at scale: At pilot scale this creates operator friction. At open scale it creates silent malformed calls, broken remediation logs, and divergent client implementations.
- Recommendation: Create conformance tests across contract ABI ↔ TS SDK ↔ Python SDK ↔ CLI. The invariant should be: one lifecycle fixture, identical results across all clients.

### ID
ARC402-B-10

- Severity: High
- Launch Severity: High
- Category: Human Escalation
- Violated invariant: Human escalation legitimacy invariant
- Structural issue: The doctrine correctly says human escalation is required control, but the protocol does not define who the human is, how authority is authenticated, whether review is internal to a sponsor, external to a market, or delegated to governance, and how enterprise/private review interacts with public-portable trust. Human escalation is therefore conceptually mandatory but institutionally undefined.
- Impact at scale: This becomes a major legitimacy gap. Different operators will mean different things by “human review,” producing inconsistent fairness, opaque precedent, and non-portable outcomes.
- Recommendation: Define human review modes explicitly: local operator approval, enterprise authority, marketplace adjudicator, governance backstop. Each mode needs scope, evidence expectations, and what outputs may affect public reputation.

### ID
ARC402-B-11

- Severity: Medium
- Launch Severity: Medium
- Category: Sponsorship / Identity Composition
- Violated invariant: Optional-layer composability invariant
- Structural issue: `SponsorshipAttestation` and identity tiers provide useful signaling, but there is no strong protocol-wide rule for how sponsorship or higher identity tier should affect discovery, trust interpretation, review authority, or collateral expectations. Optional identity therefore risks becoming an ambiguous prestige layer.
- Impact at scale: At 1,000+ agents, ambiguity invites soft centralization: users and operators will over-trust sponsored identities without formal semantics. At 100,000 agents, sponsorship can become unofficial gatekeeping absent explicit policy.
- Recommendation: Define identity semantics narrowly. Example: identity affects disclosure confidence or compliance eligibility, not competence score by default. Keep sponsorship separate from earned service reliability unless a governed rule explicitly bridges them.

### ID
ARC402-B-12

- Severity: High
- Launch Severity: High
- Category: ZK / Trust Semantics
- Violated invariant: Optional-layer composability invariant
- Structural issue: `ZKTrustGate` proves only that some threshold input verified against a circuit; it does not bind the proof to a specific agent state root, timestamp, trust snapshot, or challenge context in the contract itself. As written, it is closer to a threshold-proof demo surface than a production eligibility primitive.
- Impact at scale: If used as a legitimacy layer, it can create false confidence: “ZK-verified” without strong statement binding. At scale, that is worse than no ZK because it appears rigorous while under-specifying meaning.
- Recommendation: Do not market ZK gates as protocol-legitimizing until proof statements are bound to identity, source state, freshness, and intended authorization semantics. Treat the current ZK layer as experimental.

### ID
ARC402-B-13

- Severity: Medium
- Launch Severity: Medium
- Category: Scale Architecture
- Violated invariant: Scale invariance
- Structural issue: Several components rely on patterns that are tolerable in a pilot but fragile in a network: linear-scan reputation reads, human-readable string-heavy semantics, self-policed remediation quality, and doctrine-dependent evidence hygiene. The protocol currently assumes operator discipline will absorb architectural incompleteness.
- Impact at scale: At 10 agents, discipline works. At 1,000 agents, it becomes training burden. At 100,000 agents, system quality is determined by the weakest operators and the easiest-to-game surfaces.
- Recommendation: Decide what ARC-402 wants to be at scale: a heavily governed institutional network or a lighter public primitive set. If the former, encode more policy and review semantics. If the latter, reduce claims and let higher-order institutions sit clearly above the base layer.

### ID
ARC402-B-14

- Severity: Medium
- Launch Severity: High
- Category: Governance Scope
- Violated invariant: Authority clarity invariant
- Structural issue: Governance exists as a minimal multisig executor, which is fine as a primitive, but the protocol narrative assigns governance much broader meaning: token whitelist control, taxonomy governance, penalty weights, mutable protocol parameters, and review legitimacy. The governance contract itself does not yet express domain boundaries, timelocks, role separation, or parameter registries matching those claims.
- Impact at scale: “Governed” becomes an overloaded word. Users cannot tell whether governance means secure parameter administration, emergency control, policy authorship, or dispute legitimacy.
- Recommendation: Publish and enforce a governance constitution: what governance can change, what is timelocked, what is immutable, which actions require wider review, and how governance relates to dispute authority.

## Invariants That Hold

1. **Bounded remediation exists conceptually and partially on-chain.**  
   The protocol does not default to immediate formal dispute in all cases; there is a real attempt to encode revision cycles, transcript chaining, and evidence anchoring.

2. **Escrow custody is straightforward and legible.**  
   The service agreement contract is relatively understandable as an escrow primitive, which is a good foundation.

3. **Capability taxonomy governance has a real anti-spam skeleton.**  
   Governance-gated roots plus active-agent-only claims is directionally correct.

4. **Trust is moving toward richer structure.**  
   Capability-specific scores, diversity weighting, and minimum value thresholds are meaningful improvements over naive aggregate trust.

5. **Operator doctrine is unusually mature for the implementation stage.**  
   The docs understand that evidence, remediation, risk classes, and human escalation are core institutional concerns rather than UX accessories.

## Invariants At Risk

1. **Open-network legitimacy** — currently at risk because the system still depends on hidden or implicit central judgment.
2. **Portable trust meaning** — at risk because reputation, trust, sponsorship, and heartbeat do not yet compose into one clear epistemic model.
3. **Discovery quality** — at risk because canonical taxonomy and free-text service typing still coexist.
4. **Adjudication fairness** — at risk because escalation labels outrun actual authority design.
5. **Client/provider expectation alignment** — at risk because docs, SDKs, CLI, and contracts describe different maturity levels.
6. **Operational anti-spam posture** — at risk because self-reported liveness and light reputation constraints are too easy to game in a large market.
7. **ZK meaning integrity** — at risk because proof validity is not yet equivalent to institutionally meaningful eligibility.

## Verdict

ARC-402 is **promising architecture in transition**, not yet a finished institutional protocol.

My architecture verdict is:

- **Closed pilot:** Yes, with bounded funds, known counterparties, explicit operator doctrine, and human review by named authorities.
- **Open public launch as a policy-governed escrow/reputation rail:** No, not yet.

The core reason is not that the system lacks features. It is that the current implementation does not yet make its most important claims true:
- governance is not yet fully governance-shaped
- human escalation is not yet fully authority-shaped
- reputation is not yet fully truth-shaped
- optional trust layers are not yet safely composable
- the lifecycle is not yet uniformly enforced across surfaces

If ARC-402 narrows its near-term claim to **"closed-pilot agent escrow + remediation + trust primitives under explicit operator governance"**, it is viable.

If it wants to claim **public, portable, policy-governed legitimacy**, it must first complete the authority model, unify lifecycle semantics, harden truth-convergence mechanics, and force cross-surface consistency.