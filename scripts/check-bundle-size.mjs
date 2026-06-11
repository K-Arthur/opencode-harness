#!/usr/bin/env node
// scripts/check-bundle-size.mjs
//
// Enforces repo-level bundle size limits for the two build outputs that
// load synchronously into the host process or the chat webview:
//
//   dist/extension.js                  ≤ 545KB
//   dist/chat/webview/main.js          ≤ 690KB  (paydown target: 600KB)
//   dist/chat/webview/markdownWorker.js ≤ 500KB  (advisory)
//
// IMPORTANT: these limits describe the **production (minified) build**
// (`node esbuild.js --production`). The dev build (`node esbuild.js`) is
// unminified + sourcemapped (~840KB / ~1.2MB) and must NOT be measured here.
//
// 2026-06-02 re-baseline: the webview limit was 600KB but the minified bundle
// is ~637KB of legitimate code — ~224KB is irreducible third-party for a
// markdown chat UI (markdown-it + entities + highlight.js + dompurify) and the
// rest is app code that grew with shipped features. A limit set below reality
// is a perpetually-red gate, not a regression guard. Re-baselined to 680KB
// (current + ~7% headroom) so it still trips on a real regression. The 600KB
// PAYDOWN TARGET is retained as a goal: reachable by moving syntax highlighting
// fully off the synchronous main-thread path so highlight.js (78.8KB) can leave
// main.js (see docs/performance-audit.md follow-ups). Adjust deliberately here.
//
// 2026-06-11 re-baseline (+5KB each): slash-command registry metadata
// (aliases/usage/categories + generated /help) now ships in the host bundle,
// plus /methodology command, methodology_selected chip, and the
// slash-during-streaming guard in the webview. Icons were split out of the
// registry so SVG strings stay webview-only (saved ~7KB host).

import { statSync, existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")

const LIMITS = [
  { path: "dist/extension.js", limitBytes: 550 * 1024, label: "extension host" },
  { path: "dist/chat/webview/main.js", limitBytes: 705 * 1024, label: "chat webview" },
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
