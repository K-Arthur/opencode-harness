import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "scrollAnchor.ts"), "utf8")

describe("scrollAnchor.ts", () => {
  it("exports createScrollAnchor", () => {
    assert.ok(source.includes("export function createScrollAnchor"))
  })

  it("exports ScrollAnchor interface", () => {
    assert.ok(source.includes("export interface ScrollAnchor"))
  })

  it("has ANCHOR_THRESHOLD of 80", () => {
    assert.ok(source.includes("ANCHOR_THRESHOLD = 80"))
  })

  it("exposes a pauseForReflow method so callers can briefly suspend autoscroll during layout changes", () => {
    assert.ok(
      source.includes("pauseForReflow(ms: number"),
      "ScrollAnchor interface must declare pauseForReflow(ms: number): void",
    )
    assert.ok(
      source.includes("pauseForReflow(ms: number = DEFAULT_REFLOW_PAUSE_MS)"),
      "pauseForReflow implementation must exist with a default",
    )
    assert.ok(
      source.includes("reflowPausedUntil"),
      "pauseForReflow must be backed by a reflowPausedUntil timestamp",
    )
    // The guard is what makes sidebar toggles safe during streaming.
    assert.ok(
      /if \(performance\.now\(\)\s*<\s*reflowPausedUntil\) return/.test(source),
      "scrollIfAnchored must early-return while a reflow pause is in effect",
    )
  })

  it("uses an IntersectionObserver sentinel as the primary at-bottom signal (research synthesis)", () => {
    assert.ok(
      source.includes("IntersectionObserver"),
      "createScrollAnchor must wire an IntersectionObserver for robust at-bottom detection",
    )
    assert.ok(
      source.includes('dataset.scrollSentinel = "1"'),
      "Sentinel element must be tagged with data-scroll-sentinel for observability",
    )
    assert.ok(
      source.includes("observer.observe(sentinel)"),
      "Observer must actually observe the sentinel element",
    )
    assert.ok(
      source.includes("observer.disconnect()"),
      "dispose() must disconnect the IntersectionObserver to avoid leaks",
    )
  })

  it("degrades gracefully if IntersectionObserver is unavailable (older webview)", () => {
    assert.ok(
      /typeof IntersectionObserver !== "undefined"/.test(source) || /typeof IntersectionObserver !== 'undefined'/.test(source),
      "Feature-detect IntersectionObserver before constructing",
    )
    // The createScrollAnchor call must remain functional without the observer;
    // the scroll/wheel/touch listeners are the fallback.
    assert.ok(
      source.includes("// IntersectionObserver unavailable"),
      "Missing-observer branch must be documented as a fallback, not an error",
    )
  })

  it("has container property", () => {
    assert.ok(source.includes("readonly container: HTMLElement"))
  })

  it("has isAnchored property", () => {
    assert.ok(source.includes("readonly isAnchored: boolean"))
  })

  it("has anchor method", () => {
    assert.ok(source.includes("anchor(): void"))
  })

  it("has scrollIfAnchored method", () => {
    assert.ok(source.includes("scrollIfAnchored(): void"))
  })

  it("has pause method", () => {
    assert.ok(source.includes("pause(): void"))
  })

  it("has resume method", () => {
    assert.ok(source.includes("resume(): void"))
  })

  it("has dispose method", () => {
    assert.ok(source.includes("dispose(): void"))
  })
})
