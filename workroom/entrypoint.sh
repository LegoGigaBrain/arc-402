#!/bin/bash
# ARC-402 Workroom Entrypoint
# Runs as root to set up iptables, then drops to workroom user for the daemon.
# Supports both base workroom policy and Arena policy overlay.
set -euo pipefail

POLICY_FILE="/workroom/.arc402/openshell-policy.yaml"
ARENA_POLICY="/workroom/.arc402/arena-policy.yaml"
RULES_LOG="/workroom/.arc402/iptables-rules.log"
DAEMON_ENTRY="/workroom/runtime/dist/daemon/index.js"

echo "[workroom] ARC-402 Workroom starting..."

# ── 0. Set up Arena directories ─────────────────────────────────────────────
mkdir -p /workroom/arena/{feed,profile,state,queue}
chown -R workroom:workroom /workroom/arena

# ── 1. Validate policy file exists ──────────────────────────────────────────
if [ ! -f "$POLICY_FILE" ]; then
  echo "[workroom] ERROR: Policy file not found at $POLICY_FILE"
  echo "[workroom] Run 'arc402 workroom init' on the host first."
  exit 1
fi

# ── 2. Resolve all hosts FIRST (before DROP policy) ────────────────────────
echo "[workroom] Resolving policy hosts..."
RESOLVED_RULES=""
while IFS=: read -r HOST PORT; do
  [ -z "$HOST" ] && continue
  PORT="${PORT:-443}"
  IPS=$(getent ahosts "$HOST" 2>/dev/null | awk '{print $1}' | sort -u || true)
  if [ -z "$IPS" ]; then
    echo "[workroom] WARN: Could not resolve $HOST — skipping"
    continue
  fi
  for IP in $IPS; do
    RESOLVED_RULES="${RESOLVED_RULES}${IP}:${PORT}\n"
  done
  echo "[workroom] Resolved: $HOST → $(echo "$IPS" | wc -l | tr -d ' ') IPs"
done < <(/policy-parser.sh "$POLICY_FILE")

# ── 3. Now apply DROP + allow resolved IPs ─────────────────────────────────
iptables -P OUTPUT DROP 2>/dev/null || true
iptables -F OUTPUT 2>/dev/null || true

# Allow loopback (IPC socket, localhost)
iptables -A OUTPUT -o lo -j ACCEPT

# Allow established/related (return traffic for allowed connections)
iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow DNS to Docker's internal resolver
iptables -A OUTPUT -p udp --dport 53 -d 127.0.0.11 -j ACCEPT
iptables -A OUTPUT -p tcp --dport 53 -d 127.0.0.11 -j ACCEPT

echo "[workroom] Default policy: DROP all outbound (except loopback + DNS)"

# Apply pre-resolved rules
ALLOWED_COUNT=0
RULES_FILE=$(mktemp)
echo -e "$RESOLVED_RULES" > "$RULES_FILE"
while IFS=: read -r IP PORT; do
  [ -z "$IP" ] && continue
  iptables -A OUTPUT -p tcp -d "$IP" --dport "$PORT" -j ACCEPT
  ALLOWED_COUNT=$((ALLOWED_COUNT + 1))
done < "$RULES_FILE"
rm -f "$RULES_FILE"

echo "[workroom] $ALLOWED_COUNT iptables rules applied from base policy"

# ── 3b. Parse Arena policy if present ───────────────────────────────────────
if [ -f "$ARENA_POLICY" ]; then
  ARENA_COUNT=0
  while IFS=: read -r HOST PORT; do
    [ -z "$HOST" ] && continue
    PORT="${PORT:-443}"
    IPS=$(getent ahosts "$HOST" 2>/dev/null | awk '{print $1}' | sort -u || true)
    if [ -z "$IPS" ]; then
      echo "[workroom] WARN: Could not resolve arena host $HOST — skipping"
      continue
    fi
    for IP in $IPS; do
      # Check if rule already exists (avoid duplicates from base policy)
      if ! iptables -C OUTPUT -p tcp -d "$IP" --dport "$PORT" -j ACCEPT 2>/dev/null; then
        iptables -A OUTPUT -p tcp -d "$IP" --dport "$PORT" -j ACCEPT
        ARENA_COUNT=$((ARENA_COUNT + 1))
      fi
    done
    echo "[workroom] ARENA ALLOW: $HOST:$PORT"
  done < <(/policy-parser.sh "$ARENA_POLICY" 2>/dev/null || true)
  echo "[workroom] $ARENA_COUNT additional iptables rules from Arena policy"
else
  echo "[workroom] No Arena policy found — Arena network rules skipped"
fi

# ── 4. Log applied rules ───────────────────────────────────────────────────
iptables -L OUTPUT -n --line-numbers > "$RULES_LOG" 2>/dev/null || true
echo "[workroom] Rules logged to $RULES_LOG"

# ── 5. Start DNS refresh daemon in background ──────────────────────────────
/dns-refresh.sh "$POLICY_FILE" &
DNS_PID=$!
echo "[workroom] DNS refresh daemon started (PID: $DNS_PID, interval: 300s)"

# ── 6. Validate daemon entry point exists ──────────────────────────────────
if [ ! -f "$DAEMON_ENTRY" ]; then
  echo "[workroom] ERROR: Daemon entry point not found at $DAEMON_ENTRY"
  echo "[workroom] The ARC-402 runtime bundle must be mounted at /workroom/runtime/"
  exit 1
fi

# ── 7. Drop to workroom user and start daemon ─────────────────────────────
echo "[workroom] Starting ARC-402 daemon as user 'workroom'..."
exec su -s /bin/bash workroom -c "node $DAEMON_ENTRY --foreground"
