# ARC-402 Phase 7 Publish Cleanup and Release Scope Finalization
*Status: Release scope finalized; publish blocked only by unrelated local worktree changes*
*Owner: Engineering*
*Date: 2026-04-01*

---

## Purpose

This document defines the final Phase 7 release lane for the current v2 architecture without claiming that a public publish has already happened.

The goal is to leave the repo publish-ready, or as close as possible without publishing:

- identify the package manifests that actually belong to the release lane
- lock the final in-scope versions already present in the release lane
- record the publish order and validation steps
- prevent accidental publishes from legacy, arena, or reference trees

---

## Release lane truth

The current v2 operator architecture in this repository is the paired package surface under `packages/`:

| Package | Path | Role | Final in-scope version |
|---------|------|------|-----------------|
| `arc402-cli` | `packages/arc402-cli/package.json` | operator CLI, workroom entrypoint, daemon-facing control surface | `1.5.0` |
| `@arc402/daemon` | `packages/arc402-daemon/package.json` | always-on daemon for endpoint, delivery, worker routing, and signer/api split | `1.1.0` |

### Not in this release lane

These trees were reviewed and are intentionally not treated as the publish source of truth for this cut:

| Path | Why it is held |
|------|----------------|
| `cli/package.json` | legacy package tree; version trails `packages/arc402-cli` (`1.4.50` vs `1.5.0`) and would create split-brain publishes |
| `reference/` | reference material and active local SDK work, not active product publish surface |
| `arena/` | active arena work is present in the tree but not part of the operator package release lane |
| `python-sdk/` | separate SDK lane with no Phase 6B changes prepared here |
| app/site packages (`web`, `landing`, `arena`, `plugin`, etc.) | not part of the operator package release lane requested for this phase |

---

## Version decisions

### Final package versions in scope

| Package | Final version | Reason |
|---------|---------------|--------|
| `arc402-cli` | `1.5.0` | marks the v2 architecture lane centered on workroom + daemon packaging |
| `@arc402/daemon` | `1.1.0` | marks the standalone daemon package as a first-class public release surface |

### Versions intentionally unchanged

- Protocol version remains `1.0.0` per `spec/20-protocol-versioning.md`.
- README badges remain as-is until packages are actually published.
- Legacy `cli/package.json` is not bumped in Phase 6B.
- `@arc402/sdk` remains `0.6.5` in `reference/sdk/package.json` and is excluded from this publish cut.
- `@arc402/arc402` remains `1.3.5` in `plugin/package.json` and is excluded from this publish cut.

---

## Architecture truth to communicate in release notes

The release narrative for this cut should match the repository as it exists now:

- ARC-402 is operated as a node made of wallet, public endpoint, daemon, workroom, worker identities, and receipts.
- The daemon is a standalone package and not just an implementation detail hidden inside the CLI tree.
- The workroom is the governed hired-work lane of the node, not a generic sandbox.
- The public publish lane is the `packages/` pair, not the legacy `cli/` tree.
- Arena and reference changes currently in the working tree are explicitly out of publish scope for this cut.

---

## Publish checklist

Use this list when the actual release candidate is cut.

1. Validate package metadata:
   - `packages/arc402-cli/package.json`
   - `packages/arc402-daemon/package.json`
   - matching `package-lock.json` files
2. Build both packages:
   - `cd packages/arc402-daemon && npm run build`
   - `cd packages/arc402-cli && npm run build`
3. Run CLI tests:
   - `cd packages/arc402-cli && npm test`
4. Verify the CLI tarball contains `dist/` and `workroom/`.
5. Dry-run pack both packages before any publish.
6. Confirm `packages/arc402-cli` depends on `@arc402/daemon` by semver, not a local `file:` path.
7. Confirm the daemon package is published before the CLI package.
8. Update README badges and any npm install examples only after publish succeeds.
9. Tag the release from the publish commit, not from this groundwork commit.

---

## Current worktree findings

- Tracked out-of-scope modifications are present in `arena/contracts/StatusRegistry.sol`, `arena/scripts/e2e-test.ts`, `cli/src/commands/chat.ts`, `cli/src/commerce-client.ts`, `cli/src/config.ts`, and `cli/src/daemon/index.ts`.
- Untracked out-of-scope work is present in `reference/`.
- `internal-specs/` is now ignored locally so private planning notes do not get swept into the publish lane by accident.
- Those changes should not be included in the publish commit for this release lane.
- Because those changes already exist locally, the repository cannot be left fully clean by this pass without discarding work that is outside Phase 7 scope.

## Remaining publish blockers

- The repo still contains a legacy `cli/` package tree. Release execution must avoid using it as the package source of truth.
- `packages/arc402-cli/package-lock.json` still reflects the historical local-link install and must be regenerated in a network-enabled publish branch after resolving `@arc402/daemon@1.1.0` from npm.
- The working tree still contains unrelated local changes outside the package release lane; publish should proceed only from a clean branch or a release-only commit selection.

---

## Expected outputs from the actual publish cut

- npm publish of `@arc402/daemon@1.1.0`
- npm publish of `arc402-cli@1.5.0`
- README badge and install examples updated to the published versions
- release notes finalized from `docs/release-notes-phase6b-v2-draft.md`
