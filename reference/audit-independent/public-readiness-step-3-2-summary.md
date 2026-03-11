# ARC-402 Public Readiness — Step 3.2 Summary

## What changed
- Enforced **remediation-first** for normal disputes at the contract level: `dispute()` now requires remediation eligibility instead of acting as an unrestricted direct-dispute entrypoint.
- Added explicit **direct-dispute exceptions** via `DirectDisputeReason` + `directDispute(...)` for:
  - no delivery / hard non-delivery
  - hard deadline breach
  - clearly invalid or fraudulent deliverable
  - safety-critical violation
- Added `canDirectDispute(...)` so SDK/CLI/skill flows can preflight the narrow hard-fail path.
- Kept `escalateToDispute(...)` as the remediation-driven formal escalation path.

## Contract semantics
- `dispute(...)` / `escalateToDispute(...)` now enforce the remediation-first policy.
- `directDispute(...)` is only allowed when the enumerated hard-fail condition is actually satisfied on-chain.
- Added `DirectDisputeOpened` event for clear auditability of exception-based disputes.

## Surface alignment
- Updated the reference TS SDK with `DirectDisputeReason`, `directDispute(...)`, and `canDirectDispute(...)`.
- Updated the Python SDK with matching enum/method support and ABI entries.
- Updated CLI dispute flow to support `--direct no-delivery|deadline-breach|invalid-deliverable|safety-critical` while preserving `--escalated` for post-remediation escalation.
- Updated docs/skill guidance to describe remediation as the default and direct dispute as a narrow exception path.

## Tests added/updated
- Verified normal dispute attempts revert with `ServiceAgreement: remediation first`.
- Verified formal escalation works after remediation starts.
- Verified direct dispute is allowed for:
  - no delivery after deadline
  - hard deadline breach
  - invalid/fraudulent deliverable during verification
  - safety-critical violation
- Verified direct dispute reverts when a claimed hard-fail condition is not actually met.

## Verification run
- `forge test --match-path test/ServiceAgreement.v2.t.sol -q` ✅
- `cd reference/sdk && npm test && npm run build` ✅
- `cd cli && npm run build` ✅
- `cd python-sdk && python3 -m compileall arc402` ✅
- Python `pytest` could not run cleanly in this host environment due an installed `pytest_asyncio` / `pytest` version mismatch (`ImportError: cannot import name 'FixtureDef' from 'pytest'`). Import/compile checks for the touched Python SDK modules passed.

## Notes
- The repo already contained unrelated in-progress changes outside Step 3.2. I kept the implementation scoped to the remediation/dispute surfaces listed above.
