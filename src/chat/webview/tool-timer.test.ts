import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const mainSource = readFileSync(path.join(__dirname, "main.ts"), "utf8")
const cssSource = readFileSync(path.join(__dirname, "css", "blocks.css"), "utf8")

/**
 * Per-tool elapsed timers.
 *
 * Previous behaviour: when a tool finished, `unregisterToolEnd` removed the
 * `.tool-elapsed` element entirely, so users never saw final durations and the
 * surviving live timers all displayed roughly the same value (the current
 * polling tick) — making it look like every tool shared one clock.
 *
 * Fixed behaviour: on tool end the elapsed text is FROZEN to either the
 * server-reported `durationMs` or the locally-tracked wall-clock duration,
 * the pulsing animation is stopped, and the element stays in the DOM.
 */
describe("per-tool timer", () => {
  it("does not remove the .tool-elapsed element when a tool ends", () => {
    // The old code called `el.remove()` inside unregisterToolEnd; the new code
    // freezes the text instead. Find the function body and verify.
    const fnMatch = mainSource.match(/function unregisterToolEnd\([^)]*\)[^{]*\{([\s\S]*?)\n  \}/m)
    assert.ok(fnMatch, "unregisterToolEnd function must exist")
    const body = fnMatch[1]!
    assert.ok(
      !/\bel\.remove\(\)/.test(body),
      "unregisterToolEnd must not remove the elapsed element on tool end",
    )
  })

  it("freezes elapsed text using server durationMs when available", () => {
    assert.match(mainSource, /unregisterToolEnd\(result\.id,\s*result\.durationMs\)/)
  })

  it("falls back to wall-clock duration when server omits durationMs", () => {
    const fnMatch = mainSource.match(/function unregisterToolEnd\([^)]*\)[^{]*\{([\s\S]*?)\n  \}/m)!
    const body = fnMatch[1]!
    assert.match(body, /Date\.now\(\)\s*-\s*startedAt/)
  })

  it("marks the frozen element with .tool-elapsed--final for distinct styling", () => {
    const fnMatch = mainSource.match(/function unregisterToolEnd\([^)]*\)[^{]*\{([\s\S]*?)\n  \}/m)!
    const body = fnMatch[1]!
    assert.match(body, /tool-elapsed--final/)
  })

  it("CSS defines .tool-elapsed--final without the pulsing animation", () => {
    assert.match(cssSource, /\.tool-elapsed--final\s*\{[^}]*animation:\s*none/)
  })

  it("live tick uses the same formatter as the freeze (no duplicated formatting)", () => {
    // Both call sites must go through formatElapsed; otherwise drift returns.
    const callCount = (mainSource.match(/formatElapsed\(/g) ?? []).length
    assert.ok(callCount >= 2, `formatElapsed must be used for both live ticks and freeze (found ${callCount} usages)`)
  })

  it("formatElapsed handles minute-scale durations", () => {
    const fnMatch = mainSource.match(/function formatElapsed\([^)]*\)[^{]*\{([\s\S]*?)\n  \}/m)
    assert.ok(fnMatch, "formatElapsed function must exist")
    const body = fnMatch[1]!
    assert.match(body, /Math\.floor\(total\s*\/\s*60\)/, "must format minutes")
    assert.match(body, /total\s*%\s*60/, "must format seconds remainder")
  })
})
