#!/usr/bin/env bash
#
# Build, serve, and run the two suites that need a real running server: the HTTP
# end-to-end (`verify:e2e`) and the browser flow (`verify:ui`).
#
# This wrapper exists for one reason: the exit status. The previous one-line npm
# script ended with
#
#     … && npm run verify:e2e && npm run verify:ui; kill $(cat .next/e2e.pid) || true
#
# where the last command executed is the `kill`, so the whole thing reported
# success no matter how the suites went — a UI suite that could not even launch a
# browser still exited 0. CI is unaffected, because `.github/workflows/ci.yml`
# runs build/start/e2e/ui as separate steps that each fail the job on their own.
# The victim was the human following the pre-deploy checklist in
# `docs/DEPLOYMENT.md`, where `npm run verify:live` is the gate before shipping:
# it answered "fine" regardless. Here the suite status is captured, the server is
# torn down either way, and that captured status is what we exit with.
#
# Not `set -e`: a failing suite must reach the cleanup below, not abort the
# script and leak a server process.
set -uo pipefail

PORT="${PORT:-3000}"
HEALTH="http://127.0.0.1:${PORT}/api/health"

npx next build || exit $?

# The server's own output goes to a log rather than to our stdout. Two reasons:
# it keeps the suites' results readable, and — less obviously — it means the
# server can never hold the caller's pipe open. With the server sharing stdout,
# `npm run verify:live | tail` appears to hang forever after the suites finish,
# because `tail` is still waiting on a writer that nothing has closed.
SERVER_LOG="${TMPDIR:-/tmp}/podzi-verify-live-server.log"
PORT="$PORT" npx next start >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

# Tear the server down however we leave — success, failure, or interrupt.
#
# `npx next start` spawns `next-server` as a *child*, so killing only $! leaves
# the actual server running: it keeps the port bound and outlives the run. Kill
# the children first, then the wrapper.
cleanup() {
  pkill -P "$SERVER_PID" 2>/dev/null || true
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

npx wait-on -t 60000 "$HEALTH"
status=$?
if [ "$status" -ne 0 ]; then
  echo "verify:live: server did not become healthy at $HEALTH" >&2
  exit "$status"
fi

# Run both suites even though the first failing one decides the outcome, so a
# single run reports everything that is broken rather than one thing at a time.
npm run verify:e2e
e2e_status=$?

npm run verify:ui
ui_status=$?

if [ "$e2e_status" -ne 0 ] || [ "$ui_status" -ne 0 ]; then
  echo "verify:live: FAILED (verify:e2e=$e2e_status verify:ui=$ui_status)" >&2
  echo "--- last 40 lines of server log ($SERVER_LOG) ---" >&2
  tail -40 "$SERVER_LOG" >&2 || true
  exit 1
fi

echo "verify:live: both suites passed"
