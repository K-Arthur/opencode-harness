#!/usr/bin/env node
// scripts/bundle-attribution.mjs
//
// Attributes the size of each esbuild output to the top contributing
// source files and packages, using esbuild's metafile JSON output.
//
// Usage:
//   node scripts/bundle-attribution.mjs              # all bundles
//   node scripts/bundle-attribution.mjs extension    # just one

import { execSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs"
import { resolve, dirname, basename } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, "..")
const tmpDir = resolve(repoRoot, ".bundle-meta")

const TARGETS = [
  {
    label: "extension",
    out: "dist/extension.js",
    entry: "src/extension.ts",
    platform: "node",
    external: ["vscode"],
    format: "cjs",
  },
  {
    label: "webview",
    out: "dist/chat/webview/main.js",
    entry: "src/chat/webview/main.ts",
    platform: "browser",
    format: "iife",
  },
  {
    label: "markdown-worker",
    out: "dist/chat/webview/markdownWorker.js",
    entry: "src/chat/webview/markdownWorker.ts",
    platform: "browser",
    format: "iife",
  },
]

function fmt(bytes) {
  return `${(bytes / 1024).toFixed(1)}kb`
}

function pkgOf(file) {
  // node_modules/<pkg>(/<subpath>)
  const m = file.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)
  if (m) return m[1]
  if (file.startsWith("src/")) return "src"
  if (file.startsWith("dist/")) return "dist"
  return file
}

function buildMeta(target) {
  mkdirSync(tmpDir, { recursive: true })
  const metaPath = resolve(tmpDir, `${target.label}.json`)
  const cmd = [
    "npx",
    "esbuild",
    target.entry,
    "--bundle",
    `--platform=${target.platform}`,
    `--format=${target.format}`,
    "--tree-shaking=true",
    "--minify",
    `--outfile=${target.out}`,
    `--metafile=${metaPath}`,
  ]
  if (target.external?.length) {
    for (const ext of target.external) cmd.push(`--external:${ext}`)
  }
  execSync(cmd.join(" "), { cwd: repoRoot, stdio: ["ignore", "ignore", "inherit"] })
  return JSON.parse(readFileSync(metaPath, "utf8"))
}

function attributeOutputs(meta) {
  // meta.outputs has each output file; each has an `inputs` map: inputPath -> {bytesInOutput}
  // Aggregate input paths across all outputs and per-package totals.
  const perInput = new Map()
  for (const out of Object.values(meta.outputs)) {
    if (!out.inputs) continue
    for (const [inputPath, info] of Object.entries(out.inputs)) {
      perInput.set(inputPath, (perInput.get(inputPath) ?? 0) + (info.bytesInOutput || 0))
    }
  }
  const perPkg = new Map()
  for (const [inputPath, bytes] of perInput) {
    const pkg = pkgOf(inputPath)
    perPkg.set(pkg, (perPkg.get(pkg) ?? 0) + bytes)
  }
  return { perInput, perPkg }
}

function topN(map, n = 15) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
}

function labelFilter(filter) {
  return TARGETS.filter((t) => !filter || t.label === filter)
}

function report(target) {
  const meta = buildMeta(target)
  const { perInput, perPkg } = attributeOutputs(meta)
  const totalOut = Object.values(meta.outputs).reduce((acc, o) => acc + (o.bytes || 0), 0)
  console.log(`\n━━━ ${target.label} (${target.out}) — total ${fmt(totalOut)} ━━━`)
  console.log("Top packages:")
  for (const [pkg, bytes] of topN(perPkg, 12)) {
    const pct = ((bytes / totalOut) * 100).toFixed(1)
    console.log(`  ${fmt(bytes).padStart(8)}  ${pct.padStart(5)}%  ${pkg}`)
  }
  console.log("Top source files:")
  for (const [file, bytes] of topN(perInput, 12)) {
    const pct = ((bytes / totalOut) * 100).toFixed(1)
    console.log(`  ${fmt(bytes).padStart(8)}  ${pct.padStart(5)}%  ${file}`)
  }
}

const filter = process.argv[2]
for (const target of labelFilter(filter)) {
  report(target)
}
