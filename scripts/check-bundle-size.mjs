#!/usr/bin/env node
// scripts/check-bundle-size.mjs
//
// Enforces repo-level bundle size limits for the two build outputs that
// load synchronously into the host process or the chat webview:
//
//   dist/extension.js                  ≤ 795KB (host)
//   dist/chat/webview/main.js          ≤ 838KB (chat webview)
//   dist/chat/webview/markdownWorker.js ≤ 500KB (advisory)
//
// IMPORTANT: these limits describe the **production (minified) build**
// (`node esbuild.js --production`). The dev build (`node esbuild.js`) is
// unminified + sourcemapped (~840KB / ~1.2MB) and must NOT be measured here.
//
// 2026-07-27 re-baseline (host 791KB -> 795KB): the host limit had almost no
// headroom (789.9KB actual / 791KB limit), so routine Dependabot patch/minor
// bumps of host-side runtime deps (e.g. @opencode-ai/sdk, bundled directly
// into dist/extension.js) trip the gate on version-string-only diffs with no
// app code change — confirmed by building against @opencode-ai/sdk 1.18.7
// (791.3KB, over the old limit) vs 1.17.11 (789.9KB). +4KB gives ~0.75%
// slack for that class of change while still catching real regressions.
//
// Re-baseline history is kept in git log — run `git log --all -p -- scripts/check-bundle-size.mjs`.

import { statSync, existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")

const LIMITS = [
  { path: "dist/extension.js", limitBytes: 800 * 1024, label: "extension host" },
  { path: "dist/chat/webview/main.js", limitBytes: 842 * 1024, label: "chat webview" },
  { path: "dist/chat/webview/markdownWorker.js", limitBytes: 500 * 1024, label: "markdown worker", advisory: true },
]

function fmt(bytes) {
  return `${(bytes / 1024).toFixed(1)}kb`
}

let failed = 0
for (const { path, limitBytes, label, advisory } of LIMITS) {
  const abs = resolve(repoRoot, path)
  if (!existsSync(abs)) {
    console.error(`[bundle-size] ✗ ${label}: ${path} not found (run \`npm run build\` first)`)
    failed++
    continue
  }
  const { size } = statSync(abs)
  const over = size > limitBytes
  const marker = over ? (advisory ? "⚠" : "✗") : "✓"
  const line = `[bundle-size] ${marker} ${label.padEnd(18)} ${path.padEnd(36)} ${fmt(size).padStart(8)} / ${fmt(limitBytes).padStart(8)}${advisory ? " (advisory)" : ""}`
  if (over) {
    console.error(line)
    if (!advisory) failed++
  } else {
    console.log(line)
  }
}

if (failed > 0) {
  console.error(`\n[bundle-size] ${failed} bundle(s) over the limit. Run \`node scripts/bundle-attribution.mjs\` to see what dominates.`)
  process.exit(1)
}
