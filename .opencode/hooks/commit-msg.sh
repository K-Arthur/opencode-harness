#!/usr/bin/env bash
# commit-msg: enforce conventional commit format
# ForgeCraft — generated hook

COMMIT_MSG_FILE="$1"
COMMIT_MSG=$(cat "$COMMIT_MSG_FILE")

# Skip merge commits and fixup commits
if echo "$COMMIT_MSG" | grep -qE "^(Merge|Revert|fixup!|squash!)"; then
  exit 0
fi

# Skip empty messages and comments-only
STRIPPED=$(echo "$COMMIT_MSG" | sed '/^#/d' | sed '/^$/d')
if [ -z "$STRIPPED" ]; then
  exit 0
fi

PATTERN="^(feat|fix|refactor|docs|test|chore|perf|ci|build|revert)(\([a-z0-9/_-]+\))?(!)?: .{1,72}"

if ! echo "$COMMIT_MSG" | grep -qE "$PATTERN"; then
  echo ""
  echo "  ✗ Commit message does not follow conventional commit format."
  echo ""
  echo "  Required format: <type>(<scope>): <description>"
  echo "  Types: feat | fix | refactor | docs | test | chore | perf | ci | build | revert"
  echo "  Examples:"
  echo "    feat(auth): add JWT refresh token support"
  echo "    fix(api): handle null response from payment gateway"
  echo "    docs: update README with setup instructions"
  echo ""
  echo "  Your message: $COMMIT_MSG"
  echo ""
  exit 1
fi

exit 0
