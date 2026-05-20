import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = readFileSync(resolve(__dirname, "SessionLifecycleService.ts"), "utf8")

void describe("SessionLifecycleService.ts", () => {
  void it("exports SessionLifecycleService class", () => {
    assert.ok(source.includes("export class SessionLifecycleService"), "SessionLifecycleService class must be exported")
  })

  void it("has handleResumeSession method", () => {
    assert.ok(source.includes("async handleResumeSession("), "must have handleResumeSession")
  })

  void describe("Fix A: always refresh messages from server on resume", () => {
    const handleIdx = source.indexOf("async handleResumeSession(")
    const handleBlock = source.slice(handleIdx, source.indexOf("async handleAttachFiles(", handleIdx))

    void it("always fetches messages from server on resume regardless of needsBackfill", () => {
      assert.ok(
        handleBlock.includes("getSessionMessages"),
        "handleResumeSession must call getSessionMessages on every resume, not just when needsBackfill is true"
      )
    })

    void it("updates local store when server has more messages than local", () => {
      assert.ok(
        handleBlock.includes("applyBackfilledMessages"),
        "handleResumeSession must call applyBackfilledMessages when server returns fresher data"
      )
    })
  })

  void describe("Fix D: no destructive close on empty backfill", () => {
    const handleIdx = source.indexOf("async handleResumeSession(")
    const handleBlock = source.slice(handleIdx, source.indexOf("async handleAttachFiles(", handleIdx))

    void it("does not close tab when server returns empty messages", () => {
      assert.ok(
        !handleBlock.includes("closeTab") || handleBlock.indexOf("closeTab") === -1,
        "handleResumeSession must NOT close the tab when backfill returns 0 messages — server may be lazy-loading"
      )
    })

    void it("does not clear existing messages when server returns empty", () => {
      assert.ok(
        !handleBlock.includes("applyBackfilledMessages(session.id, [])"),
        "handleResumeSession must NOT call applyBackfilledMessages with empty array — this deletes needsBackfill and wipes existing data"
      )
    })

    void it("keeps needsBackfill set when server returns empty so retries work", () => {
      const emptyPath = handleBlock.includes("messages.length === 0") || handleBlock.includes("messages.length > 0")
      assert.ok(
        !handleBlock.includes("applyBackfilledMessages(session.id, [])"),
        "must not call applyBackfilledMessages with empty array which deletes needsBackfill"
      )
    })
  })

  void describe("Stage 1: Model preservation during session restoration", () => {
    const ensureIdx = source.indexOf("ensureLocalTab(")
    const ensureBlock = source.slice(ensureIdx, source.indexOf("async openSessionInWebview(", ensureIdx))

    void it("preserves session model when restoring session", () => {
      assert.ok(
        ensureBlock.includes("storeSession.model || model"),
        "ensureLocalTab must preserve session model when it exists"
      )
    })

    void it("uses session model for tab creation when available", () => {
      assert.ok(
        ensureBlock.includes("nextModel") && ensureBlock.includes("createTab"),
        "ensureLocalTab must use preserved model when creating tab"
      )
    })

    void it("updates tab model if session model differs from current", () => {
      assert.ok(
        ensureBlock.includes("tab.model !== nextModel") && ensureBlock.includes("setModel"),
        "ensureLocalTab must update tab model when session model differs"
      )
    })
  })
})
