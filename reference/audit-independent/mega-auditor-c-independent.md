# ARC-402 Mega Audit — Auditor C (Independent)

## Executive Summary

The codebase is materially stronger than a rough draft, and the core contract suite does compile and test cleanly from the current tree. But several surfaces that look polished are still misleading or incomplete under cold review.

The clearest launch blocker is the ZK extension path: the gate contracts and generated verifier contracts do not agree on public input arity, so the advertised privacy-preserving verification flow is not operational as written. Beyond that, multiple operator-facing surfaces overstate what is enforced or supported: the CLI README implies payment release on the default delivery path when it usually only commits a hash; operator doctrine says remediation precedes dispute, while the contract and CLI still allow direct dispute by default; and the remediation/dispute status surface advertises an arbitration state that the implementation never actually enters.

The Python SDK also has a subtle correctness hazard: helper conversion to `bytes32` silently truncates oversized values, which is especially dangerous on evidence/transcript/hash-heavy flows because it can mutate identifiers without an explicit error.

Overall verdict: **not safe to treat as fully reconciled operator/SDK/docs surface yet**. Closed pilot quality is plausible for the main non-ZK path, but only after the misleading surfaces are corrected and the missing tests are added.

## Findings

### C-01
- ID: C-01
- Severity: HIGH
- Launch Severity: BLOCKER
- Category: zk
- Surface / file: `contracts/ZKTrustGate.sol`, `contracts/ZKSolvencyGate.sol`, `contracts/ZKCapabilityGate.sol`, generated verifier contracts `TrustThresholdVerifier.sol`, `SolvencyProofVerifier.sol`, `CapabilityProofVerifier.sol`
- Issue: The gate interfaces and the generated verifier contracts disagree on public input shape. `ZKTrustGate` and `ZKSolvencyGate` call verifiers with `uint[1]` public signals, while the generated verifier contracts expose `verifyProof(..., uint[2] calldata _pubSignals)`. `ZKCapabilityGate` calls with `uint[2]`, while its generated verifier expects `uint[3]`.
- Why it matters: This is not a theoretical edge case. It means the ABI selector for the call does not match the deployed verifier signature, so the ZK verification path is effectively unusable as written. That directly contradicts the apparent completeness of the ZK extension surface and leaves a hidden launch failure for any integrator attempting to use privacy proofs.
- Recommendation: Regenerate or wrap verifiers so the contract ABI exactly matches the intended public statement. Then add end-to-end tests that prove: (1) valid proof succeeds, (2) wrong public signal ordering fails, (3) wrong threshold/root semantics fail, and (4) SDK/CLI/docs all use the same signal ordering and statement definition.

### C-02
- ID: C-02
- Severity: MEDIUM
- Launch Severity: PILOT-OK
- Category: operator
- Surface / file: `products/arc-402/cli/README.md`, `products/arc-402/cli/dist/commands/deliver.js`, `contracts/ServiceAgreement.sol`
- Issue: The CLI README says `arc402 deliver <id> --output ...` lets the provider “Deliver and Claim Payment”, but the default implementation does **not** claim payment. The command calls `commitDeliverable()` unless `--fulfill` is explicitly passed, which moves the agreement into `PENDING_VERIFICATION` and still requires client verification or later `autoRelease()`.
- Why it matters: This is exactly the kind of operator-facing mismatch that causes real disputes. A provider following the README can believe escrow was released when it was only committed for verification. That is misleading behavior at the user boundary, not just wording drift.
- Recommendation: Fix the README and command help text to distinguish the two paths explicitly: `commit`/verification-window path vs immediate `fulfill` path. Consider splitting the command into separate verbs or requiring an explicit mode flag so the payment semantics are impossible to misread.

### C-03
- ID: C-03
- Severity: MEDIUM
- Launch Severity: PILOT-OK
- Category: docs
- Surface / file: `docs/operator-standard/remediation-and-dispute.md`, `systems/arc402-skill/SKILL.md`, `contracts/ServiceAgreement.sol`, `products/arc-402/cli/dist/commands/dispute.js`
- Issue: The doctrine layer presents remediation as the standard prerequisite before formal dispute, but the protocol surface still permits direct dispute much more broadly than the prose suggests. `ServiceAgreement.dispute()` can be opened directly from normal working statuses without prior remediation, and the CLI's default dispute path uses that direct call unless `--escalated` is supplied.
- Why it matters: This creates a false sense of enforcement. Careful operators reading the docs may assume the system itself enforces “remediation before dispute,” while a less careful integrator can bypass it using the default CLI path. That mismatch matters because dispute frequency, evidence quality, and trust/reputation consequences are central protocol assumptions.
- Recommendation: Either tighten the contract/CLI to make remediation the default enforced path, or downgrade the doctrine language so it is clearly advisory rather than protocol-enforced. At minimum, make the CLI default to escalation-after-remediation and force an explicit `--direct` flag for immediate disputes.

### C-04
- ID: C-04
- Severity: MEDIUM
- Launch Severity: PILOT-OK
- Category: sdk
- Surface / file: `products/arc-402/python-sdk/arc402/agreement.py`
- Issue: `ServiceAgreementClient._to_bytes32()` silently right-pads short inputs and truncates long inputs (`[:32]`) instead of validating exact `bytes32` length. This affects deliverable hashes, transcript links, feedback hashes, response hashes, and evidence hashes.
- Why it matters: Silent truncation is dangerous in a protocol that relies on exact hash identity for evidence and transcript chaining. An oversized hex string or raw byte payload will not fail fast; it will be mutated into a different on-chain value. That creates hard-to-debug evidence mismatches and can quietly break remediation/dispute chains.
- Recommendation: Reject any non-empty input that is not exactly 32 bytes / 64 hex chars after `0x` normalization. Add tests for short, exact, oversized, malformed-hex, and raw-bytes inputs. This should fail loudly, not autocorrect.

### C-05
- ID: C-05
- Severity: LOW
- Launch Severity: PILOT-OK
- Category: docs
- Surface / file: `reference/README.md`, test suite, ZK contracts, SDK/CLI test surfaces
- Issue: The top-level status story overstates reconciliation completeness. The README says “242 tests. 0 failures” and “All code findings resolved,” but the current suite actually lists 271 Foundry tests, and there is still no visible test coverage for the ZK gates/verifiers or realistic CLI/Python integration against deployed contract behavior.
- Why it matters: The problem is not the exact test count. The problem is that the documentation signals a tighter audit closure than the exercised surfaces justify. A careful reader could reasonably infer that the privacy extensions and operator layers were included in that confidence level when they were not meaningfully regression-tested.
- Recommendation: Update the README to describe coverage honestly by surface. Separate “core contracts covered” from “draft/unverified extensions” and explicitly call out untested or lightly tested modules such as ZK gates and operator SDK/CLI integration.

### C-06
- ID: C-06
- Severity: LOW
- Launch Severity: MAINNET-LATER
- Category: operator
- Surface / file: `contracts/IServiceAgreement.sol`, `contracts/ServiceAgreement.sol`, operator docs
- Issue: `ESCALATED_TO_ARBITRATION` is exposed as a formal agreement status and the docs reference arbitration/escalation outcomes, but the implementation never appears to set `ag.status = Status.ESCALATED_TO_ARBITRATION`. The practical flow is `DISPUTED` or `ESCALATED_TO_HUMAN`, followed by resolution.
- Why it matters: Integrators indexing status enums will assume this is a reachable lifecycle state. It is a subtle completeness bug: the enum suggests a richer state machine than the contract actually implements.
- Recommendation: Either implement the arbitration status transition explicitly or remove/deprecate it from the public status surface until it is real. Add a state-machine test that proves every exposed enum state is either reachable or intentionally reserved.

## Coverage Gaps

- No meaningful on-chain tests were found for `ZKTrustGate`, `ZKSolvencyGate`, `ZKCapabilityGate`, or the generated verifier integration path.
- No regression tests were found for verifier public-signal ordering / statement binding, which is the core correctness risk in the ZK layer.
- Python SDK tests are mostly mocked unit tests; they do not validate ABI compatibility or real transaction parameter ordering against deployed contracts.
- CLI behavior appears largely untested as an operator workflow surface; the highest-risk issue found there was a docs/behavior semantic mismatch rather than a compile error.
- The operator doctrine is well-written, but the audit surface would benefit from explicit “advisory vs enforced” labeling for each rule.

## Verdict

**Safe for closed pilot only, and only for the non-ZK path after operator-surface corrections.**

The core contracts are much closer to launch shape than the peripheral surfaces imply, but the current package is not fully reconciled. The ZK extension is not operational as written and should be treated as a blocked draft surface. The CLI/docs/skill layer also needs sharper honesty about what is enforced vs merely recommended. Until those are fixed and regression-tested, the system is not ready to present itself as fully audit-closed or public-launch-ready.