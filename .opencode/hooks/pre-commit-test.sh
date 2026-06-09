#!/bin/bash
COVERAGE_MIN={{coverage_minimum | default: 80}}

# Collect staged files once.
STAGED=$(git diff --cached --name-only --diff-filter=ACM)

# Determine what kinds of files are staged.
SRC_STAGED=0
CODE_STAGED=0
while IFS= read -r file; do
  if echo "$file" | grep -qE '^src/'; then
    SRC_STAGED=1
    CODE_STAGED=1
  elif echo "$file" | grep -qE '^tests?/'; then
    CODE_STAGED=1
  fi
done <<< "$STAGED"

# If src/ is staged the coverage-gate hook runs the full test + coverage pass.
# Skip the bare run here to avoid running the full suite twice.
if [ "$SRC_STAGED" -eq 1 ]; then
  echo "🧪 src/ files staged — tests will run via coverage gate, skipping bare run."
  exit 0
fi

# If no code files at all are staged (docs-only, config-only, etc.) skip the run.
if [ "$CODE_STAGED" -eq 0 ]; then
  echo "🧪 No code files staged — skipping test run."
  exit 0
fi

echo "🧪 Running tests..."
if [ -f "package.json" ]; then
  if grep -q '"vitest"' package.json 2>/dev/null; then
    npx vitest run --reporter=verbose 2>&1
    if [ $? -ne 0 ]; then
      echo "❌ Tests failed."
      exit 1
    fi
    echo "  ✅ Tests passed"
  elif grep -q '"jest"' package.json 2>/dev/null; then
    npx jest --passWithNoTests --coverage \
      --coverageThreshold="{\"global\":{\"lines\":$COVERAGE_MIN}}" \
      --silent 2>&1
    if [ $? -ne 0 ]; then
      echo "❌ Jest tests failed or coverage below ${COVERAGE_MIN}%."
      exit 1
    fi
    echo "  ✅ Jest tests passed"
  fi
fi
if [ -f "pyproject.toml" ] || [ -f "setup.py" ]; then
  if command -v pytest &> /dev/null; then
    pytest --tb=short --quiet --cov=src --cov-fail-under=$COVERAGE_MIN 2>&1
    if [ $? -ne 0 ]; then
      echo "❌ Tests failed or coverage below ${COVERAGE_MIN}%."
      exit 1
    fi
    echo "  ✅ Python tests passed"
  fi
fi
if [ -f "Cargo.toml" ]; then
  cargo test --quiet 2>&1
  if [ $? -ne 0 ]; then
    echo "❌ Rust tests failed."
    exit 1
  fi
  echo "  ✅ Rust tests passed"
fi
echo "🧪 All tests passed"
