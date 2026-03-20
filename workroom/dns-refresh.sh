#!/bin/bash
# ARC-402 Workroom DNS Refresh Daemon
# Periodically re-resolves policy hostnames and updates iptables rules.
# Runs as root in the background inside the workroom container.
set -euo pipefail

POLICY_FILE="${1:-/workroom/.arc402/openshell-policy.yaml}"
REFRESH_INTERVAL="${ARC402_DNS_REFRESH_SECONDS:-300}"
RULES_LOG="/workroom/.arc402/iptables-rules.log"

echo "[dns-refresh] Starting DNS refresh loop (interval: ${REFRESH_INTERVAL}s)"

while true; do
  sleep "$REFRESH_INTERVAL"

  echo "[dns-refresh] Refreshing DNS for policy hosts..."

  # Build new rules in a temporary chain
  iptables -N OUTPUT_NEW 2>/dev/null || iptables -F OUTPUT_NEW

  # Loopback + established + DNS (always allowed)
  iptables -A OUTPUT_NEW -o lo -j ACCEPT
  iptables -A OUTPUT_NEW -m state --state ESTABLISHED,RELATED -j ACCEPT
  iptables -A OUTPUT_NEW -p udp --dport 53 -d 127.0.0.11 -j ACCEPT
  iptables -A OUTPUT_NEW -p tcp --dport 53 -d 127.0.0.11 -j ACCEPT

  # Re-resolve all policy hosts
  UPDATED=0
  while IFS=: read -r HOST PORT; do
    [ -z "$HOST" ] && continue
    PORT="${PORT:-443}"

    IPS=$(getent ahosts "$HOST" 2>/dev/null | awk '{print $1}' | sort -u || true)
    if [ -z "$IPS" ]; then
      echo "[dns-refresh] WARN: Could not resolve $HOST"
      continue
    fi

    for IP in $IPS; do
      iptables -A OUTPUT_NEW -p tcp -d "$IP" --dport "$PORT" -j ACCEPT
      UPDATED=$((UPDATED + 1))
    done
  done < <(/policy-parser.sh "$POLICY_FILE")

  # Atomic swap: replace OUTPUT chain with the new rules
  iptables -F OUTPUT
  iptables -A OUTPUT -j OUTPUT_NEW 2>/dev/null || {
    # Fallback: copy rules directly if chain jump doesn't work
    iptables -F OUTPUT
    iptables -A OUTPUT -o lo -j ACCEPT
    iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT
    iptables -A OUTPUT -p udp --dport 53 -d 127.0.0.11 -j ACCEPT
    iptables -A OUTPUT -p tcp --dport 53 -d 127.0.0.11 -j ACCEPT

    while IFS=: read -r HOST PORT; do
      [ -z "$HOST" ] && continue
      PORT="${PORT:-443}"
      IPS=$(getent ahosts "$HOST" 2>/dev/null | awk '{print $1}' | sort -u || true)
      for IP in $IPS; do
        iptables -A OUTPUT -p tcp -d "$IP" --dport "$PORT" -j ACCEPT
      done
    done < <(/policy-parser.sh "$POLICY_FILE")
  }

  # Clean up temp chain
  iptables -X OUTPUT_NEW 2>/dev/null || true

  # Log updated rules
  iptables -L OUTPUT -n --line-numbers > "$RULES_LOG" 2>/dev/null || true

  echo "[dns-refresh] Refreshed: $UPDATED rules applied"
done
