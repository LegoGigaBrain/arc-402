#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# ARC-402 Workroom Entrypoint
#
# This is the governed execution environment for hired work. The entrypoint:
#   1. Reads the workroom policy (YAML → host:port pairs)
#   2. Resolves all hostnames to IPs while DNS is still open
#   3. Applies iptables rules: ALLOW resolved IPs, DROP everything else
#   4. Starts the DNS refresh daemon for IP rotation
#   5. Drops privileges and starts the ARC-402 daemon
#
# Runs as root for iptables setup. Drops to 'workroom' user for the daemon.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ─── log() must be defined first — used throughout ────────────────────────────
log() { echo "[workroom] $*"; }

readonly POLICY_FILE="/workroom/.arc402/openshell-policy.yaml"
readonly RULES_LOG="/workroom/.arc402/iptables-rules.log"
readonly ARENA_POLICY="/workroom/.arc402/arena-policy.yaml"
readonly ARENA_DEFAULT="/workroom/defaults/arena-policy.yaml"

# ─── Locate globally installed arc402-cli (Linux-native binaries) ─────────────
# The image runs npm install -g arc402-cli --build-from-source at build time.
# We must always use this global install for native addons (better-sqlite3 etc.),
# never the host mount which carries macOS/Windows binaries.
GLOBAL_NPM_ROOT=$(npm root -g 2>/dev/null || echo "")
GLOBAL_CLI_ROOT="${GLOBAL_NPM_ROOT}/arc402-cli"
GLOBAL_DAEMON="${GLOBAL_CLI_ROOT}/dist/daemon/index.js"
log "Global npm root: ${GLOBAL_NPM_ROOT:-not found}"
log "Global cli root: ${GLOBAL_CLI_ROOT}"

# NODE_PATH: if a host dist/ is mounted (--dev mode), require() calls from it
# must still resolve native addons from the Linux global install.
# Set unconditionally — harmless if the mount doesn't exist.
if [ -d "${GLOBAL_CLI_ROOT}/node_modules" ]; then
  export NODE_PATH="${GLOBAL_CLI_ROOT}/node_modules${NODE_PATH:+:$NODE_PATH}"
  log "NODE_PATH → ${GLOBAL_CLI_ROOT}/node_modules (Linux-native addons)"
fi

# ─── Resolve daemon entry point ───────────────────────────────────────────────
# Production (no --dev mount): /workroom/runtime/dist/daemon/index.js won't exist.
#   → use global install directly.
# Dev (--dev mount): mounted dist/ exists, global node_modules via NODE_PATH.
#   → use mounted dist so JS changes propagate without rebuild.
if [ -f "/workroom/runtime/dist/daemon/index.js" ]; then
  DAEMON_ENTRY="/workroom/runtime/dist/daemon/index.js"
  log "Daemon: host dist/ mount (dev mode)"
elif [ -f "${GLOBAL_DAEMON}" ]; then
  DAEMON_ENTRY="${GLOBAL_DAEMON}"
  log "Daemon: global install (production)"
else
  DAEMON_ENTRY=""
fi
readonly DAEMON_ENTRY

# ─── Validate prerequisites ────────────────────────────────────────────────

if [ ! -f "$POLICY_FILE" ]; then
  log "ERROR: Policy file not found at $POLICY_FILE"
  log "Run 'arc402 workroom init' on the host first."
  exit 1
fi

# ─── Phase 0b: Auto-derive LLM provider endpoints from OpenClaw config ────
#
# If OpenClaw config is mounted, read it and ensure all configured LLM
# providers have their API endpoints in the network policy. This runs
# BEFORE host resolution so the derived hosts get resolved too.

OPENCLAW_CONFIG="/home/workroom/.openclaw/openclaw.json"
if [ -f "$OPENCLAW_CONFIG" ]; then
  log "OpenClaw config found — deriving LLM provider endpoints..."
  /derive-policy.sh "$OPENCLAW_CONFIG" "$POLICY_FILE" || log "WARN: Policy derivation failed (non-fatal)"
else
  log "No OpenClaw config mounted — using static policy only"
fi

# ─── Phase 1: Resolve all policy hosts (DNS is still open) ─────────────────
#
# We resolve hostnames BEFORE applying the DROP policy. Once DROP is active,
# only explicitly allowed IPs are reachable. By resolving first, we capture
# the current DNS state into concrete IP rules.

declare -a RESOLVED_IPS=()
declare -a RESOLVED_PORTS=()
RESOLVE_COUNT=0

resolve_policy_hosts() {
  local policy_file="$1"

  while IFS=: read -r host port; do
    [ -z "$host" ] && continue
    port="${port:-443}"

    local ips
    ips=$(getent ahosts "$host" 2>/dev/null | awk '{print $1}' | sort -u || true)

    if [ -z "$ips" ]; then
      log "WARN: Could not resolve $host — skipping"
      continue
    fi

    local ip_count
    ip_count=$(echo "$ips" | wc -l | tr -d ' ')
    log "Resolved: $host → $ip_count IPs"

    while IFS= read -r ip; do
      RESOLVED_IPS+=("$ip")
      RESOLVED_PORTS+=("$port")
      RESOLVE_COUNT=$((RESOLVE_COUNT + 1))
    done <<< "$ips"
  done < <(/policy-parser.sh "$policy_file")
}

log "Resolving policy hosts..."
resolve_policy_hosts "$POLICY_FILE"

# Also resolve arena policy if present
if [ -f "$ARENA_POLICY" ]; then
  resolve_policy_hosts "$ARENA_POLICY"
elif [ -f "$ARENA_DEFAULT" ]; then
  resolve_policy_hosts "$ARENA_DEFAULT"
fi

# ─── Phase 2: Apply network enforcement ────────────────────────────────────
#
# Default policy: DROP all outbound.
# Exceptions: loopback, established connections, DNS, and resolved policy hosts.
#
# DNS is allowed broadly (not just 127.0.0.11) because the daemon and worker
# need to resolve hostnames at runtime. The iptables rules restrict which IPs
# are reachable, so DNS resolution alone doesn't grant access — only hosts
# whose IPs match a rule can actually be connected to.

iptables -P OUTPUT DROP 2>/dev/null || true
iptables -F OUTPUT 2>/dev/null || true

# Core rules: loopback, established, DNS
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -j ACCEPT

log "Default policy: DROP all outbound (except loopback, established, DNS)"

# Apply resolved IP rules
for i in "${!RESOLVED_IPS[@]}"; do
  iptables -A OUTPUT -p tcp -d "${RESOLVED_IPS[$i]}" --dport "${RESOLVED_PORTS[$i]}" -j ACCEPT
done

log "$RESOLVE_COUNT iptables rules applied"

# ─── Phase 3: Log applied rules ───────────────────────────────────────────

iptables -L OUTPUT -n --line-numbers > "$RULES_LOG" 2>/dev/null || true
log "Rules logged to $RULES_LOG"

# ─── Phase 4: Start DNS refresh daemon ─────────────────────────────────────
#
# Hostnames may resolve to different IPs over time (CDN rotation, failover).
# The refresh daemon re-resolves all policy hosts periodically and atomically
# updates iptables rules.

/dns-refresh.sh "$POLICY_FILE" &
local_dns_pid=$!
log "DNS refresh daemon started (PID: $local_dns_pid, interval: ${ARC402_DNS_REFRESH_SECONDS:-300}s)"

# ─── Phase 5: Validate daemon entry point ──────────────────────────────────

if [ -z "$DAEMON_ENTRY" ] || [ ! -f "$DAEMON_ENTRY" ]; then
  log "ERROR: Daemon entry point not found."
  log "Tried: /workroom/runtime/dist/daemon/index.js (host --dev mount)"
  log "Tried: ${GLOBAL_DAEMON} (global npm install inside image)"
  log "Rebuild the workroom image: arc402 workroom init"
  exit 1
fi
log "Daemon entry: $DAEMON_ENTRY"

# ─── Phase 5b: Worker identity + agent runtimes on PATH ────────────────────

WORKER_DIR="/workroom/.arc402/worker"

# Verify worker identity
if [ -f "$WORKER_DIR/SOUL.md" ]; then
  log "Worker SOUL.md: found"
else
  log "WARN: No worker SOUL.md — agent will use generic identity"
  log "  Run 'arc402 worker init' on the host to create one"
fi

if [ -f "$WORKER_DIR/config.json" ]; then
  WORKER_NAME=$(jq -r '.name // "unnamed"' "$WORKER_DIR/config.json" 2>/dev/null || echo "unnamed")
  WORKER_CAPS=$(jq -r '.capabilities // [] | join(", ")' "$WORKER_DIR/config.json" 2>/dev/null || echo "none")
  log "Worker: $WORKER_NAME | Capabilities: $WORKER_CAPS"
else
  log "WARN: No worker config.json"
fi

# Check knowledge/datasets/skills directories
for dir in knowledge datasets skills; do
  if [ -d "$WORKER_DIR/$dir" ]; then
    count=$(find "$WORKER_DIR/$dir" -type f 2>/dev/null | wc -l)
    log "Worker $dir/: $count files"
  fi
done

# Add agent runtimes to PATH
PATH_ADDITIONS=""
# OpenClaw (preferred runtime)
if [ -d "/workroom/openclaw" ]; then
  PATH_ADDITIONS="/workroom/openclaw:$PATH_ADDITIONS"
  log "OpenClaw runtime found at /workroom/openclaw"
fi
# Claude Code
if [ -d "/workroom/claude-code" ]; then
  PATH_ADDITIONS="/workroom/claude-code:$PATH_ADDITIONS"
  log "Claude Code found at /workroom/claude-code"
fi
if [ -n "$PATH_ADDITIONS" ]; then
  export PATH="$PATH_ADDITIONS$PATH"
fi

# Verify Claude auth
if [ -f "/home/workroom/.claude.json" ]; then
  log "AUTH OK: Claude auth file found"
else
  log "WARN: No Claude auth — mount -v ~/.claude.json:/home/workroom/.claude.json:ro"
fi

# ─── Phase 6: Drop privileges and start daemon ────────────────────────────

log "Starting ARC-402 daemon as user 'workroom'..."
exec su -s /bin/bash workroom -c "export PATH='$PATH' && export ARC402_WORKER_DIR='$WORKER_DIR' && node $DAEMON_ENTRY --foreground"
