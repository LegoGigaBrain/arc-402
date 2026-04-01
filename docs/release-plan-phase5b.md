# ARC-402 Phase 5B Release Plan
*Status: Active groundwork*
*Owner: Engineering*
*Date: 2026-04-01*

---

## Purpose

This document captures the docs/release lane for Phase 5B:

- prepare the README v2 shape
- tighten the public security story
- improve workroom/node framing
- expand launch scenarios
- define the next version bump matrix
- record what this docs-only groundwork does and does not publish yet

This is intentionally a release-planning artifact, not a package publish announcement.

---

## What Phase 5B changes

### Public docs lane

1. README rewritten around node -> daemon -> workroom -> worker -> receipt framing.
2. Security language tightened to describe wallet, runtime, and delivery controls as separate layers.
3. Workroom docs reframed as the governed hired-work lane of a node rather than a generic sandbox explainer.
4. Scenario coverage expanded to include solo, agency, client/provider, internal ops, compute, subscription, and arena cases.

### What this lane does not do

1. No contract changes.
2. No runtime behavior changes.
3. No package version changes inside this commit.
4. No public comparison framing against external products.

---

## README v2 structure now prepared

The README is now organized around these operator questions:

1. What is ARC-402?
2. What does an ARC-402 node include?
3. Which setup path should I choose?
4. How does the system actually work?
5. What is the workroom in relation to the node?
6. How is the system secured?
7. Which agreement surfaces and scenarios are supported?
8. What versions and deployed addresses are current?

This structure is the basis for the next release-note and website-copy pass.

---

## Version bump matrix

Current repo versions as of 2026-04-01:

| Surface | Current | Change class in this lane | Recommended next release action |
|---------|---------|---------------------------|---------------------------------|
| Protocol docs | `1.0.0` protocol framing | docs-only | no protocol bump |
| CLI | `1.4.50` | docs/reference clarification only | hold at `1.4.50` unless a CLI behavior change lands |
| OpenClaw plugin | `1.3.5` | no code change | hold at `1.3.5` |
| TypeScript SDK | `0.6.5` | no code change | hold at `0.6.5` |
| Python SDK | `0.5.5` | no code change | hold at `0.5.5` |
| Website/app package | `1.0.0` | no code change in this lane | hold at `1.0.0` |

### Release rule

If Phase 5C stays docs-only, keep package versions unchanged and publish this as repository/docs polish. If any package-facing copy, examples, or command behavior changes are bundled into a release artifact later, bump only the affected package at that time.

---

## Release notes draft

### Title

`Phase 5B: README v2 and release-lane groundwork`

### Summary

- README now frames ARC-402 as a node with wallet, endpoint, daemon, workroom, workers, and receipts.
- Security documentation now explains key authority, runtime isolation, task-boundary hard stops, and delivery integrity in one pass.
- Workroom docs now explain the governed hired-work lane more directly for first-time operators.
- Scenario coverage now reflects launch-scope operator patterns instead of only the simplest hire flow.
- Release planning now has an explicit version matrix and docs-only release rule.

### Audience impact

- **New operators** get a cleaner mental model faster.
- **Reviewers/auditors** get a clearer security and receipt story.
- **Release owners** get an explicit rule for when package versions should actually move.

---

## Follow-on work after Phase 5B

1. Align website/app copy with the README v2 node/workroom framing.
2. Fold the scenario list into launch/readiness docs where the onboarding path needs more concrete examples.
3. Decide whether future docs-only polish should be tagged separately or rolled into the next runtime/package release.
4. Update release notes again when endpoint CLI or policy UX changes create a real package bump.

---

## Notes

- Requested source `memory/2026-04-01.md` was not present in the repository on 2026-04-01. This lane was grounded instead in `README.md`, `ENGINEERING-STATE.md`, `internal-specs/46-universal-commerce-harness.md`, `spec/20-protocol-versioning.md`, and the launch/readiness docs present in `docs/`.
