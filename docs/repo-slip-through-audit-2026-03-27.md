# Repo Slip-Through Audit — 2026-03-27

*Generated during pre-launch hygiene session. Documents all files that were tracked in the public repo despite being covered by `.gitignore` rules.*

---

## Context

The 5-day public window was activated in late March 2026 based on launch readiness (second agent hire queued as next milestone). The repo was briefly made public, then immediately set back to private when Lego spotted IP/clutter in the tracked surface.

Hygiene Phase 1 (commit `6051fb2`) and Phase 2 (commit `e9b2b70`) had already run, but 6 files still slipped through. This doc records them for operational memory.

---

## Files That Slipped Through

| File | Category | Root Cause | Disposition |
|------|----------|------------|-------------|
| `crytic-export/combined_solc.json` | Audit toolchain artifact | `crytic-export/` not in `.gitignore` | Untracked `955192f` |
| `echidna-sweep.yaml` | Internal fuzzer config | `echidna*.yaml` not explicitly ignored | Untracked `955192f` |
| `echidna.yaml` | Internal fuzzer config | Same as above | Untracked `955192f` |
| `medusa.json` | Internal fuzzer config | `medusa.json` not in `.gitignore` | Untracked `955192f` |
| `products/arc402/ARC-ARENA-SPEC.md` | Internal spec (wrong surface) | `products/arc402/` not in `.gitignore` | Untracked `955192f` |
| `skills/arc402-agent/SKILL.md` | ARC-402 OpenClaw skill — already published to ClawHub at v1.3.4. Untracked from repo surface; canonical home is ClawHub, not GitHub. | `skills/` directory not in `.gitignore` | Untracked `955192f` |

---

## Root Cause Pattern

1. **Created-after-ignore:** Files were created after `.gitignore` rules were written. A later `git add -A` or force-add pulled them into tracking silently.
2. **Insufficiently broad rules:** Some parent directories (e.g. `skills/`, `crytic-export/`, `products/arc402/`) weren't covered even though their contents are clearly internal/tooling.
3. **No allowlist enforcement:** `.gitignore` is a blocklist by default. Public surface needs to be an explicit allowlist to be safe.

---

## Fix Applied (commit `955192f`)

- `git rm --cached` for all 6 files (local copies preserved)
- `.gitignore` extended with:
  ```
  crytic-export/
  echidna*.yaml
  medusa.json
  products/arc402/
  skills/
  ```
- Pre-commit hook + CI workflow now verify no tracked-but-ignored files on every commit

---

## Guardrails Now Active

| Mechanism | What it catches |
|-----------|----------------|
| `scripts/repo-hygiene-check.sh` | Tracked-but-ignored files + forbidden path patterns |
| `.githooks/pre-commit` | Runs hygiene check before every local commit |
| `.github/workflows/repo-hygiene.yml` | Runs hygiene check on every push/PR |

---

## Policy Reminders

- Public surface is defined by: `docs/public-repo-manifest.md`
- Any new file outside that manifest must be added to `.gitignore` **before** first `git add`
- Do NOT publish `skills/arc402-agent/SKILL.md` to ClawHub before full launch
- Pre-commit hook must be installed on every new dev machine: `bash scripts/install-githooks.sh`

---

*Owner: Engineering (Forge)*
*Linked: `docs/repo-public-surface.md`, `docs/public-repo-manifest.md`, `docs/public-flip-readiness-checklist.md`*
