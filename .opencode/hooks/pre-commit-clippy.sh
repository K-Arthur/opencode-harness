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
if [ ! -f "Cargo.toml" ]; then
  exit 0
fi
STAGED_RS=$(git diff --cached --name-only --diff-filter=ACM | grep '\.rs$')
if [ -z "$STAGED_RS" ]; then
  exit 0
fi
echo "🦀 Running cargo clippy..."
cargo clippy --all-targets --all-features 2>&1
if [ $? -ne 0 ]; then
  echo "❌ cargo clippy failed — fix lint errors before committing."
  echo "   Run: cargo clippy --all-targets --all-features"
  _fc_write_violation "pre-commit-clippy" "error" "Cargo clippy violations found — run cargo clippy to see details"
  exit 1
fi
echo "  ✅ cargo clippy passed"
