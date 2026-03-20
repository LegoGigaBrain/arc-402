#!/bin/bash
# Parse workroom policy YAML and output HOST:PORT pairs
# Reads network_policies and arena_network from ARC-402 policy files
# Dependencies: awk (always available)

set -euo pipefail

POLICY_FILE="${1:-/workroom/.arc402/openshell-policy.yaml}"

if [ ! -f "$POLICY_FILE" ]; then
  echo "ERROR: Policy file not found: $POLICY_FILE" >&2
  exit 1
fi

# Extract host:port pairs from YAML
# Handles both network_policies (base) and arena_network (arena) sections
# Each section has nested entries with endpoints[].host and endpoints[].port

awk '
  /host:/ { gsub(/.*host: *"?/, ""); gsub(/".*/, ""); host=$0 }
  /port:/ { gsub(/.*port: *"?/, ""); gsub(/".*/, ""); if (host != "") { print host ":" $0; host="" } }
' "$POLICY_FILE"
