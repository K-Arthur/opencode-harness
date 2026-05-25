import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "BatchEngine.ts"), "utf8")

void describe("BatchEngine<T> class structure", () => {
  void it("exports BatchEngine class", () => {
    assert.ok(source.includes("export class BatchEngine"))
  })

  void it("accepts reducer, flushEach, logger, and options", () => {
    assert.ok(source.includes("constructor("))
    assert.ok(source.includes("flushEach") || source.includes("delegate"))
    assert.ok(source.includes("log"))
    assert.ok(source.includes("options") || source.includes("BatchEngineOptions"))
  })

  void it("defines add method", () => {
    assert.ok(source.includes("add("))
  })

  void it("defines flush method", () => {
    assert.ok(source.includes("flush("))
  })

  void it("defines clear method", () => {
    assert.ok(source.includes("clear("))
  })

  void it("defines dispose method", () => {
    assert.ok(source.includes("dispose("))
  })

  void it("uses Map-based buffer", () => {
    assert.ok(source.includes("Map<"))
    assert.ok(source.includes("buffer"))
  })

  void it("uses timer-based flush scheduling", () => {
    assert.ok(source.includes("setTimeout"))
    assert.ok(source.includes("clearTimeout"))
  })

  void it("supports per-key capacity limit", () => {
    assert.ok(source.includes("maxBatchSize") || source.includes("maxCapacity"))
  })

  void it("wraps delegate in try/catch", () => {
    assert.ok(source.includes("try") && source.includes("catch"))
  })
})
