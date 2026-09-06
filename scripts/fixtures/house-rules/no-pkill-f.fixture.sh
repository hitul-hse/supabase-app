#!/usr/bin/env bash
# Fixture for the semgrep rule house-no-pkill-f.
#
# Never executed. Lines that must be flagged carry a trailing `# VIOLATION`
# marker; scripts/check-house-rules.mjs asserts the findings are exactly that
# set of lines, and holds an independent total.

set -uo pipefail

# ── must be flagged ────────────────────────────────────────────────────────

# The incident: the pattern matched the operator's OWN shell, because the
# command line that contained the pattern also contained the pattern. The
# terminal died and the next question got the answer "it is running".
pkill -f "next dev" # VIOLATION

# Flags before -f do not change what it matches.
pkill -9 -f node # VIOLATION

# The long spelling does the same thing.
pkill --full "node scripts/sync" # VIOLATION

# ── must NOT be flagged ────────────────────────────────────────────────────

# Exact command name, not a full-command-line regex: cannot match this shell.
pkill -x node

# By pid, read first and checked.
PID=$(cat .next/dev.pid)
[ -n "$PID" ] && kill "$PID"

# pgrep is a question, not an execution. Reading the matches is how you find
# out that one of them is you.
pgrep -f "next dev" | grep -v "^$$\$" || true

# tmux owns its own panes.
tmux kill-session -t dev || true
