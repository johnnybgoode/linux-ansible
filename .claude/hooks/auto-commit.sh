#!/bin/bash
# PostToolUse hook: auto-commit vault changes after Edit/Write operations
# Reads tool input from stdin to determine if a vault file was modified

set -euo pipefail

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# Only act on markdown files
if [[ -z "$FILE_PATH" || "$FILE_PATH" != *.md ]]; then
  exit 0
fi

# Only act on files within the engram vault
if [[ "$FILE_PATH" != *"/engram/"* ]]; then
  exit 0
fi

# Derive the path relative to the engram root
ENGRAM_ROOT="${FILE_PATH%%/engram/*}/engram"
REL_TO_ENGRAM="${FILE_PATH#$ENGRAM_ROOT/}"

# Allow: notes folders (research, knowledge, ideas, tasks, journal)
# Allow: root daily-briefing.md
ALLOWED=0
case "$REL_TO_ENGRAM" in
  research/*|knowledge/*|ideas/*|tasks/*|journal/*|daily-briefing.md)
    ALLOWED=1
    ;;
esac

if [[ "$ALLOWED" -eq 0 ]]; then
  exit 0
fi

cd "$(git -C "$(dirname "$FILE_PATH")" rev-parse --show-toplevel)" 2>/dev/null || exit 0

# Get the relative path for a clean commit message
REL_PATH=$(realpath --relative-to="." "$FILE_PATH" 2>/dev/null || echo "$FILE_PATH")

# Stage only the changed vault file
git add "$REL_PATH" 2>/dev/null || exit 0

# Check if there's actually something to commit
if git diff --cached --quiet 2>/dev/null; then
  exit 0
fi

HOSTNAME=$(hostname)
DATE=$(date '+%Y-%m-%d %H:%M')
FILES=$(git diff --cached --name-status | awk '{printf "%-3s%s\n", $1, $2}')

git commit -m "[$HOSTNAME]: $DATE

$FILES" --no-gpg-sign -q 2>/dev/null || true
