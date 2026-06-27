#!/usr/bin/env node
/**
 * check-workspace-state.mjs — Session-start workspace state check.
 *
 * Run this at the start of any session (agent or human) to detect:
 * 1. Uncommitted work wiped by the ephemeral-tree process (stashes/resets)
 * 2. CSS regressions (renderer classes with no CSS rules)
 *
 * Exits non-zero if regressions are detected, so CI/session-init catches it.
 */
import { execSync } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

const repoRoot = resolve(import.meta.dirname, "..")

function run(cmd, label) {
  try {
    return execSync(cmd, { encoding: "utf8", timeout: 10000, cwd: repoRoot }).trim()
  } catch (err) {
    process.stderr.write(`  ${label}: failed (${err.message.split("\n")[0]})\n`)
    return ""
  }
}

let hasIssues = false

// 1. Check for wiped work
process.stdout.write("Checking for wiped work (stashes/resets)...\n")
const stashList = run("git stash list", "stash list")
if (stashList) {
  hasIssues = true
  process.stderr.write(`  ⚠️  Stashes found — uncommitted work may have been wiped:\n`)
  for (const line of stashList.split("\n").slice(0, 5)) {
    process.stderr.write(`    ${line}\n`)
  }
  process.stderr.write(`  Recovery: git stash show -p "stash@{0}" | head -50\n`)
  process.stderr.write(`  Restore:  git checkout "stash@{0}" -- <files>\n\n`)
} else {
  process.stdout.write("  ✓ No stashes found\n")
}

// 2. Check for CSS coverage regressions
process.stdout.write("Checking CSS coverage (renderer classes vs CSS rules)...\n")
const cssTest = resolve(repoRoot, "src/chat/webview/css/cssCoverage.test.ts")
if (existsSync(cssTest)) {
  const result = run("npx tsx --test src/chat/webview/css/cssCoverage.test.ts 2>&1", "css coverage")
  if (result.includes("fail 0")) {
    process.stdout.write("  ✓ CSS coverage test passes\n")
  } else {
    hasIssues = true
    process.stderr.write(`  ⚠️  CSS coverage test failed — renderer classes may be missing CSS rules\n`)
    process.stderr.write(`  Run: npx tsx --test src/chat/webview/css/cssCoverage.test.ts\n\n`)
  }
} else {
  process.stdout.write("  ⊘ CSS coverage test not found (skipping)\n")
}

// 3. Check working tree status
process.stdout.write("Checking working tree status...\n")
const status = run("git status --porcelain", "git status")
if (status) {
  const lines = status.split("\n").filter(Boolean)
  process.stdout.write(`  ℹ️  ${lines.length} uncommitted file(s) in working tree\n`)
  process.stdout.write(`  Remember: commit before ending your turn (ephemeral tree)\n`)
} else {
  process.stdout.write("  ✓ Clean working tree\n")
}

process.exit(hasIssues ? 1 : 0)
