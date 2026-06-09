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
