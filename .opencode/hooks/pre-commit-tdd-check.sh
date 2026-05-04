#!/bin/bash
STAGED=$(git diff --cached --name-only --diff-filter=ACM)
if [ -z "$STAGED" ]; then exit 0; fi
SRC_PATTERNS='^(src|lib|app|server|client|pkg|internal|cmd)/'
TEST_PATTERNS='^(tests?|spec|__tests__)/'
TEST_FILE_PATTERNS='\.(test|spec)\.(ts|tsx|js|jsx|mjs|py|go|rb|java|kt)$'
SRC_FILES=()
TEST_FILES=()
while IFS= read -r file; do
  if echo "$file" | grep -qE "$SRC_PATTERNS"; then
    SRC_FILES+=("$file")
  elif echo "$file" | grep -qE "$TEST_PATTERNS"; then
    TEST_FILES+=("$file")
  elif echo "$file" | grep -qE "$TEST_FILE_PATTERNS"; then
    TEST_FILES+=("$file")
  fi
done <<< "$STAGED"
SRC_COUNT=${#SRC_FILES[@]}
TEST_COUNT=${#TEST_FILES[@]}
# RED gate: test-only commit must have at least one failing test
if [ "$TEST_COUNT" -gt 0 ] && [ "$SRC_COUNT" -eq 0 ]; then
  echo "🔴 TDD gate: test-only commit — running staged tests..."
  RUN_CMD=""
  if [ -f "package.json" ]; then
    if grep -q '"vitest"' package.json 2>/dev/null; then
      RUN_CMD="npx vitest run"
    elif grep -q '"jest"' package.json 2>/dev/null; then
      RUN_CMD="npx jest --passWithNoTests"
    fi
  elif [ -f "Cargo.toml" ]; then
    RUN_CMD="cargo test"
  elif [ -f "pytest.ini" ] || [ -f "pyproject.toml" ] || [ -f "setup.py" ]; then
    RUN_CMD="python -m pytest"
  fi
  if [ -n "$RUN_CMD" ]; then
    $RUN_CMD "${TEST_FILES[@]}" > /tmp/tdd-check-output.txt 2>&1
    if [ $? -eq 0 ]; then
      echo "❌ TDD RED gate violation: all staged tests PASS"
      echo "   A test-only commit must contain at least one failing test."
      echo "   Either tests were written after implementation, or assertions are vacuous."
      cat /tmp/tdd-check-output.txt | head -30
      exit 1
    fi
    echo "  ✅ RED gate satisfied — staged tests fail as expected"
  else
    echo "  ⚠️  Cannot detect test runner — skipping RED gate check"
  fi
fi
# Source gate: warn on implementation without tests
if [ "$SRC_COUNT" -gt 0 ] && [ "$TEST_COUNT" -eq 0 ]; then
  echo "⚠️  TDD warning: implementation committed without test changes"
  echo "   Verify a preceding test(scope): [RED] commit exists in this branch."
fi
exit 0
