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
PATTERNS=(
  'AKIA[0-9A-Z]{16}'
  'password\s*=\s*["\x27][^"\x27]+'
  'BEGIN RSA PRIVATE KEY'
  'sk-[a-zA-Z0-9]{48}'
  'ghp_[a-zA-Z0-9]{36}'
)
STAGED=$(git diff --cached --name-only)
for file in $STAGED; do
  for pattern in "${PATTERNS[@]}"; do
    if grep -qE "$pattern" "$file" 2>/dev/null; then
      echo "❌ Potential secret found in $file matching pattern"
      _fc_write_violation "pre-commit-secrets" "error" "Potential secrets detected in staged files — review output above"
      exit 1
    fi
  done
done
