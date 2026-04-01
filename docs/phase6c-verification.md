# Phase 6C Verification Lane

Phase 6C adds a practical verification lane for the node/daemon split that can run without real chain credentials, real relay secrets, or a live OpenShell sandbox.

## What it covers

- clean source builds for `packages/arc402-daemon`
- clean source builds for `cli`
- local split-daemon smoke for `signer + api`
- authenticated read-path sanity against the split API
- signer round-trip sanity through the API's Unix-socket bridge

The local smoke lane uses:

- a temporary `$HOME`
- a generated `~/.arc402/daemon.toml`
- a mock JSON-RPC server
- a mock bundler server

It does not require:

- a real machine key with funds
- a live Base RPC
- a real bundler
- Telegram or other notification secrets

## Run it

From the repo root:

```bash
bash scripts/verify-phase6c.sh
```

To run only the split-daemon smoke:

```bash
node scripts/daemon-split-smoke.cjs
```

## Expected local checks

`scripts/verify-phase6c.sh` should prove:

1. both TypeScript packages still build from source
2. `packages/arc402-daemon/dist/index.js` starts the split daemon successfully
3. the signer process comes up on its Unix socket
4. the API process comes up on its HTTP port
5. `/health`, `/wallet/status`, and `/workroom/status` remain sane under the split model
6. a commerce request can cross the API-to-signer boundary and return a signed user operation

## Remote / OpenShell checklist

The repo cannot safely fake a real OpenShell host from CI-like local verification, so remote readiness stays checklist-based.

Use this when you have an actual operator machine with OpenShell installed:

```bash
cd cli
npm run build
node dist/index.js openshell doctor
node dist/index.js daemon start
node dist/index.js daemon status
node dist/index.js endpoint status
```

Verify these operator outcomes:

- `openshell doctor` confirms the sandbox, policy file, provider material, and runtime bundle state
- `daemon start` succeeds without falling back to the legacy single-process launch path
- `daemon status` reports the node as live after the runtime sync
- `endpoint status` shows the public ingress chain clearly enough to distinguish ingress issues from daemon/runtime issues

If the machine already has a claimed endpoint, add:

```bash
curl -fsS http://127.0.0.1:4403/health
```

That confirms the split API process is serving locally on the host side after the OpenShell-owned runtime is launched.
