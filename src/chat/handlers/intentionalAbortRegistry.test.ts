import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { IntentionalAbortRegistry } from "./intentionalAbortRegistry"

/**
 * Behavioral tests for the intentional-abort suppression policy.
 *
 * Replaces the previous source-string assertions in StreamCoordinator.test.ts
 * ("must include `intentionalAbortUntil`") with real behavior: an abort-category
 * error is suppressed iff it correlates to a run the user intentionally aborted.
 * Correlation is by SERVER message id (timing-independent); a self-expiring
 * per-tab window remains only as a fallback for late errors that carry no
 * correlatable id.
 */
void describe("IntentionalAbortRegistry", () => {
  const WINDOW = 8000
  const RETENTION = 120_000

  const make = () => new IntentionalAbortRegistry({ windowMs: WINDOW, retentionMs: RETENTION })

  void it("does not suppress when nothing was aborted", () => {
    const reg = make()
    assert.equal(reg.wasIntentional("tab-1", "msg_a", 1000), false)
    assert.equal(reg.wasIntentional("tab-1", undefined, 1000), false)
  })

  void it("suppresses a late abort error by server message id REGARDLESS of elapsed time", () => {
    // The core fix: the server's MessageAbortedError may land long after the
    // window would have expired (queued/slow sessions). Id correlation must
    // still suppress it — no spurious "The request was cancelled." card.
    const reg = make()
    reg.recordAbort("tab-1", "msg_a", 0)
    assert.equal(reg.wasIntentional("tab-1", "msg_a", WINDOW + 30_000), true)
  })

  void it("consumes the message-id record on match (does not suppress the same id again post-window)", () => {
    // First match is consumed; once the fallback window has also expired, the
    // same id must NOT keep suppressing — an unconsumed record would still match
    // here (retention is far longer than the window), so a `false` proves consumption.
    const reg = make()
    reg.recordAbort("tab-1", "msg_a", 0)
    assert.equal(reg.wasIntentional("tab-1", "msg_a", 100), true)
    assert.equal(reg.wasIntentional("tab-1", "msg_a", WINDOW + 100), false)
  })

  void it("correlates by message id independent of which tab is asked (ids are globally unique)", () => {
    const reg = make()
    reg.recordAbort("tab-1", "msg_a", 0)
    assert.equal(reg.wasIntentional("tab-2", "msg_a", 100), true)
  })

  void it("falls back to the per-tab window when the error carries no correlatable id", () => {
    // Abort before any server message id was observed: window is the only signal.
    const reg = make()
    reg.recordAbort("tab-1", undefined, 0)
    assert.equal(reg.wasIntentional("tab-1", undefined, WINDOW - 1), true)
    // self-expiring on read once the window passes
    assert.equal(reg.wasIntentional("tab-1", undefined, WINDOW + 1), false)
  })

  void it("window fallback applies when an id is present but unrecorded, within the window", () => {
    const reg = make()
    reg.recordAbort("tab-1", undefined, 0)
    assert.equal(reg.wasIntentional("tab-1", "msg_unknown", WINDOW - 1), true)
    assert.equal(reg.wasIntentional("tab-1", "msg_unknown", WINDOW + 1), false)
  })

  void it("does not suppress a different tab via the window", () => {
    const reg = make()
    reg.recordAbort("tab-1", undefined, 0)
    assert.equal(reg.wasIntentional("tab-2", undefined, 100), false)
  })

  void it("prunes message-id records older than the retention window on subsequent records", () => {
    const reg = make()
    reg.recordAbort("tab-1", "msg_old", 0)
    // A later abort triggers pruning of the stale entry.
    reg.recordAbort("tab-2", "msg_new", RETENTION + 1)
    assert.equal(reg.wasIntentional("tab-1", "msg_old", RETENTION + 2), false)
    assert.equal(reg.wasIntentional("tab-2", "msg_new", RETENTION + 2), true)
  })

  void it("clear() drops all windows and recorded ids", () => {
    const reg = make()
    reg.recordAbort("tab-1", "msg_a", 0)
    reg.recordAbort("tab-2", undefined, 0)
    reg.clear()
    assert.equal(reg.wasIntentional("tab-1", "msg_a", 100), false)
    assert.equal(reg.wasIntentional("tab-2", undefined, 100), false)
  })

  void it("uses sensible defaults when no options are provided", () => {
    const reg = new IntentionalAbortRegistry()
    reg.recordAbort("tab-1", undefined, 0)
    // default window is 8s
    assert.equal(reg.wasIntentional("tab-1", undefined, 7999), true)
    assert.equal(reg.wasIntentional("tab-1", undefined, 8001), false)
  })
})
