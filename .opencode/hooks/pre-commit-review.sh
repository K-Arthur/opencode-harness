#!/bin/bash
DIFF=$(git diff --cached)
if [ -z "$DIFF" ]; then exit 0; fi
echo "📝 Staged changes ready for review"
# Full auto-review requires claude CLI integration
# This hook validates the diff is non-empty and staged
exit 0
