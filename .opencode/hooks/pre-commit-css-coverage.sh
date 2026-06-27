#!/bin/bash
# pre-commit-css-coverage.sh — Block commits that introduce renderer classes
# without corresponding CSS rules.
#
# This catches the exact failure mode that caused the subagent tool card
# regression: an agent adds a class to a renderer but the CSS was wiped by
# the ephemeral-tree process, so the class has no styling.
#
# Only runs if CSS or renderer files are staged.

STAGED=$(git diff --cached --name-only --diff-filter=ACM)

CSS_OR_RENDERER_STAGED=0
while IFS= read -r file; do
  if echo "$file" | grep -qE '\.(css)$'; then
    CSS_OR_RENDERER_STAGED=1
    break
  fi
  if echo "$file" | grep -qE 'src/chat/webview/(subagentCard|fileEditCard|liveCommandCard)\.ts$'; then
    CSS_OR_RENDERER_STAGED=1
    break
  fi
done <<< "$STAGED"

if [ "$CSS_OR_RENDERER_STAGED" -eq 0 ]; then
  exit 0
fi

echo "🎨 CSS/renderer files staged — running CSS coverage check..."

OUTPUT=$(npx tsx --test src/chat/webview/css/cssCoverage.test.ts 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo "❌ CSS coverage check failed — renderer classes missing CSS rules:"
  echo "$OUTPUT" | grep -E '✖|missing|AssertionError' | head -20
  echo ""
  echo "This usually means CSS was wiped by the ephemeral-tree process."
  echo "Check: git stash list → git stash show -p \"stash@{0}\""
  echo "Recover: git checkout \"stash@{0}\" -- <css-files>"
  exit 1
fi

echo "✓ CSS coverage check passed"
exit 0
