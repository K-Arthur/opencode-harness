import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const timerSource = readFileSync(path.join(__dirname, "ui", "toolElapsed.ts"), "utf8")
const mainSource = readFileSync(path.join(__dirname, "main.ts"), "utf8")
const cssSource = readFileSync(path.join(__dirname, "css", "blocks.css"), "utf8")

describe("per-tool timer", () => {
  it("does not remove the .tool-elapsed element when a tool ends", () => {
    const fnMatch = timerSource.match(/unregisterEnd\([^)]*\)[^{]*\{([\s\S]*?)\n  \}/m)
    assert.ok(fnMatch, "unregisterEnd function must exist")
    const body = fnMatch[1]!
    assert.ok(
      !/\bel\.remove\(\)/.test(body),
      "unregisterEnd must not remove the elapsed element on tool end",
    )
  })

  it("freezes elapsed text using server durationMs when available", () => {
    assert.match(mainSource, /toolElapsedTracker\.unregisterEnd\(result\.id,\s*result\.durationMs\)/)
  })

  it("falls back to wall-clock duration when server omits durationMs", () => {
    const fnMatch = timerSource.match(/unregisterEnd\([^)]*\)[^{]*\{([\s\S]*?)\n  \}/m)!
    const body = fnMatch[1]!
    assert.match(body, /Date\.now\(\)\s*-\s*startedAt/)
  })

  it("marks the frozen element with .tool-elapsed--final for distinct styling", () => {
    const fnMatch = timerSource.match(/unregisterEnd\([^)]*\)[^{]*\{([\s\S]*?)\n  \}/m)!
    const body = fnMatch[1]!
    assert.match(body, /tool-elapsed--final/)
  })

  it("CSS defines .tool-elapsed--final without the pulsing animation", () => {
    assert.match(cssSource, /\.tool-elapsed--final\s*\{[^}]*animation:\s*none/)
  })

  it("live tick uses the same formatter as the freeze (no duplicated formatting)", () => {
    const callCount = (timerSource.match(/formatElapsed\(/g) ?? []).length
    assert.ok(callCount >= 2, `formatElapsed must be used for both live ticks and freeze (found ${callCount} usages)`)
  })

  it("formatElapsed handles minute-scale durations", () => {
    const fnMatch = timerSource.match(/function formatElapsed\([^)]*\)[^{]*\{([\s\S]*?)\n\}/m)
    assert.ok(fnMatch, "formatElapsed function must exist")
    const body = fnMatch[1]!
    assert.match(body, /Math\.floor\(total\s*\/\s*60\)/, "must format minutes")
    assert.match(body, /total\s*%\s*60/, "must format seconds remainder")
  })
})
