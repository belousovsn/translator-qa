#!/usr/bin/env bash
# Entry point on droplet-b: one run at a time, settings from /etc/qa-agents.env.
# Usage: run.sh [persona-id ...] [--seed=N] [--no-notify]
set -euo pipefail
exec 9>/var/lock/qa-agents.lock
if ! flock -n 9; then
  echo "another QA agents run is in progress" >&2
  exit 75
fi
set -a
. /etc/qa-agents.env
set +a
cd "$(dirname "$0")"
exec node run.mjs "$@"
