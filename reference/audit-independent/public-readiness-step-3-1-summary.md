# Step 3.1 — Settlement lifecycle unification summary

## What changed

Implemented the Step 1.1 / public-readiness cut for `ServiceAgreement` so the public launch path is no longer the weak immediate-release shortcut.

### Contract
- Kept `fulfill()` in the ABI for compatibility, but gated it behind explicit legacy controls:
  - `legacyFulfillEnabled` (default `false`)
  - `legacyFulfillProviders[address]` allowlist
  - `setLegacyFulfillMode(bool)`
  - `setLegacyFulfillProvider(address,bool)`
- Public/default lifecycle is now coherently centered on:
  - `propose -> accept -> commitDeliverable -> verifyDeliverable / autoRelease`
  - with remediation and dispute escalation around that path.
- `fulfill()` now reverts unless the owner explicitly opts into legacy mode **and** the provider is explicitly trusted.

### Tests
- Updated ServiceAgreement suites to account for the new legacy gate.
- Added regression coverage that a fresh deployment rejects `fulfill()` by default.
- Preserved compatibility coverage by testing that `fulfill()` still works only when legacy mode is explicitly enabled for a trusted provider.
- Full Foundry suite passes: `273 passed, 0 failed`.

### SDK / docs
- Updated `sdk/src/agreement.ts` to mark `fulfill()` deprecated and added `fulfillLegacyTrustedOnly()` alias.
- Updated `sdk/README.md` and root `README.md` to describe the public lifecycle honestly and label `fulfill()` as legacy/trusted-only.
- Updated interface comments in `IServiceAgreement.sol` and trust interface wording in `ITrustRegistry.sol`.

## Integrity outcome

This removes the misleading public parallel settlement path without breaking ABI compatibility.

Public integrators now have one truthful path to follow.
Legacy immediate release remains available only as an explicit operator choice for trusted/backward-compatibility scenarios.

## Validation

- `forge test` ✅
- `cd sdk && npm run build` ✅
