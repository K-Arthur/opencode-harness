#!/bin/bash
echo "🔄 Checking for circular imports..."
if [ -f "tsconfig.json" ]; then
  if command -v npx &> /dev/null; then
    RESULT=$(npx --yes madge --circular --extensions ts src/ 2>&1)
    if echo "$RESULT" | grep -q "Found.*circular"; then
      echo "❌ Circular imports detected in TypeScript:"
      echo "$RESULT"
      exit 1
    fi
    echo "  ✅ No circular imports (TypeScript)"
  fi
fi
if [ -f "pyproject.toml" ] || [ -f "setup.py" ]; then
  if command -v lint-imports &> /dev/null; then
    lint-imports 2>&1
    if [ $? -ne 0 ]; then
      echo "❌ Circular imports detected in Python"
      exit 1
    fi
    echo "  ✅ No circular imports (Python)"
  fi
fi
echo "🔄 Import cycle check passed"
