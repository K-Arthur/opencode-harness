#!/usr/bin/env node
/**
 * detect-wiped-work.mjs — Detect if uncommitted work was wiped by the
 * ephemeral working-tree process (git stash / git reset → HEAD).
 *
 * The opencode checkpoint process and other agent harnesses periodically
 * reset the working tree, moving uncommitted changes into the stash list.
 * This script checks for evidence of recent wipes and reports what was lost
 * so agents can recover it.
 *
 * Output: JSON to stdout, human-readable summary to stderr.
 * Exit code: 0 if no wipes detected, 1 if potential wipes found.
 */
import { execSync } from "node:child_process"

function git(args) {
  try {
    return execSync(`git ${args}`, { encoding: "utf8", timeout: 5000 }).trim()
  } catch {
    return ""
  }
}

function detectStashes() {
  const stashList = git("stash list")
  if (!stashList) return []

  const stashes = []
  for (const line of stashList.split("\n")) {
    if (!line.trim()) continue
    // Stash lines look like: stash@{0}: WIP on master: abc1234 ...
    // or: stash@{0}: On master: ...
    const match = line.match(/^(stash@\{\d+\}):\s*(.*)$/)
    if (!match) continue
    const [, ref, message] = match
    const files = git(`stash show --name-only "${ref}"`).split("\n").filter(Boolean)
    stashes.push({ ref, message, files })
  }
  return stashes
}

function detectRecentResets() {
  const reflog = git("reflog -20")
  if (!reflog) return []

  const resets = []
  for (const line of reflog.split("\n")) {
    if (line.includes("reset: moving to HEAD")) {
      resets.push(line.trim())
    }
  }
  return resets
}

const stashes = detectStashes()
const resets = detectRecentResets()

const result = {
  timestamp: new Date().toISOString(),
  stashesFound: stashes.length,
  stashes,
  recentResets: resets.length,
  resets,
  hasWipedWork: stashes.length > 0 || resets.length > 0,
}

if (result.hasWipedWork) {
  process.stderr.write(
    `\n⚠️  EPHEMERAL TREE: Potential wiped work detected\n` +
      `   Stashes: ${stashes.length}, Recent resets: ${resets.length}\n`
  )
  if (stashes.length > 0) {
    process.stderr.write(`   Recovery: git stash show -p "stash@{0}" | head -50\n`)
    process.stderr.write(`   Restore:  git checkout "stash@{0}" -- <files>\n\n`)
  }
}

process.stdout.write(JSON.stringify(result, null, 2) + "\n")
process.exit(result.hasWipedWork ? 1 : 0)
