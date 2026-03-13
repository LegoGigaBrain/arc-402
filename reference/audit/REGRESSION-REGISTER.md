# ARC-402 Regression Register

_Last updated: 2026-03-11 (RC-C surface integrity pass)_

This register tracks the major blocker -> fix -> test mappings relevant to the release-candidate sealing audit. It is intentionally conservative: if a fix is only partial, or if the public surface is still slightly ahead of implementation, that is called out explicitly.

## Summary posture

- **Closed-pilot posture:** supported by current docs and current implementation direction.
- **Open-public posture:** still not honest to claim as complete.
- **Main remaining surface concern:** the CLI README had drifted slightly ahead of implementation by describing layered dispute authority as if it were already the live default; this has now been corrected.

## Register

| ID | Prior blocker | Fix implemented | Test coverage / verification location | Remaining concern |
|---|---|---|---|---|
| RC-C-01 | `WalletFactory` created wallets owned by the factory, effectively bricking factory-deployed wallets (reconciled finding F-01). | Wallet constructor/factory path revised so deployed wallets use the intended owner/registry flow instead of trapping ownership in the factory. | `reference/AUDIT-RECONCILIATION-2026-03-11.md` cites `test_walletUsesNewRegistry`, `test_setRegistry_works`, `test_fullFlow_openExecuteClose`; current suite status in `reference/AUDIT-REPORT-2026-03-11-v2.md`. | No surface drift found on this point in reviewed public docs. |
| RC-C-02 | Wallet attestation path was mismatched/replay-prone, so the spend-security story was materially overstated (F-02/F-03 cluster). | Attestation creation/consumption flow was repaired so context close + attestation validation align with actual parameters and intended usage. | `reference/AUDIT-RECONCILIATION-2026-03-11.md` cites `test_closeContext()`, `test_fullFlow_openExecuteClose()`, `test_Wallet_Attest_CreatesValidAttestation()`. | Attestation expiry is still open as a known limitation (F-18). Docs should continue treating attestations as bounded current primitives, not perfect long-lived guarantees. |
| RC-C-03 | `ServiceAgreement` escrow release path had a reentrancy / ordering concern (H-01 / F-08 cluster), which weakened settlement safety claims. | `ReentrancyGuard` added; state-transition functions protected; events moved before external escrow release. | `reference/AUDIT-REPORT-2026-03-11-v2.md` H-01 resolution; attack coverage in `reference/test/ServiceAgreement.attack.t.sol`, `reference/test/ServiceAgreement.economic.t.sol`, `reference/test/ServiceAgreement.v2.t.sol`. | Residual static-analysis flag remains documented as a reviewed false positive; acceptable only with the current guarded implementation. |
| RC-C-04 | Missing zero-address validation in registry/factory paths (M-01 / F-15) made core infra redirection mistakes possible. | Explicit zero-address checks added to `ARC402Registry` constructor/update and `WalletFactory` constructor. | `reference/AUDIT-REPORT-2026-03-11-v2.md` M-01 resolution; code references there point to validated lines. | `ARC402Registry.update()` still lacks strong test depth/timelock posture; see RC-C-10 and RC-C-11. |
| RC-C-05 | Events were emitted after external calls in ServiceAgreement transitions (M-02 / F-16), weakening CEI clarity and auditability. | Event emission order moved ahead of `_releaseEscrow()` paths. | `reference/AUDIT-REPORT-2026-03-11-v2.md` M-02 resolution; function-by-function verification listed there. | No current surface overclaim found after doc review. |
| RC-C-06 | `X402Interceptor` had zero meaningful test coverage (M-03 / F-17), so its payment-gateway surface was ahead of verification. | Dedicated test suite added; coverage lifted from 0% to 100%. | `reference/AUDIT-REPORT-2026-03-11-v2.md` M-03 resolution; tests in `reference/test/X402Interceptor.t.sol`. | Public surfaces should still frame CLI/SDK flows as controlled/pilot-friendly, not as production-proof in themselves. |
| RC-C-07 | Token allowlist absence allowed unsafe token routing in service agreements (F-09). | `allowedTokens` gating added to supported settlement path. | `reference/AUDIT-RECONCILIATION-2026-03-11.md` lists `test_Attack4_MaliciousERC20_FundsLocked_Mitigated`. | Surface review found no overclaim here, but network deployment/address availability still varies by environment. |
| RC-C-08 | Trust farming / weak trust-updater coupling could make reputation/trust wording too strong (F-10 plus public-readiness trust gap). | Trust update authority constrained so `ServiceAgreement` is the sole authorized updater for the core path; docs demoted heartbeat/reputation/sponsorship language to secondary/informational status. | `reference/AUDIT-RECONCILIATION-2026-03-11.md` lists `test_Attack6_TrustScoreFarming`; wording checks in `README.md`, `python-sdk/README.md`, `reference/sdk/README.md`, `systems/arc402-skill/SKILL.md`. | Still not a public-market truth oracle. Heartbeat/ops trust, sponsorship, and reputation remain soft/informational signals and must stay described that way. |
| RC-C-09 | `proposeMASSettlement` was disconnected from the actual coordinator path (F-11), weakening multi-agent settlement claims. | Wallet path updated to call the settlement coordinator as intended. | `reference/AUDIT-RECONCILIATION-2026-03-11.md` lists `test_proposeMASSettlement_CallsCoordinator`. | SettlementCoordinator still carries open auth / spam concerns (F-13, F-19, F-26). Keep claims narrow. |
| RC-C-10 | Registry update path still lacks timelock protection (F-12), so upgrade/governance safety story is incomplete. | Partial fix only: zero-address validation added; no timelock implemented. | Open item documented in `reference/AUDIT-RECONCILIATION-2026-03-11.md`; low coverage reminder in `reference/AUDIT-REPORT-2026-03-11-v2.md`. | This remains a live caveat. Governance/migration wording must not imply fully hardened upgrade safety. |
| RC-C-11 | Dispute resolution authority remains too centralized for full public-legitimacy claims (F-06 / F-14 and public-readiness gap). | Recent surfaces were narrowed to say current dispute authority is deployment-defined / owner-administered rather than inherently decentralized. CLI README wording corrected in this RC-C pass. | Contract reality in `reference/contracts/ServiceAgreement.sol` (`resolveDispute*` owner-gated); public gap documented in `reference/PUBLIC-READINESS-GAP.md`; doctrine caveats in `docs/operator/README.md`, `docs/operator-standard/README.md`. | Still the main honesty boundary: remediation-first workflow exists, but institutional dispute legitimacy is not yet fully embodied on-chain for open-public claims. |
| RC-C-12 | Public surfaces risked overstating ZK/privacy readiness. | Launch-scope notes now consistently quarantine experimental ZK/privacy work from default launch/public path. | Verified in `README.md`, `python-sdk/README.md`, `reference/sdk/README.md`, `cli/README.md`. | Honest as long as ZK stays explicitly out of launch scope until redesign/re-audit. |
| RC-C-13 | CLI/help/docs semantic drift risk: CLI README could imply stronger guarantees than the actual CLI/contract path. | README now aligns more closely with current CLI help and current contract reality; command surface reviewed against `node dist/index.js --help`. | CLI help snapshot from `products/arc-402/cli/dist/index.js --help`; README sections in `cli/README.md`. | CLI help itself is directionally careful, but some command descriptions still reflect doctrine-level workflow more than strict on-chain enforcement. Acceptable for pilot use; keep under watch for public launch. |

## Review notes by surface

### README
- Honest overall.
- Correctly states **DRAFT** status.
- Correctly narrows trust wording and launch scope.
- Correctly says public path is about governed wallets/discovery/escrow/remediation/dispute/reputation, not ZK.

### Specs / public readiness references
- `reference/PUBLIC-READINESS-GAP.md` and `reference/PUBLIC-LAUNCH-REMEDIATION-PLAN.md` remain appropriately conservative.
- These documents still say open public launch is **not ready**, which is the honest posture.

### Operator docs / operator standard
- `docs/operator/README.md` and `docs/operator-standard/README.md` are honest.
- Both explicitly warn that doctrine/operator standard should not be mistaken for proof that public-ready dispute legitimacy is already solved.

### OpenClaw skill
- `systems/arc402-skill/SKILL.md` is honest.
- It correctly frames ARC-402 as **closed-pilot operator infrastructure** and tells operators not to overstate trust/dispute maturity.

### Python SDK README
- Honest overall.
- Secondary-signal wording is appropriately softened.
- Current dispute authority is explicitly described as deployment-defined / owner-administered.

### TypeScript SDK README
- Honest overall.
- Correctly says current dispute outcomes still depend on deployment authority design.
- Correctly excludes ZK/privacy from launch-path SDK scope.

### CLI README / help
- **One correction made in this RC-C pass:** the README had said layered dispute authority was already the current default; that was slightly ahead of contract reality.
- After correction, the CLI surface is materially more honest.
- CLI help is broadly aligned with the intended doctrine and current pilot posture.

## Audit use

Use this register together with:
- `reference/AUDIT-RECONCILIATION-2026-03-11.md`
- `reference/AUDIT-REPORT-2026-03-11-v2.md`
- `reference/PUBLIC-READINESS-GAP.md`
- `reference/audit-independent/release-candidate-rc-c-summary.md`

The sealing conclusion from this register is:

> **No reviewed public surface currently overstates ARC-402 as open-public ready, but one CLI README paragraph had been slightly ahead of implementation on dispute authority and has now been corrected. The remaining honesty boundary is unchanged: ARC-402 is suitable to describe as closed-pilot / controlled-deployment infrastructure, not as fully public-legitimacy-complete escrow and dispute infrastructure.**
