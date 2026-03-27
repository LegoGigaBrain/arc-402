# ARC-402 Public Flip Readiness Checklist (Go / No-Go)

Use this checklist before switching GitHub visibility from private → public.

## 1) Hygiene gate passes
- [ ] `bash scripts/repo-hygiene-check.sh` returns PASSED
- [ ] `git ls-files -ci --exclude-standard` returns 0 files

## 2) Working tree is intentional
- [ ] `git status` clean or only expected release files
- [ ] no accidental force-adds of ignored paths

## 3) Public surface matches policy
- [ ] Matches `docs/public-repo-manifest.md`
- [ ] No internal process docs tracked at root
- [ ] No private specs/audits/reports tracked

## 4) Secrets and local context scrubbed
- [ ] no keys/tokens in tracked files
- [ ] no walletconnect sessions / env dumps / private endpoints
- [ ] no personal/operational memory files tracked

## 5) Runtime artifacts absent
- [ ] no tracked `broadcast/`, `cache/`, `.wake/`, `deliverables/`
- [ ] no build leftovers (`.next`, pycache, tsbuildinfo)

## 6) README + docs are launch-accurate
- [ ] README reflects current launch truth
- [ ] install paths and package names are current
- [ ] no stale pre-mainnet framing

## 7) Package versions coherent
- [ ] `arc402-cli`, plugin, TS SDK, Python SDK versions align with ENGINEERING-STATE
- [ ] published versions exist on npm/PyPI

## 8) Repo metadata correct
- [ ] Homepage, topics, description set
- [ ] LICENSE present and correct
- [ ] CONTRIBUTING present (or intentionally omitted)

## 9) CI protections active
- [ ] Repo Hygiene workflow enabled on PR/push
- [ ] branch protections (if used) enforce checks

## 10) Final launch-window decision
- [ ] Confirm we are inside intended public window
- [ ] Confirm article/public narrative timing
- [ ] Explicit GO from founder

---

## One-command preflight

```bash
bash scripts/repo-hygiene-check.sh && git status --short && git ls-files -ci --exclude-standard
```

If any item fails, do not flip public.
