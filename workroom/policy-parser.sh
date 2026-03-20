#!/bin/bash
# Parse workroom policy YAML and output HOST:PORT pairs
# Reads network_policies from the ARC-402 policy file
# Dependencies: python3 (available in node:22-slim) or simple grep/awk fallback

set -euo pipefail

POLICY_FILE="${1:-/workroom/.arc402/openshell-policy.yaml}"

if [ ! -f "$POLICY_FILE" ]; then
  echo "ERROR: Policy file not found: $POLICY_FILE" >&2
  exit 1
fi

# Extract host:port pairs from YAML network_policies
# Each policy entry has endpoints[].host and endpoints[].port
# We use awk to parse the simple YAML structure

awk '
  /^  [a-z_]+:$/ { in_policy=1; next }
  in_policy && /host:/ { gsub(/.*host: */, ""); host=$0 }
  in_policy && /port:/ { gsub(/.*port: */, ""); print host ":" $0; host="" }
' "$POLICY_FILE"
