# Changelog

## [0.5.6] — 2026-04-02

### Changed
- Reframed the Python SDK around the current ARC-402 operator architecture: governed wallet + node endpoint + daemon delivery + workroom execution.
- Added `ARC402Node` as an operator-facing alias of `ARC402Wallet` to match the node mental model used in the CLI and docs.
- Updated package metadata and repository URLs to the public `ARC-402/arc402` org.
- Expanded README guidance so Python integrators can map SDK surfaces to the live node/daemon/workroom stack.

## [0.5.4] — 2026-03-27 (patch)

### Changed
- PyPI classifier updated from `Alpha` to `Production/Stable` — protocol is live on Base mainnet with fulfilled agreements.

## [0.5.4] — 2026-03-25

### Synced
- Version sync with CLI `1.4.33` release train.
- Compatibility check against latest ARC-402 agreement/endpoint lifecycle.
- No breaking Python SDK API changes.

## [0.1.0] — 2026-03-10

Initial release of the ARC-402 Python SDK.

### Added
- `ARC402Wallet` — main entry point with `context()`, `spend()`, `set_policy()`, `trust_score()`, `attestations()`
- `PolicyClient` — set and validate category spend limits
- `TrustClient` — query and update trust scores
- `IntentAttestation` — create and verify on-chain intent attestations
- `MultiAgentSettlement` — propose, accept, reject, and execute agent-to-agent settlements
- `ContextBinding` — async context manager for task-scoped spending
- Full Pydantic models: `TrustScore`, `AttestationRecord`, `PolicyConfig`, `ProposalStatus`
- Exception hierarchy: `ARC402Error`, `PolicyViolation`, `TrustInsufficient`, `ContextAlreadyOpen`, `ContextNotOpen`, `TransactionFailed`, `AttestationNotFound`
- Base Sepolia network support with canonical contract addresses
- Examples: insurance claims agent, research agent, multi-agent settlement
