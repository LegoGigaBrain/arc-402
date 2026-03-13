# ARC-402 Mega Audit — Auditor A (Attacker)

## Executive Summary

This audit was performed from an adversarial / profit-seeking attacker perspective, not a general code quality perspective. The main question was: **how do I steal funds, lock funds, grief users, poison trust, manipulate disputes, spoof operational credibility, or profitably suppress competitors?**

### Bottom line

**ARC-402 is not safe for real money or open adversarial deployment in its current form.**

The most dangerous issues are not subtle:

1. **Providers can directly self-release escrow via `fulfill()` with no client verification** and no on-chain linkage between the promised deliverables hash and the delivered one. That is a straight-line escrow theft primitive.
2. **Formal dispute can be opened immediately, bypassing remediation doctrine**, which creates cheap grief / fund-lock attacks and undermines the operator standard.
3. **Dispute resolution is owner-controlled**, so the system inherits a hard centralized theft / collusion risk. Any compromised owner key, bribed operator, or captured governance path can arbitrarily redistribute escrow.
4. **Trust / reputation are highly gameable**. Fresh wallets can self-initialize to nonzero trust, sybils can publish weighted social signals, and identity tiers can be minted by arbitrary sponsors with no economic bond. This enables trust farming and competitor assassination.
5. **Heartbeat / operational trust are self-reported**, so they are spoofable and can be tuned by the claimant to look healthy.
6. **ZK gates prove the wrong thing semantically**: they do not bind proofs to the caller’s real on-chain trust / solvency state, and capability proofs are self-rooted rather than registry-rooted. They can be used to create false confidence rather than privacy-preserving assurance.
7. **CLI / SDK abstractions materially increase operator error risk** by exposing “immediate fulfill” and other flows that normalize unsafe settlement behavior.

### Launch assessment

- **Mainnet / production funds:** **No**
- **Pilot with real adversaries or external users:** **No**, unless escrowed value is trivial and disputes are socially supervised
- **Private demo / research sandbox only:** acceptable

### Validation performed

- Read the requested audit brief and in-scope reference contracts / protocol surfaces
- Reviewed the core contracts relevant to escrow, dispute, trust, reputation, identity, capability, heartbeat, governance, and ZK gates
- Reviewed CLI / Python SDK wrappers and operator-skill doctrine for abstraction-level attack surface
- Ran `forge test` in `products/arc-402/reference` (returned success; existing tests mostly validate intended mechanics, but several dangerous behaviors are currently treated as acceptable design rather than security failures)

## Attack Surfaces

1. **Escrow lifecycle / settlement state machine**
   - `ServiceAgreement.propose`
   - `accept`
   - `fulfill`
   - `commitDeliverable`
   - `verifyDeliverable`
   - `autoRelease`
   - `cancel`
   - `expiredCancel`
   - `dispute`
   - `escalateToDispute`
   - `resolveDisputeDetailed`
   - `expiredDisputeRefund`

2. **Remediation and evidence flow**
   - remediation transcript chaining
   - dispute evidence submission
   - partial-settlement state transitions
   - human-review escalation path

3. **Trust / reputation / identity layer**
   - `TrustRegistryV2`
   - `ReputationOracle`
   - `SponsorshipAttestation`
   - trust-weighted discovery and selection

4. **Operational trust / discovery credibility**
   - `AgentRegistry`
   - self-asserted capabilities
   - heartbeat policy / latency reporting
   - endpoint stability scoring

5. **Governance / admin control**
   - `ServiceAgreement.owner`
   - `ARC402Governance` / governance posture in docs and SDK
   - contract updaters / owner-only resolution

6. **ZK assurance layer**
   - `ZKTrustGate`
   - `ZKSolvencyGate`
   - `ZKCapabilityGate`
   - corresponding circom circuits

7. **SDK / CLI / operator doctrine**
   - CLI `deliver --fulfill`
   - discovery filters
   - local trust writes in wallet flow
   - operator doctrine vs contract reality gaps

## Findings

### ARC-A-01
- **Severity:** Critical
- **Launch Severity:** BLOCKER
- **Category:** Escrow theft / state bypass
- **Exploit path:**
  1. Attacker registers as provider or is selected off-chain.
  2. Client proposes and locks escrow.
  3. Provider accepts.
  4. Provider calls `fulfill(agreementId, arbitraryHash)` directly.
  5. Contract sets status to `FULFILLED` and immediately releases full escrow to provider.
  6. No client verification is required; no comparison is made between promised `deliverablesHash` and actual delivered content/hash.
- **Preconditions:** Provider can get a client to create and accept an agreement.
- **Impact:** Direct theft of full escrow for every accepted agreement. This is the single most profitable and scalable attack in the system.
- **Cost to execute:** Very low. Just normal protocol gas. No special privileges needed.
- **Recommendation:**
  - Remove direct provider-paid `fulfill()` for economically meaningful flows.
  - Require `commitDeliverable` → client verification / bounded auto-release as the default path.
  - If instant settlement is ever retained, enforce an explicit client opt-in flag at agreement creation and bind `actualDeliverablesHash` to precommitted / verifiable criteria.
  - Do not overwrite the original deliverables spec hash with an arbitrary provider-supplied hash.

### ARC-A-02
- **Severity:** High
- **Launch Severity:** BLOCKER
- **Category:** Griefing / fund locking / doctrine bypass
- **Exploit path:**
  1. Agreement is accepted or in delivery-related states.
  2. Either party calls `dispute(agreementId, reason)`.
  3. `_openFormalDispute(..., false)` allows immediate dispute without passing remediation eligibility.
  4. Escrow is frozen until owner/admin resolution or timeout.
- **Preconditions:** Party to an active agreement.
- **Impact:** Cheap griefing and liquidity lockup. A malicious provider or client can skip remediation entirely and force 30-day capital lock plus social overhead. This directly contradicts the operator doctrine that remediation is the default before formal dispute.
- **Cost to execute:** Very low.
- **Recommendation:**
  - Remove the unconditional `dispute()` path for normal flows, or hard-gate it behind explicit emergency conditions.
  - Require remediation exhaustion / timeout / documented human trigger before dispute opening.
  - Keep “immediate dispute” only for tightly scoped exceptional categories with an on-chain reason code, not freeform use.

### ARC-A-03
- **Severity:** Critical
- **Launch Severity:** BLOCKER
- **Category:** Arbitration collusion / admin theft / governance capture
- **Exploit path:**
  1. Agreement becomes `DISPUTED`, `ESCALATED_TO_HUMAN`, or `ESCALATED_TO_ARBITRATION`.
  2. Contract owner calls `resolveDisputeDetailed`.
  3. Owner chooses any split summing to `ag.price`.
  4. Funds are released immediately to provider/client per owner decision.
- **Preconditions:** Owner key, compromised owner key, bribed operator, coerced admin, or captured governance route.
- **Impact:** Arbitrary confiscation or redirection of all disputed escrow. This is not just a decentralization concern; it is a direct theft surface. It also creates a bribery market: for any dispute amount `V`, attacker can offer owner a side payment `< V` and still profit.
- **Cost to execute:** Medium if bribery/capture; trivial if owner key compromised.
- **Recommendation:**
  - Do not use owner-only dispute resolution for real funds.
  - Move to threshold governance / multisig with explicit dispute policy and transparent signer set at minimum.
  - For serious deployment, separate protocol admin from dispute adjudication entirely.
  - Add immutable or timelocked dispute module selection, dispute audit logs, and slashing / accountability for arbitrators.

### ARC-A-04
- **Severity:** High
- **Launch Severity:** BLOCKER
- **Category:** Evidence abuse / unverifiable settlement semantics
- **Exploit path:**
  1. Provider commits arbitrary hash or fulfills with arbitrary hash.
  2. Client and provider upload evidence URIs / hashes in dispute.
  3. On-chain contract does not verify content semantics, transcript completeness, or linkage to acceptance criteria.
  4. Owner/arbitrator resolves based on external judgment with no machine-checkable constraints.
- **Preconditions:** Any disputed or completed agreement.
- **Impact:** Evidence flooding, cherry-picking, hostile URI substitution, and subjective resolution. In practice this makes evidence power depend on operator skill, social access, and arbitrator alignment, not protocol guarantees.
- **Cost to execute:** Low.
- **Recommendation:**
  - Treat evidence URIs as weak pointers, not proof.
  - Require canonical evidence bundles, transcript roots, and schema-bound acceptance criteria.
  - Anchor final negotiated terms and remediation transcript root immutably before dispute eligibility.
  - Separate “evidence existence” from “evidence validity” clearly in docs and UI.

### ARC-A-05
- **Severity:** High
- **Launch Severity:** BLOCKER
- **Category:** Trust farming / identity bootstrapping abuse
- **Exploit path:**
  1. Attacker creates many fresh wallets.
  2. Calls `TrustRegistryV2.initWallet(wallet)` on each or otherwise triggers initialization.
  3. Each wallet receives `INITIAL_SCORE = 100` and a live `lastUpdated` timestamp.
  4. These wallets can now appear as nonzero-trust publishers / agents / counterparties.
- **Preconditions:** None. `initWallet` is public.
- **Impact:** Cheap nonzero-trust sybil population. This weakens any trust thresholding, reputation weighting, or discovery sort order that assumes trust starts at zero or requires costly history.
- **Cost to execute:** Very low.
- **Recommendation:**
  - Make initialization permissioned or economically gated.
  - Consider `0` starting score with explicit attested bootstrap paths.
  - Separate “registered / known” from “trusted”.
  - Treat any bootstrapped score as non-weight-bearing until distinct counterparties / value thresholds are met.

### ARC-A-06
- **Severity:** High
- **Launch Severity:** BLOCKER
- **Category:** Reputation poisoning / sybil-weighted signaling
- **Exploit path:**
  1. Attacker generates many wallets and initializes them to nonzero trust.
  2. Each wallet publishes one manual `WARN` or `BLOCK` against a target via `ReputationOracle.publishSignal`.
  3. Oracle weights signals by `publisherTrustAtTime`.
  4. Victim’s weighted score is suppressed, affecting hiring / discovery.
- **Preconditions:** Cheap wallet creation; nonzero trust bootstrap.
- **Impact:** Competitor assassination and trust poisoning at low cost. Because manual signals are one-per-publisher-per-subject, the natural attacker response is many publishers. This is exactly what sybils are good at.
- **Cost to execute:** Low to medium, depending on how much weighting the attacker wants.
- **Recommendation:**
  - Do not weight raw manual signals from fresh or weakly attested identities.
  - Add stake / bond / slash risk for negative signals, or require dispute-linked evidence for negative weight.
  - Add counterparty-diversity and age requirements before a publisher’s reputation weight counts materially.
  - Expose negative-signal provenance prominently in discovery UI.

### ARC-A-07
- **Severity:** Medium
- **Launch Severity:** PILOT-OK
- **Category:** Auto-reputation suppression / grief ceiling gaming
- **Exploit path:**
  1. Attacker coordinates multiple low-trust clients against a provider.
  2. Triggers disputes resolved against provider or otherwise routes into `autoWarn`.
  3. Provider accumulates up to `AUTO_WARN_MAX_PER_WINDOW = 3` warnings per 7-day window.
  4. Attacker can continue every new window.
- **Preconditions:** Ability to induce or manufacture enough failed agreements / adverse resolutions.
- **Impact:** Repeatable periodic reputation suppression. The window cap slows but does not prevent coordinated griefing.
- **Cost to execute:** Medium.
- **Recommendation:**
  - Only emit auto-warn when adverse resolution satisfies stronger evidence / value thresholds.
  - Weight auto-warn by counterparty quality and agreement significance.
  - Consider symmetric auto-signals and fraud-detection heuristics for repeated hostile counterparties.

### ARC-A-08
- **Severity:** High
- **Launch Severity:** BLOCKER
- **Category:** Identity tier gaming / false verification marketing
- **Exploit path:**
  1. Arbitrary sponsor calls `publishWithTier(agent, ..., VERIFIED_PROVIDER or ENTERPRISE_PROVIDER, evidenceURI)`.
  2. No stake, registry permission, or accreditation requirement exists for sponsor.
  3. `getHighestTier(agent)` simply returns the highest active tier among all attestations.
- **Preconditions:** Any external wallet willing to mint an attestation.
- **Impact:** “Verified” and “Enterprise” identity tiers are forgeable by friendly sybils, partners, shell entities, or paid endorsers. This can materially distort marketplace selection and suppress honest competitors.
- **Cost to execute:** Very low.
- **Recommendation:**
  - Restrict high tiers to approved attestors, or make tier meaning namespaced by issuer reputation.
  - Add staking / slashing / revocation accountability for sponsors.
  - Never aggregate arbitrary sponsor-issued tiers into a global “highest tier” label without issuer weighting.

### ARC-A-09
- **Severity:** High
- **Launch Severity:** BLOCKER
- **Category:** Heartbeat spoofing / operational trust spoofing
- **Exploit path:**
  1. Agent self-registers.
  2. Calls `setHeartbeatPolicy` with lax settings (up to 7 days interval).
  3. Calls `submitHeartbeat(latencyMs)` with fabricated low latency, including `0` which maps to score 100.
  4. Discovery surfaces operational trust / uptime / response as if externally observed.
- **Preconditions:** Registered agent.
- **Impact:** Fake liveness and fake performance metrics. This undermines operational trust, enables spoofed reliability, and can be used to outrank honest but stricter operators.
- **Cost to execute:** Very low.
- **Recommendation:**
  - Treat self-reported heartbeat as self-assertion only, not trust.
  - Separate “agent pinged itself” from externally observed uptime.
  - Fix scoring so `latencyMs == 0` is invalid unless explicitly representing unknown.
  - Add externally verified probes or third-party monitors if operational trust matters economically.

### ARC-A-10
- **Severity:** High
- **Launch Severity:** BLOCKER
- **Category:** Capability spam / namespace abuse / discovery manipulation
- **Exploit path:**
  1. Attacker registers arbitrary freeform capability strings in `AgentRegistry`.
  2. CLI discovery uses substring matching on raw self-asserted capabilities (`value.includes(opts.capability)`).
  3. Attacker stuffs capability lists with near-matches / keyword bait.
- **Preconditions:** Agent registration.
- **Impact:** Search poisoning and false discovery matches. Honest canonical taxonomy users can be crowded out by spammy self-descriptions. This is especially profitable in marketplaces where first-page visibility matters.
- **Cost to execute:** Very low.
- **Recommendation:**
  - Discovery should default to canonical `CapabilityRegistry` entries only.
  - Do exact canonical capability matching, not substring search.
  - Separate self-claimed tags from verified canonical capabilities in UI and ranking.

### ARC-A-11
- **Severity:** High
- **Launch Severity:** BLOCKER
- **Category:** ZK proof misuse / wrong semantics / replayable assurance
- **Exploit path:**
  1. Attacker obtains or reuses a valid Groth16 proof for `actualScore >= threshold` in `ZKTrustGate`, or `walletBalance >= requiredAmount` in `ZKSolvencyGate`.
  2. Calls verification contract from their own address.
  3. Contract verifies only the public threshold/requiredAmount; it does **not** bind proof to caller address, on-chain score source, current state, epoch, or nonce.
  4. Event emits as if caller proved their own eligibility.
- **Preconditions:** Any valid proof for the statement, regardless of whose state it came from.
- **Impact:** False privacy-preserving assurance. An attacker can present someone else’s trust/solvency proof, or a stale proof, as their own. This is catastrophic if counterparties rely on these gates operationally.
- **Cost to execute:** Low once proofs exist.
- **Recommendation:**
  - Bind public signals to at least: caller identity, statement domain, epoch / validity window, and authoritative state commitment.
  - For trust proofs, prove against an authenticated trust root / signed snapshot, not a private arbitrary witness.
  - For solvency proofs, bind to wallet identity and state root / snapshot source.

### ARC-A-12
- **Severity:** High
- **Launch Severity:** BLOCKER
- **Category:** ZK capability spoofing / self-rooted proofs
- **Exploit path:**
  1. Attacker chooses any capability set off-chain and computes a root.
  2. Calls `setCapabilityRoot(root)` in `ZKCapabilityGate`.
  3. Generates proof for any desired capability under that self-chosen tree.
  4. `verifyCapability` succeeds because it only checks against caller’s self-registered root.
- **Preconditions:** Ability to register a root.
- **Impact:** The proof does not establish that the capability is recognized by ARC-402 taxonomy, by any authority, or by prior market behavior. It only proves consistency with the attacker’s own self-declared set. This is reputation theater, not assurance.
- **Cost to execute:** Low to medium.
- **Recommendation:**
  - Bind capability proofs to a canonical registry root, attested issuer root, or signed capability snapshot.
  - Explicitly namespace self-asserted capability roots if they remain allowed.
  - Do not let consumers interpret self-root proofs as verified capability possession.

### ARC-A-13
- **Severity:** Medium
- **Launch Severity:** PILOT-OK
- **Category:** Wrong-hash / semantic mismatch risk in ZK capability path
- **Exploit path:**
  1. Off-chain integrators treat `capabilityHash` as `keccak256(capabilityString)` per contract docs.
  2. Circuit builds leaf as `Poseidon(capabilityHash)` over field inputs.
  3. Different toolchains / encoding conventions can create incompatible or ambiguously interpreted proofs.
- **Preconditions:** Multi-implementation ecosystem.
- **Impact:** Proof acceptance failures, false negatives, or accidental acceptance of semantically inconsistent capability identities. This is more of a catastrophic integration trap than a theft vector, but it will create exploitable operator confusion.
- **Cost to execute:** Low.
- **Recommendation:**
  - Publish exact canonical encoding rules.
  - Version the proof domain.
  - Provide conformance test vectors across SDKs / circuits / verifiers.

### ARC-A-14
- **Severity:** High
- **Launch Severity:** BLOCKER
- **Category:** SDK/CLI abstraction induces escrow theft mistakes
- **Exploit path:**
  1. Provider uses CLI `deliver <id> --fulfill`.
  2. CLI hashes any file or even arbitrary message text and calls `fulfill()` directly.
  3. README normalizes this as “Deliver and claim payment”.
  4. Operators and integrators internalize unsafe instant-settlement as the normal flow.
- **Preconditions:** Provider/operator follows CLI happy path.
- **Impact:** Converts a dangerous low-level primitive into a promoted workflow. Even if the core contract were later tightened socially, the CLI currently trains users into bypassing verification and into disputable settlement patterns.
- **Cost to execute:** Very low.
- **Recommendation:**
  - Remove `--fulfill` from default CLI UX.
  - Make commit-and-verify the only normal delivery command.
  - Add large warnings or hard confirmations around any instant-settlement path.

### ARC-A-15
- **Severity:** Medium
- **Launch Severity:** PILOT-OK
- **Category:** Discovery / trust UX mismatch creates exploitable operator mistakes
- **Exploit path:**
  1. SDK/CLI/docs present trust, sponsorship tier, reputation, heartbeat, and capabilities together.
  2. Human operator interprets them as comparable security signals.
  3. Attacker composes sybil trust, fake heartbeat, fake capability tags, and forged sponsor tier into a convincing profile.
- **Preconditions:** Human selection from discovery surfaces.
- **Impact:** Operator hires the wrong provider or defers to the wrong arbitrator / sponsor / reviewer. This is the most realistic marketplace exploitation path even if some lower-level flaws are patched.
- **Cost to execute:** Low.
- **Recommendation:**
  - Split self-asserted, socially asserted, protocol-earned, and externally verified signals into separate sections.
  - Add explicit provenance labels everywhere.
  - Never compress these into a single “trust” impression without provenance.

### ARC-A-16
- **Severity:** Medium
- **Launch Severity:** PILOT-OK
- **Category:** Deadline grief / capital lock
- **Exploit path:**
  1. Malicious client proposes extremely short deadlines.
  2. Provider accepts late or misses the window.
  3. Client recovers via `expiredCancel`; provider wastes time / opportunity.
  4. Combined with repeated spam and low-value tasks, attacker can impose operational drag on competitors.
- **Preconditions:** Provider willing to accept bad agreements or automated acceptance tooling.
- **Impact:** Competitive griefing and workflow disruption. Not direct theft, but profitable in a marketplace race where response handling is costly.
- **Cost to execute:** Low to medium.
- **Recommendation:**
  - Add minimum safe deadlines at the contract or client layer.
  - Default acceptance tooling should reject short deadlines automatically.

## Most Dangerous Composite Attack Chains

### Chain 1 — The fake trusted provider drain
1. Create many wallets and bootstrap them to nonzero trust via `initWallet`.
2. Use sybil/manual reputation signals plus arbitrary sponsorship attestations to manufacture a “verified” identity aura.
3. Self-report clean heartbeat metrics and capability spam to rank well in discovery.
4. Get hired by victims.
5. Accept agreement and call `fulfill()` immediately with arbitrary hash.
6. If challenged, either rely on user confusion or open immediate dispute to freeze / pressure the victim.

**Result:** steal escrow while looking reputable enough to win business in the first place.

### Chain 2 — Competitor assassination + market capture
1. Spin up many sybil publishers.
2. Publish weighted negative signals against target providers.
3. Use fake sponsor attestations so attacker identities appear “enterprise” or “verified”.
4. Spoof heartbeat / uptime to appear reliable.
5. Stuff capabilities for search capture.
6. Force nuisance disputes against target providers in any bilateral contracts to create operational drag.

**Result:** suppress competitors’ visibility and trust while inflating attacker profiles.

### Chain 3 — Arbitrator bribery extraction
1. Attackers intentionally route agreements into dispute, or create sham disputes with colluding counterparties.
2. Owner/arbitrator resolves in attacker’s favor for side payments.
3. Because dispute resolution is unilateral and opaque to protocol logic, bribe economics are favorable whenever side payment < escrow at risk.

**Result:** direct extraction from disputed funds and collapse of trust in the marketplace.

### Chain 4 — ZK credential laundering
1. Obtain a valid trust/solvency proof from another context or for another wallet.
2. Reuse it through `ZKTrustGate` / `ZKSolvencyGate` as caller.
3. Pair it with self-rooted capability proof in `ZKCapabilityGate`.
4. Present this stack as privacy-preserving proof of trust, solvency, and specialization.

**Result:** high-end counterparties are deceived using cryptographic theater rather than cryptographic assurance.

## Verdict

**Verdict: NOT SAFE FOR OPEN PILOT OR MAINNET ECONOMIC USE.**

If ARC-402 remains a research / reference project, the current state is acceptable as a draft. But if the question is whether an adversary can profitably break the mechanism, the answer is clearly yes.

### Main blockers before any serious launch
- Eliminate provider-direct escrow self-release as the default/allowed path for real jobs
- Enforce remediation-before-dispute unless truly exceptional
- Replace owner-only dispute resolution with a safer adjudication model
- Make trust / reputation / identity materially sybil-resistant
- Reclassify self-reported heartbeat / capability claims as untrusted metadata
- Redesign ZK gates so proofs bind to authoritative state, caller identity, and freshness
- Remove unsafe CLI / SDK happy paths that normalize bypass settlement

### Practical launch posture
- **Sandbox / internal demo:** yes
- **Closed research pilot with trivial funds and active human supervision:** maybe
- **Public pilot with economic value or adversarial users:** no
- **Mainnet / production marketplace:** absolutely no in current form
