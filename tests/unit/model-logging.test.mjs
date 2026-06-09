import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const managerSource = readFileSync(path.join(__dirname, "..", "..", "src", "model", "ModelManager.ts"), "utf8")
const resolverSource = readFileSync(path.join(__dirname, "..", "..", "src", "model", "contextWindowResolver.ts"), "utf8")

describe("T1.3 — Activation log noise reduction", () => {
  it("tracks unresolved context window count with a counter", () => {
    assert.ok(managerSource.includes("unresolvedContextWindowCount"), "must track unresolved context window count")
    assert.ok(managerSource.includes("let unresolvedContextWindowCount = 0"), "must initialize counter")
  })

  it("uses log.debug for per-model context window misses", () => {
    assert.ok(managerSource.includes("log: (msg) => log.debug(msg)"), "must use debug level for per-model log")
  })

  it("increments counter when contextWindow is undefined", () => {
    assert.ok(managerSource.includes("if (ctx === undefined) unresolvedContextWindowCount++"), "must increment counter on undefined context")
  })

  it("emits one summary INFO line with count of unresolved models", () => {
    assert.ok(managerSource.includes("unresolvedContextWindowCount > 0"), "must check for unresolved count before summary")
    assert.ok(managerSource.includes("without limit.context"), "summary must mention missing limit.context")
    assert.ok(managerSource.includes("no models.dev / OpenRouter match"), "summary must mention both fallbacks")
  })
})
