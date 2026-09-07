#!/usr/bin/env bash
# Fixture for the semgrep rule house-no-silent-stderr-redirect.
#
# Never executed. Lines that must be flagged carry a trailing `# VIOLATION`
# marker.

set -uo pipefail

# ── must be flagged ────────────────────────────────────────────────────────

# The message that would have said WHY is discarded, and the exit status is
# discarded with it by the surrounding pipeline.
grep -c '"type":"user"' "$1" 2>/dev/null # VIOLATION

# Same defect inside a command substitution: the variable ends up empty and the
# script carries on as though nothing had happened.
COUNT=$(node scripts/count-rows.mjs 2> /dev/null) # VIOLATION

# ── must NOT be flagged ────────────────────────────────────────────────────

# The failure stops something.
node scripts/count-rows.mjs 2>/dev/null || exit 3

# An explicit, visible decision to continue. Weaker than `|| exit`, and this
# rule deliberately accepts it: the repo has two of these and both are
# deliberate, so flagging them would be noise on a rule that has to stay quiet
# to be read.
envelope=$(jq -r '.response.status // empty' "$1" 2>/dev/null || true)

# stderr kept, which is the default and the point.
node scripts/count-rows.mjs

# Only stdout is discarded; the diagnostic still reaches the log.
node scripts/count-rows.mjs >/dev/null
