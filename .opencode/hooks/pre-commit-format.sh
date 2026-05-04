#!/bin/bash
STAGED=$(git diff --cached --name-only --diff-filter=ACM)
# Python
echo "$STAGED" | grep '\.py$' | xargs -r black --quiet 2>/dev/null
echo "$STAGED" | grep '\.py$' | xargs -r isort --quiet 2>/dev/null
# TypeScript/JavaScript
echo "$STAGED" | grep '\.\(ts\|tsx\|js\|jsx\)$' | xargs -r npx prettier --write 2>/dev/null
# Rust
if echo "$STAGED" | grep -q '\.rs$' && [ -f "Cargo.toml" ]; then
  cargo fmt 2>/dev/null
fi
# Re-stage formatted files
echo "$STAGED" | xargs -r git add
