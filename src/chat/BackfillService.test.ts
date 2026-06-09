import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, "BackfillService.ts"), "utf8")

void describe("BackfillService", () => {
  void describe("structure", () => {
    void it("exports BackfillService class", () => {
      assert.ok(source.includes("export class BackfillService"), "must export BackfillService")
    })

    void it("accepts dependencies via constructor", () => {
      assert.ok(source.includes("constructor(private readonly deps: BackfillDeps)"), "must use deps pattern")
      assert.ok(source.includes("sessionStore"), "must depend on sessionStore")
      assert.ok(source.includes("tabManager"), "must depend on tabManager")
      assert.ok(source.includes("getSessionMessages"), "must depend on getSessionMessages callback")
      assert.ok(source.includes("pushInitState"), "must depend on pushInitState callback")
      assert.ok(source.includes("postSessionListUpdate"), "must depend on postSessionListUpdate callback")
    })

    void it("has dispose method that clears retry timer", () => {
      assert.ok(source.includes("dispose()"), "must have dispose method")
      assert.ok(source.includes("clearTimeout(this.backfillRetryTimer)"), "must clear retry timer on dispose")
    })
  })

  void describe("backfillRecoveredSessions", () => {
    void it("exists as async method", () => {
      assert.ok(source.includes("async backfillRecoveredSessions("), "must be async")
    })

    void it("filters sessions needing backfill", () => {
      assert.ok(source.includes("needsBackfill === true"), "must check needsBackfill flag")
      assert.ok(source.includes("cliSessionId"), "must check cliSessionId exists")
      assert.ok(source.includes("isLocalPlaceholderSessionId"), "must skip placeholder ids")
      assert.ok(source.includes("messages.length === 0"), "must check empty messages")
    })

    void it("uses parallel execution with concurrency cap", () => {
      assert.ok(source.includes("Promise.allSettled"), "must use Promise.allSettled")
      assert.ok(source.includes("BACKFILL_CONCURRENCY"), "must use concurrency cap")
    })

    void it("guards against concurrent backfill per session", () => {
      assert.ok(source.includes("backfillInProgress.has"), "must check in-progress Set")
      assert.ok(source.includes("backfillInProgress.add"), "must add to in-progress Set")
      assert.ok(source.includes("backfillInProgress.delete"), "must remove in finally block")
    })

    void it("calls applyBackfilledMessages and autoTitleFromMessages", () => {
      assert.ok(source.includes("applyBackfilledMessages"), "must apply backfilled messages")
      assert.ok(source.includes("autoTitleFromMessages"), "must auto-title from messages")
    })

    void it("logs debug for empty responses", () => {
      assert.ok(source.includes("log.debug"), "must use log.debug for empty responses")
    })

    void it("emits backfill summary", () => {
      assert.ok(source.includes("Backfill summary"), "must emit summary log")
      assert.ok(source.includes("succeeded"), "must include succeeded count")
      assert.ok(source.includes("pending"), "must include pending count")
    })
  })

  void describe("scheduleBackfillRetry", () => {
    void it("exists and uses exponential backoff delays", () => {
      assert.ok(source.includes("scheduleBackfillRetry("), "must exist")
      assert.ok(source.includes("BACKFILL_RETRY_DELAYS_MS"), "must use retry delay array")
    })

    void it("has at least 4 retry delays", () => {
      const match = source.match(/BACKFILL_RETRY_DELAYS_MS\s*=\s*\[([^\]]+)\]/)
      assert.ok(match, "must find BACKFILL_RETRY_DELAYS_MS array")
      const count = (match[1]!.match(/\d+/g) || []).length
      assert.ok(count >= 4, `must have at least 4 delays, found ${count}`)
    })

    void it("clears needsBackfill after max retries", () => {
      assert.ok(source.includes("clearNeedsBackfill"), "must clear needsBackfill after giving up")
    })
  })

  void describe("backfillTabIfNeeded", () => {
    void it("exists as async method", () => {
      assert.ok(source.includes("async backfillTabIfNeeded("), "must be async")
    })

    void it("skips sessions with messages unless needsBackfill is set", () => {
      const idx = source.indexOf("async backfillTabIfNeeded(")
      assert.ok(idx >= 0)
      const block = source.slice(idx, idx + 1200)
      assert.ok(block.includes("messages.length > 0") && block.includes("needsBackfill"))
    })

    void it("skips streaming tabs", () => {
      const idx = source.indexOf("async backfillTabIfNeeded(")
      const block = source.slice(idx, idx + 1200)
      assert.ok(block.includes("isStreaming"), "must check isStreaming flag")
    })
  })

  void describe("hydration state", () => {
    void it("tracks restoredTabsHydrated via isHydrated getter", () => {
      assert.ok(source.includes("get isHydrated"), "must have isHydrated getter")
      assert.ok(source.includes("setHydrated("), "must have setHydrated setter")
    })
  })
})
