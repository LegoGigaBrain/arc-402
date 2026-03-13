# ARC-402 TS SDK + CLI v0.2 Summary

## Scope completed

Aligned the TypeScript SDK and CLI to the current ARC-402 protocol direction described in Spec 14/15/16/17 and the 2026-03-11 engineering brief.

## SDK changes

- Bumped `@arc402/sdk` from `0.1.0` to `0.2.0`.
- Reworked the SDK as the typed ecosystem surface.
- Expanded shared types to cover:
  - remediation states and transcript-linked records
  - formal dispute records and evidence
  - reputation signals and summaries
  - sponsorship attestations and identity tiers
  - capability taxonomy roots and claims
  - governance multisig transactions
  - negotiation message payloads
  - operational trust / heartbeat metrics
- Updated ABIs and clients for:
  - `AgentRegistry`
  - `ServiceAgreement`
  - `ReputationOracle`
  - `SponsorshipAttestation`
  - `CapabilityRegistry`
  - `ARC402Governance`
- Added negotiation helper builders for Spec 14 payload generation.
- Updated README examples to reflect discovery → negotiate → hire → remediate/dispute workflows.
- Added light coverage for negotiation helpers and workflow enums.

## CLI changes

- Bumped `arc402-cli` from `0.1.0` to `0.2.0`.
- Added local dependency on `@arc402/sdk` so CLI and SDK share schemas/types.
- Reframed CLI around the actual protocol workflow:
  - `discover`
  - `negotiate` (explicitly payload-generation/scaffold only)
  - `hire`
  - `accept`
  - `deliver`
  - `remediate request/respond/status`
  - `dispute open/evidence/status/resolve`
  - `agreements` / `agreement`
- Expanded agent operations to include heartbeat submission and heartbeat policy updates.
- Expanded trust output to include sponsorship and reputation when configured.
- Expanded config to optionally store addresses for newer modules:
  - reputation oracle
  - sponsorship attestation
  - capability registry
  - governance
- Added light CLI test coverage for duration parsing.

## Build verification

### SDK
- `cd products/arc-402/reference/sdk && npm run build && npm test`
- Result: pass

### CLI
- `cd products/arc-402/cli && npm install && npm run build && npm test`
- Result: pass

## Important notes

- Negotiation transport is still intentionally out of scope. The CLI `negotiate` commands only generate Spec 14 payloads and are labeled as scaffolding/payload helpers rather than pretending to send messages.
- Some newer contracts may not yet be deployed on a given network. SDK/CLI support is present, but config must point at live addresses where available.
