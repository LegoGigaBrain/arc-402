# ARC-402 Release Candidate Verification — RC-B

Date: 2026-03-11

## Scope

Workspaces verified:
- `/home/lego/.openclaw/workspace-engineering/products/arc-402/reference`
- `/home/lego/.openclaw/workspace-engineering/products/arc-402/python-sdk`
- `/home/lego/.openclaw/workspace-engineering/products/arc-402/reference/sdk`
- `/home/lego/.openclaw/workspace-engineering/products/arc-402/cli`

## Verification Matrix

| Component | Command | Result | Notes |
|---|---|---:|---|
| Reference contracts | `cd /home/lego/.openclaw/workspace-engineering/products/arc-402/reference && forge build` | PASS | Exit 0. Build succeeded; Foundry emitted lint-style notes/warnings but no compilation failure. |
| Reference contracts | `cd /home/lego/.openclaw/workspace-engineering/products/arc-402/reference && forge test -vv` | PASS | Exit 0. `279 tests passed, 0 failed, 0 skipped`. |
| Python SDK | `cd /home/lego/.openclaw/workspace-engineering/products/arc-402/python-sdk && python3 -m pytest -q` | FAIL (environment-specific) | Host Python environment loads incompatible globally installed pytest/pytest-asyncio packages: `ImportError: cannot import name 'FixtureDef' from 'pytest'`. This is not a source-tree failure. |
| Python SDK | `cd /home/lego/.openclaw/workspace-engineering/products/arc-402/python-sdk && python3 -m build` | PASS | Exit 0. Built `arc402-0.2.0.tar.gz` and `arc402-0.2.0-py3-none-any.whl`. |
| Python SDK (isolated confirmation) | `cd /home/lego/.openclaw/workspace-engineering/products/arc-402/python-sdk && python3 -m venv .venv-rcb && . .venv-rcb/bin/activate && python -m pip install -U pip && python -m pip install -e '.[dev]' && python -m pytest -q` | PASS | Exit 0. `16 passed, 1 warning in 0.38s`. Confirms the repo tests pass in an isolated environment. |
| TypeScript SDK | `cd /home/lego/.openclaw/workspace-engineering/products/arc-402/reference/sdk && npm test` | PASS | Exit 0. Node test runner reported `2 passed, 0 failed`. |
| TypeScript SDK | `cd /home/lego/.openclaw/workspace-engineering/products/arc-402/reference/sdk && npm run build` | PASS | Exit 0. `tsc` completed successfully. |
| CLI | `cd /home/lego/.openclaw/workspace-engineering/products/arc-402/cli && npm run build` | PASS | Exit 0. `tsc` completed successfully. |

## Environment vs Repo Findings

### Environment-specific failure

Python SDK test failure under the host interpreter is caused by a global package mismatch, not by the ARC-402 source tree:

- host command: `python3 -m pytest -q`
- failure: `ImportError: cannot import name 'FixtureDef' from 'pytest'`
- cause: globally installed `pytest_asyncio` in `/home/lego/.local/lib/python3.10/site-packages` is incompatible with the globally resolved `pytest`
- evidence that repo is healthy: the same test suite passes in a fresh virtualenv after installing `.[dev]`

### Repo-level failures

None found in the requested RC-B matrix scope.

## Observations

- `forge build` succeeds but surfaces multiple Foundry lint notes (for example unaliased imports and naming-style notes). These are non-blocking for the current verification run.
- Python isolated test run emitted one dependency warning from `websockets.legacy` deprecation; this did not fail the suite.

## Lightweight reproducibility fix made

Updated:
- `/home/lego/.openclaw/workspace-engineering/products/arc-402/python-sdk/README.md`

Change:
- added a **Local verification** section documenting an isolated virtualenv workflow:
  - `python3 -m venv .venv`
  - `python -m pip install -e '.[dev]'`
  - `python -m pytest -q`
  - `python -m build`

Reason:
- prevents false-negative local test results caused by globally installed pytest plugins.

## Bottom line

RC-B verification status from the current tree:
- Solidity reference build/test: **green**
- Python SDK build: **green**
- Python SDK tests: **green in isolated env; red in polluted host env**
- TypeScript SDK build/test: **green**
- CLI build: **green**
