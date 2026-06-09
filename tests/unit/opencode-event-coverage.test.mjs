import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..", "..")
const bundleDir = path.join(repoRoot, ".coverage-bundles")
const bundlePath = path.join(bundleDir, "opencode-event-coverage.cjs")

function loadCoverage() {
  mkdirSync(bundleDir, { recursive: true })
  execFileSync("npx", [
    "esbuild",
    "src/session/eventCoverage.ts",
    "--bundle",
    "--platform=node",
    "--format=cjs",
    `--outfile=${bundlePath}`,
  ], {
    cwd: repoRoot,
    stdio: "pipe",
  })

  delete createRequire(import.meta.url).cache?.[bundlePath]
  return createRequire(import.meta.url)(bundlePath)
}

function eventTypesFrom(file) {
  const src = readFileSync(path.join(repoRoot, file), "utf8")
  const eventUnion = src.match(/export type Event = ([^;]+);/)?.[1] ?? ""
  const typeNames = eventUnion.split("|").map((s) => s.trim()).filter(Boolean)
  const out = []
  for (const typeName of typeNames) {
    const escaped = typeName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const match = src.match(new RegExp(`export type ${escaped} = \\{[\\s\\S]*?type: "([^"]+)"`))
    if (match?.[1]) out.push(match[1])
  }
  return Array.from(new Set(out)).sort()
}

function partTypesFrom(file) {
  const src = readFileSync(path.join(repoRoot, file), "utf8")
  const out = []
  for (const match of src.matchAll(/type: "([^"]+)"/g)) {
    const type = match[1]
    if ([
      "text",
      "reasoning",
      "file",
      "tool",
      "step-start",
      "step-finish",
      "snapshot",
      "patch",
      "agent",
      "retry",
      "compaction",
      "subtask",
    ].includes(type)) {
      out.push(type)
    }
  }
  return Array.from(new Set(out)).sort()
}

test("SDK v1/v2 event types are handled or explicitly safe-ignored", () => {
  const coverage = loadCoverage()
  const classified = new Set([
    ...coverage.HANDLED_EVENT_TYPES,
    ...coverage.SAFE_IGNORED_EVENT_TYPES,
  ])
  const sdkTypes = [
    ...eventTypesFrom("node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts"),
    ...eventTypesFrom("node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts"),
  ]
  const missing = Array.from(new Set(sdkTypes)).filter((type) => !classified.has(type))
  assert.deepEqual(missing, [])
})

test("SDK v1/v2 part types are handled or explicitly safe-ignored", () => {
  const coverage = loadCoverage()
  const classified = new Set([
    ...coverage.HANDLED_PART_TYPES,
    ...coverage.SAFE_IGNORED_PART_TYPES,
  ])
  const sdkTypes = [
    ...partTypesFrom("node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts"),
    ...partTypesFrom("node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts"),
  ]
  const missing = Array.from(new Set(sdkTypes)).filter((type) => !classified.has(type))
  assert.deepEqual(missing, [])
})
