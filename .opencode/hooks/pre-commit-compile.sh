#!/bin/bash
_fc_write_violation() {
  local hook_name="$1" severity="${2:-error}" message="$3"
  local repo_root
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || return 0
  local dir="$repo_root/.forgecraft"
  mkdir -p "$dir" 2>/dev/null || return 0
  local ts
  ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || printf "unknown")"
  local esc_msg
  esc_msg="$(printf '%s' "$message" | sed 's/\\/\\\\/g; s/"/\\"/g')"
  printf '{"hook":"%s","severity":"%s","message":"%s","timestamp":"%s"}\n' \
    "$hook_name" "$severity" "$esc_msg" "$ts" \
    >> "$dir/gate-violations.jsonl" 2>/dev/null || true
}
echo "🔨 Running build check..."
if [ -f "pyproject.toml" ] || [ -f "setup.py" ] || [ -f "requirements.txt" ]; then
  STAGED_PY=$(git diff --cached --name-only --diff-filter=ACM | grep '\.py$')
  if [ -n "$STAGED_PY" ]; then
    for file in $STAGED_PY; do
      python -m py_compile "$file" 2>&1
      if [ $? -ne 0 ]; then
        echo "❌ Syntax error in $file"
        _fc_write_violation "pre-commit-compile" "error" "TypeScript compilation failed — run tsc --noEmit to see errors"
        exit 1
      fi
    done
    echo "  ✅ Python syntax OK"
  fi
fi
if [ -f "tsconfig.json" ]; then
  npx tsc --noEmit 2>&1
  if [ $? -ne 0 ]; then
    echo "❌ TypeScript compilation failed."
    _fc_write_violation "pre-commit-compile" "error" "TypeScript compilation failed — run tsc --noEmit to see errors"
    exit 1
  fi
  echo "  ✅ TypeScript compilation OK"
fi
if [ -f "Cargo.toml" ]; then
  STAGED_RS=$(git diff --cached --name-only --diff-filter=ACM | grep '\.rs$')
  if [ -n "$STAGED_RS" ]; then
    cargo check --quiet 2>&1
    if [ $? -ne 0 ]; then
      echo "❌ Rust cargo check failed."
      _fc_write_violation "pre-commit-compile" "error" "Rust cargo check failed — run cargo check to see errors"
      exit 1
    fi
    echo "  ✅ Rust cargo check OK"
  fi
fi
echo "🔨 Build check passed"
