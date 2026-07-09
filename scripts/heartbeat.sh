#!/usr/bin/env bash
set -euo pipefail

SERVER_PORT="${1:-3000}"
SERVER_URL="http://localhost:$SERVER_PORT/api/health"

if command -v curl &>/dev/null; then
  resp=$(curl -sf "$SERVER_URL" 2>&1) || resp="FAILED"
elif command -v wget &>/dev/null; then
  resp=$(wget -qO- "$SERVER_URL" 2>&1) || resp="FAILED"
else
  echo "neither curl nor wget available"
  exit 1
fi

if [ "$resp" = "FAILED" ]; then
  echo "HEARTBEAT FAIL: Server at $SERVER_PORT is DOWN ($(date))"
  exit 1
fi

status=$(echo "$resp" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','unknown'))" 2>/dev/null || echo "parse-error")

if [ "$status" = "ok" ]; then
  echo "HEARTBEAT OK: Server at $SERVER_PORT is healthy ($(date))"
else
  echo "HEARTBEAT WARN: Server at $SERVER_PORT responded but status=$status ($(date))"
fi
