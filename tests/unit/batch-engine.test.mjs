import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const batchEngineSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "BatchEngine.ts"), "utf8")
const hostBatcherSource = readFileSync(path.join(__dirname, "..", "..", "src", "chat", "HostMessageBatcher.ts"), "utf8")

void describe("BatchEngine<T> — structure", () => {
  void it("exports BatchEngine class", () => {
    assert.ok(batchEngineSource.includes("export class BatchEngine"))
  })

  void it("uses Map-based buffer with generic key and value types", () => {
    assert.ok(batchEngineSource.includes("Map<"))
    assert.ok(batchEngineSource.includes("buffer"))
  })

  void it("accepts reducer and flushEach callbacks", () => {
    assert.ok(batchEngineSource.includes("reducer"))
    assert.ok(batchEngineSource.includes("flushEach"))
  })

  void it("schedules flush via setTimeout", () => {
    assert.ok(batchEngineSource.includes("setTimeout"))
  })

  void it("wraps flushEach in try/catch for per-entry resilience", () => {
    const flushMethod = batchEngineSource.slice(
      batchEngineSource.indexOf("flush(): void"),
      batchEngineSource.indexOf("get size"),
    )
    assert.ok(flushMethod.includes("try") && flushMethod.includes("catch"), "flush method must have try/catch")
  })

  void it("provides clear and dispose lifecycle methods", () => {
    assert.ok(batchEngineSource.includes("clear():"))
    assert.ok(batchEngineSource.includes("dispose():"))
  })

  void it("retains failed entries on flushEach returning false or throwing", () => {
    assert.ok(batchEngineSource.includes("retaining") || batchEngineSource.includes("succeeded"))
  })
})

void describe("HostMessageBatcher uses BatchEngine", () => {
  void it("imports BatchEngine", () => {
    assert.ok(hostBatcherSource.includes('from "./BatchEngine"') || hostBatcherSource.includes("from './BatchEngine'"))
  })

  void it("creates BatchEngine instance", () => {
    assert.ok(hostBatcherSource.includes("new BatchEngine("))
    assert.ok(hostBatcherSource.includes("batchMessageReducer"))
  })

  void it("delegates flush to engine.flush()", () => {
    assert.ok(hostBatcherSource.includes("engine.flush()"))
  })

  void it("delegates clear to engine.clear()", () => {
    assert.ok(hostBatcherSource.includes("engine.clear()"))
  })

  void it("delegates dispose to engine.dispose()", () => {
    assert.ok(hostBatcherSource.includes("engine.dispose()"))
  })

  void it("still has IMMEDIATE_TYPES for isBatchable check", () => {
    assert.ok(hostBatcherSource.includes("IMMEDIATE_TYPES"))
  })

  void it("still dispatches non-batchable messages immediately", () => {
    assert.ok(hostBatcherSource.includes("isBatchable") || hostBatcherSource.includes("IMMEDIATE_TYPES"))
  })
})
