#!/bin/bash
# Set the two required LC3 variables on a balena fleet.
#
#   ./balena/set-vars.sh <fleet> <gateway-ip> [worker-token]
#
# With no token argument the value is read from the gateway over SSH, which
# needs root access to it; otherwise paste the contents of
# /srv/lc3/state/worker_token.
set -euo pipefail

FLEET="${1:-}"
GATEWAY="${2:-}"
TOKEN="${3:-}"

if [ -z "$FLEET" ] || [ -z "$GATEWAY" ]; then
    echo "usage: $0 <fleet> <gateway-ip> [worker-token]" >&2
    exit 2
fi

if [ -z "$TOKEN" ]; then
    echo "Reading the worker token from $GATEWAY over SSH..."
    TOKEN=$(ssh "root@$GATEWAY" 'cat /srv/lc3/state/worker_token')
fi
TOKEN=$(printf '%s' "$TOKEN" | tr -d '[:space:]')

if [ -z "$TOKEN" ]; then
    echo "empty worker token" >&2
    exit 1
fi

# `env set` in balena CLI v14+; it was `env add` in older releases.
balena env set LC3_GATEWAY "$GATEWAY" --fleet "$FLEET"
balena env set LC3_WORKER_TOKEN "$TOKEN" --fleet "$FLEET"

echo "Set on fleet $FLEET:"
balena env list --fleet "$FLEET" | grep -E 'NAME|LC3_' || true
