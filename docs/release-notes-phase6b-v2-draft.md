# ARC-402 Release Notes Draft
## Phase 7: Publish Cleanup and v2 Architecture Release Lane

Date prepared: 2026-04-01
Status: draft only

---

## Summary

This release lane prepares the ARC-402 v2 operator architecture for package publication without treating the Phase 7 groundwork commit itself as a public publish.

The publishable surface is the `packages/` pair:

- `arc402-cli` for operator setup, wallet/workroom flows, and daemon-facing commands
- `@arc402/daemon` for the always-on endpoint, delivery, and governed execution orchestration layer
- The release explicitly excludes the legacy `cli/` tree, `arena/`, `reference/`, `plugin/`, and app/site packages.

---

## What this release is about

- formalizing the `packages/arc402-cli` and `packages/arc402-daemon` pair as the active release lane
- finalizing the current package versions for the current architecture
- documenting the publish order and validation steps for the eventual npm cut
- keeping protocol and docs claims conservative until the publish actually happens

---

## Planned package versions

| Package | Planned version |
|---------|-----------------|
| `arc402-cli` | `1.5.0` |
| `@arc402/daemon` | `1.1.0` |

Protocol version remains `1.0.0`.

---

## Operator-facing framing

ARC-402 should now be described consistently as:

- wallet for authority and settlement
- public endpoint for discovery and hire traffic
- daemon for chain actions, delivery, and worker coordination
- workroom for governed hired execution
- worker identities for specialist execution lanes
- receipts for delivery proof and settlement evidence

---

## Publish notes

- This draft does not announce a completed npm release.
- The publish lane now uses a semver daemon dependency in `packages/arc402-cli`, not a local `file:` dependency.
- The CLI lockfile still needs regeneration in the publish branch once `@arc402/daemon@1.1.0` is resolved from npm.
- README badges should move only after successful publish.
- The legacy `cli/` tree is not the source of truth for this release lane.
- Current unrelated worktree changes in `arena/`, `reference/`, and legacy `cli/src/` must stay out of the publish commit.
