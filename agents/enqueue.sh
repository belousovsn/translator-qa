#!/usr/bin/env bash
# Forced command of the deploy key (#747): `deploy-test` connects after a green
# deploy and sends the commit list and diff on stdin. The script stores them in
# the queue and starts a worker; it never runs anything the caller names.
#
#   authorized_keys: command="/opt/qa-agents/agents/enqueue.sh",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 ...
#   caller:          ... | ssh qa-agents@host "enqueue <sha>"
set -euo pipefail

QUEUE="${QA_AGENTS_QUEUE:-/var/lib/qa-agents/queue}"
read -r verb sha extra <<<"${SSH_ORIGINAL_COMMAND:-}" || true
if [[ "$verb" != "enqueue" || ! "$sha" =~ ^[0-9a-f]{7,40}$ || -n "${extra:-}" ]]; then
  echo "usage: enqueue <sha>" >&2
  exit 2
fi

mkdir -p "$QUEUE"
file="$QUEUE/$(date -u +%Y%m%dT%H%M%SZ)-${sha:0:12}.txt"
# The diff is capped by the sender; this cap guards the disk.
head -c 400000 >"$file.part"
mv "$file.part" "$file"
echo "queued ${sha:0:12}"

# The worker holds the run lock; when one is already running it picks this job
# up when it finishes, so a busy lock is not an error.
setsid nohup /opt/qa-agents/agents/run.sh --from-queue >>/var/lib/qa-agents/worker.log 2>&1 </dev/null &
