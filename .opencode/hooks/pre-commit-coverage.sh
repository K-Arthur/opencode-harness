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
# ──────────────────────────────────────────────────────────────────────
# Pre-Commit Hook: Coverage Gate
#
# Enforces minimum coverage thresholds before a commit lands.
# Thresholds are read from vitest.config.ts (via --coverage).
# Only runs when files under src/ are staged — skips for
# docs-only, config-only, or test-only commits.
#
# Current thresholds (vitest.config.ts):
#   Lines / Statements / Functions: {{coverage_minimum | default: 80}}%
#   Branches: 70%
#
# Trigger: git pre-commit (via scripts/setup-hooks.sh)
# Exit: 1 blocks commit, 0 allows
# ──────────────────────────────────────────────────────────────────────

STAGED=$(git diff --cached --name-only --diff-filter=ACM)

if [ -z "$STAGED" ]; then
  exit 0
fi

# ── Check if any src/ file is staged ─────────────────────────────────
SRC_STAGED=0
while IFS= read -r file; do
  if echo "$file" | grep -qE '^src/'; then
    SRC_STAGED=1
    break
  fi
done <<< "$STAGED"

if [ "$SRC_STAGED" -eq 0 ]; then
  echo "📊 Coverage gate: no src/ files staged, skipping."
  exit 0
fi

# ── Run coverage ───────────────────────────────────────────────────────
echo "📊 Running coverage gate (src/ files staged)..."

if [ ! -f "package.json" ] && [ ! -f "pyproject.toml" ] && [ ! -f "setup.py" ]; then
  if [ -f "Cargo.toml" ]; then
    # Rust: run tests; use cargo-tarpaulin for coverage if available
    if command -v cargo-tarpaulin &> /dev/null; then
      cargo tarpaulin --out Stdout --fail-under {{coverage_minimum | default: 80}} 2>&1
      if [ $? -ne 0 ]; then
        echo "❌ Coverage gate failed — below {{coverage_minimum | default: 80}}%."
        echo "   Run: cargo tarpaulin --out Html"
        _fc_write_violation "pre-commit-coverage" "error" "Coverage gate failed — run npm test --coverage to see report"
        exit 1
      fi
      echo "  ✅ Rust coverage gate passed"
    else
      cargo test --quiet 2>&1
      if [ $? -ne 0 ]; then
        echo "❌ Rust tests failed."
        _fc_write_violation "pre-commit-coverage" "error" "Coverage gate failed — run npm test --coverage to see report"
        exit 1
      fi
      echo "  ✅ Rust tests passed (install cargo-tarpaulin for coverage enforcement)"
    fi
  else
    echo "  ⚠️  No supported build system found — skipping coverage check."
  fi
  exit 0
fi

if grep -q '"vitest"' package.json 2>/dev/null; then
  OUTPUT=$(npx vitest run --coverage --reporter=verbose 2>&1)
  EXIT_CODE=$?

  if [ $EXIT_CODE -ne 0 ]; then
    echo "$OUTPUT" | grep -E "ERROR|Coverage|does not meet|%|FAIL|passed|failed" | head -40
    echo ""
    echo "❌ Coverage gate failed — thresholds not met."
    echo "   Run 'npx vitest run --coverage' locally to see the full report."
    echo "   Add tests until coverage meets the configured minimums."
    _fc_write_violation "pre-commit-coverage" "error" "Coverage gate failed — run npm test --coverage to see report"
    exit 1
  fi
  echo "  ✅ Coverage gate passed"
  exit 0
fi

if grep -q '"jest"' package.json 2>/dev/null; then
  COVERAGE_MIN={{coverage_minimum | default: 80}}
  npx jest --passWithNoTests --coverage \
    --coverageThreshold="{\"global\":{\"lines\":$COVERAGE_MIN,\"statements\":$COVERAGE_MIN,\"functions\":$COVERAGE_MIN,\"branches\":70}}" \
    --silent 2>&1
  if [ $? -ne 0 ]; then
    echo "❌ Coverage gate failed — thresholds not met."
    _fc_write_violation "pre-commit-coverage" "error" "Coverage gate failed — run npm test --coverage to see report"
    exit 1
  fi
  echo "  ✅ Coverage gate passed"
  exit 0
fi

if [ -f "pyproject.toml" ]|| [ -f "setup.py" ]; then
  if command -v pytest &> /dev/null; then
    pytest --tb=no --quiet --cov=src --cov-fail-under={{coverage_minimum | default: 80}} 2>&1
    if [ $? -ne 0 ]; then
      echo "❌ Coverage gate failed — below {{coverage_minimum | default: 80}}%."
      _fc_write_violation "pre-commit-coverage" "error" "Coverage gate failed — run npm test --coverage to see report"
      exit 1
    fi
    echo "  ✅ Coverage gate passed"
  fi
fi

exit 0
