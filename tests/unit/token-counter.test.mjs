import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..", "..")
const bundleDir = path.join(repoRoot, ".coverage-bundles")
const bundlePath = path.join(bundleDir, "opencode-token-counter.cjs")

function loadTokenCounter() {
  execFileSync("npx", [
    "esbuild",
    "src/utils/tokenCounter.ts",
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

test("estimateTokens returns 0 for empty string", () => {
  const { estimateTokens } = loadTokenCounter()
  assert.equal(estimateTokens(""), 0)
  assert.equal(estimateTokens(""), 0)
  assert.equal(estimateTokens(null), 0)
  assert.equal(estimateTokens(undefined), 0)
})

test("estimateTokens counts approximately 1 token per 4 chars", () => {
  const { estimateTokens } = loadTokenCounter()
  assert.equal(estimateTokens("hello"), 2)
  assert.equal(estimateTokens("a"), 1)
  assert.equal(estimateTokens("abcd"), 1)
  assert.equal(estimateTokens("abcde"), 2)
})

test("parseModelRef parses provider/model format", () => {
  const { parseModelRef } = loadTokenCounter()
  const result = parseModelRef("anthropic/claude-sonnet-4")
  assert.equal(result.providerID, "anthropic")
  assert.equal(result.modelID, "claude-sonnet-4")
})

test("parseModelRef returns empty providerID when no slash", () => {
  const { parseModelRef } = loadTokenCounter()
  const result = parseModelRef("claude-sonnet-4")
  assert.equal(result.providerID, "")
  assert.equal(result.modelID, "claude-sonnet-4")
})

test("parseModelRef handles empty model string", () => {
  const { parseModelRef } = loadTokenCounter()
  const result = parseModelRef("")
  assert.equal(result.providerID, "")
  assert.equal(result.modelID, "")
})

test("parseModelRef handles model with multiple slashes", () => {
  const { parseModelRef } = loadTokenCounter()
  const result = parseModelRef("a/b/c")
  assert.equal(result.providerID, "a")
  assert.equal(result.modelID, "b/c")
})

test("estimateContextTokens sums all context sections", () => {
  const { estimateContextTokens } = loadTokenCounter()
  const result = estimateContextTokens({
    openFiles: [
      { content: "hello world", path: "src/index.ts" },
    ],
  })
  assert.ok(result > 0)
  assert.equal(typeof result, "number")
})

test("estimateContextTokens handles empty openFiles", () => {
  const { estimateContextTokens } = loadTokenCounter()
  const result = estimateContextTokens({ openFiles: [] })
  assert.ok(result >= 0)
})

test("estimateContextTokens includes terminal output", () => {
  const { estimateContextTokens } = loadTokenCounter()
  const result = estimateContextTokens({
    openFiles: [],
    terminalOutput: { text: "Error: something failed" },
  })
  assert.ok(result > 0)
})

test("estimateContextTokens includes optional diagnostics", () => {
  const { estimateContextTokens } = loadTokenCounter()
  const result = estimateContextTokens({
    openFiles: [],
    diagnostics: [{ file: "test.ts", errors: ["fail"] }],
  })
  assert.ok(result > 0)
})
