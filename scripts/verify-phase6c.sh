#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

run_step() {
  local label="$1"
  shift
  printf '\n==> %s\n' "$label"
  "$@"
}

run_step "Build @arc402/daemon" bash -lc "cd '$ROOT_DIR/packages/arc402-daemon' && npm run build"
run_step "Build arc402-cli" bash -lc "cd '$ROOT_DIR/cli' && npm run build"
printf '\n==> Smoke split daemon\n'
set +e
node "$ROOT_DIR/scripts/daemon-split-smoke.cjs"
smoke_status=$?
set -e
if [[ "$smoke_status" -eq 2 ]]; then
  printf 'Split-daemon smoke skipped because local listener binding is blocked in this environment.\n'
elif [[ "$smoke_status" -ne 0 ]]; then
  exit "$smoke_status"
fi

printf '\nPhase 6C verification lane passed.\n'
printf 'Remote/OpenShell sanity is checklist-driven: see %s\n' "$ROOT_DIR/docs/phase6c-verification.md"
