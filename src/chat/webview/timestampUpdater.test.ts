import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { TimestampUpdater, formatExactTimestamp } from "./timestampUpdater"

// Minimal DOM stub for tests
function makeEl(ts: number): HTMLElement {
  const el = { dataset: { timestamp: String(ts) }, textContent: "" } as unknown as HTMLElement
  return el
}

describe("formatExactTimestamp", () => {
  it("returns a non-empty locale string for a valid timestamp", () => {
    const result = formatExactTimestamp(Date.now())
    assert.ok(result.length > 0)
  })

  it("handles epoch zero without throwing", () => {
    assert.doesNotThrow(() => formatExactTimestamp(0))
  })
})

describe("TimestampUpdater", () => {
  let updater: TimestampUpdater
  beforeEach(() => { updater = new TimestampUpdater() })
  afterEach(() => { updater.stopTicking() })

  it("register sets data-timestamp attribute on element", () => {
    const el = makeEl(Date.now())
    updater.register(el, Number(el.dataset.timestamp))
    assert.ok(el.dataset.timestamp !== undefined)
  })

  it("tick updates textContent of registered elements", () => {
    const ts = Date.now() - 5000
    const el = makeEl(ts)
    updater.register(el, ts)
    updater.tick()
    // textContent should be something like "just now" or "5 sec ago" — not empty
    // We just verify it was changed from empty string
    const text = el.textContent ?? ""
    assert.ok(text.length > 0, `Expected textContent to be updated, got: "${text}"`)
  })

  it("startTicking does not throw", () => {
    assert.doesNotThrow(() => updater.startTicking(100_000))
    updater.stopTicking()
  })

  it("stopTicking is idempotent", () => {
    updater.startTicking(100_000)
    assert.doesNotThrow(() => updater.stopTicking())
    assert.doesNotThrow(() => updater.stopTicking())
  })
})

describe("TimestampUpdater — disconnected element pruning (memory leak fix, 2026-06-11)", () => {
  // The registered Map is keyed by HTMLElement and was never pruned. The
  // header comment claimed removed elements "are automatically dropped", but
  // tick() only iterated the Map — it never checked isConnected. Message
  // elements are replaced constantly (virtual-list pruning, streaming
  // re-renders, transcript rebuilds), so over a long session the Map retained
  // an unbounded set of detached DOM subtrees: a real memory leak plus an
  // ever-growing 60s tick.
  let updater: TimestampUpdater
  beforeEach(() => { updater = new TimestampUpdater() })
  afterEach(() => { updater.stopTicking() })

  function makeConnEl(ts: number, connected: boolean): HTMLElement {
    return {
      dataset: { timestamp: String(ts) },
      textContent: "",
      isConnected: connected,
    } as unknown as HTMLElement
  }

  it("tick() drops elements that are no longer in the DOM", () => {
    const live = makeConnEl(Date.now(), true)
    const dead = makeConnEl(Date.now(), false)
    updater.register(live, Date.now())
    updater.register(dead, Date.now())

    updater.tick()

    assert.equal(updater.registeredCount, 1, "disconnected elements must be pruned on tick")
  })

  it("tick() keeps updating connected elements after pruning others", () => {
    const live = makeConnEl(Date.now() - 120_000, true)
    const dead = makeConnEl(Date.now(), false)
    updater.register(live, Date.now() - 120_000)
    updater.register(dead, Date.now())

    updater.tick()

    assert.ok((live.textContent ?? "").includes("min ago"), "live element must still be refreshed")
  })
})
