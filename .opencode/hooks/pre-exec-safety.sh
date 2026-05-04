#!/bin/bash
DANGEROUS_PATTERNS=(
  "rm -rf /"
  "DROP DATABASE"
  "DROP TABLE"
  "TRUNCATE"
  "force push"
  "git push.*--force"
  "kubectl delete namespace"
)
for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  if echo "$1" | grep -iqE "$pattern"; then
    echo "❌ Blocked dangerous command matching: $pattern"
    exit 1
  fi
done
