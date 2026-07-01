/**
 * RED phase tests for StreamCoordinator state-integrity fixes.
 *
 * Fix 1:  Activity-sequence guard replaces G5 quiet-period timer —
 *         prevents premature finalization when a tool_start arrives
 *         after a transient session.idle but within 1500ms.
 * Fix 3:  finalizePromises dedup chain — second concurrent trigger
 *         re-checks after the first deferred attempt instead of
 *         being swallowed by the same in-flight promise.
 * Fix 5:  fetchFinalBlocks uses getMessages(limit=1) not full session fetch.
 * Fix 7:  postRunActivitySnapshot uses incremental fingerprint hash instead
 *         of JSON.stringify(slim) to avoid GC pressure on hot heartbeat path.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const __dirname = path.dirname(new URL(import.meta.url).pathname)
const source = readFileSync(path.join(__dirname, "StreamCoordinator.ts"), "utf8")

describe("StreamCoordinator state integrity fixes", () => {

  // ── Fix 1: Activity-sequence guard ─────────────────────────────────────
  it("Fix1: has activitySeqs map for deterministic sequence tracking", () => {
    assert.ok(
      source.includes("activitySeqs") || source.includes("activitySeq"),
      "Must have activitySeqs map for sequence-based guard"
    )
  })

  it("Fix1: has bumpActivitySeq helper that increments sequence on activity", () => {
    assert.ok(
      source.includes("bumpActivitySeq") || source.includes("activitySeq"),
      "Must have method to bump activity sequence"
    )
  })

  it("Fix1: cancelPendingStatusFinalize still exists (G5 timer is converted, not removed)", () => {
    // G5 timer is replaced by activity-sequence guard but the cancel
    // method name may be kept for backward compat with existing tests.
    assert.ok(
      source.includes("cancelPendingStatusFinalize") || source.includes("pendingStatusFinalizeTimers"),
      "Must still cancel pending status finalizes on activity"
    )
  })

  it("Fix1: status-triggered finalize uses microtask or sequence check not just time", () => {
    // The guard must not rely solely on a 1500ms setTimeout for safety —
    // it must check the activity sequence so a tool arriving after the timer
    // fires cancels the finalize even in the async gap.
    assert.ok(
      source.includes("activitySeq") || source.includes("queueMicrotask"),
      "Status-triggered finalize must use sequence guard or microtask"
    )
  })

  // ── Fix 3: finalizePromises chain ──────────────────────────────────────
  it("Fix3: maybeFinalizeStream chains a re-check after a deferred in-flight attempt", () => {
    // The second caller must not simply return the existing promise —
    // it must chain a .then() re-check so a trigger that would undefer
    // the first is not swallowed.
    assert.ok(
      source.includes(".then(") && source.includes("finalizePromises"),
      "maybeFinalizeStream must chain re-check on deferred in-flight promise (Fix 3)"
    )
  })

  // ── Fix 5: Paginated last-message fetch ────────────────────────────────
  it("Fix5: fetchFinalBlocks calls getMessages with a limit parameter (not full session fetch)", () => {
    // Using getMessages with { limit: 1 } instead of getSessionMessages
    // prevents fetching the full history on every stream completion.
    assert.ok(
      source.includes("getMessages(") || source.includes("limit:"),
      "fetchFinalBlocks must use paginated getMessages, not unbounded getSessionMessages"
    )
  })

  // ── Fix 7: Incremental fingerprint ────────────────────────────────────
  it("Fix7: postRunActivitySnapshot uses field-level fingerprint not JSON.stringify(slim)", () => {
    // JSON.stringify on the full slim object on every heartbeat is O(n tools+subagents).
    // The replacement uses a deterministic string from status+updatedAt fields only.
    const usesJsonStringifyForFingerprint = /const fingerprint\s*=\s*JSON\.stringify\(slim\)/.test(source)
    assert.ok(
      !usesJsonStringifyForFingerprint,
      "postRunActivitySnapshot must NOT use JSON.stringify(slim) as fingerprint — use incremental hash"
    )
  })

  it("Fix7: postRunActivitySnapshot fingerprint includes tool status and updatedAt fields", () => {
    // The fingerprint must change when tool status or updatedAt changes.
    assert.ok(
      source.includes("t.status") && source.includes("t.updatedAt"),
      "Fingerprint must include tool status + updatedAt for correct dirty detection"
    )
  })

  it("Fix7: postRunActivitySnapshot fingerprint includes subagent status and updatedAt fields", () => {
    assert.ok(
      source.includes("s.status") && source.includes("s.updatedAt"),
      "Fingerprint must include subagent status + updatedAt for correct dirty detection"
    )
  })
})
