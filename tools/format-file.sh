#!/usr/bin/env bash
#
# spec 001-initial-dev · CLAUDE.md §12 — format one file, quietly, never failing.
#
# Called by the Claude Code PostToolUse hook in `.claude/settings.json` after every Write or
# Edit, so formatting and auto-fixable lint never reach a review round or a test run. The git
# pre-commit hook is the belt to this file's braces: this one keeps the working tree clean as it
# is written, that one guarantees nothing unformatted is ever committed.
#
# Always exits 0 — a formatter is not allowed to interrupt the session.

set -uo pipefail

file=${1:-}
[ -n "$file" ] || exit 0
[ -f "$file" ] || exit 0

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root" || exit 0
[ -d node_modules ] || exit 0

# Outside the repository (an absolute path elsewhere, a scratchpad file) is none of our business.
case "$file" in
  /*) case "$file" in "$repo_root"/*) ;; *) exit 0 ;; esac ;;
esac

pnpm exec prettier --write --ignore-unknown --log-level silent -- "$file" >/dev/null 2>&1

case "$file" in
  *.ts | *.tsx | *.js | *.mjs | *.cjs)
    pnpm exec eslint --fix --no-warn-ignored \
      --cache --cache-location node_modules/.cache/eslint/ -- "$file" >/dev/null 2>&1
    ;;
esac

exit 0
