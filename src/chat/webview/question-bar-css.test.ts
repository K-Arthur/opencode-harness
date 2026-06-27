/**
 * CSS-convention tests for the pending-question panel (#question-bar).
 * Mirrors the repo's source-grep CSS lint style.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const read = (f: string) => readFileSync(path.join(__dirname, "css", f), "utf8")
const bar = read("question-bar.css")
const messages = read("messages.css")
const styles = read("styles.css")

describe("question-bar CSS conventions", () => {
  it("question-bar.css is registered in the components layer", () => {
    assert.match(styles, /question-bar\.css.*layer\(components\)/)
  })

  it("is themed via design tokens / --vscode-* fallbacks (no bare brand hardcodes)", () => {
    assert.ok(bar.includes("var(--"), "must use CSS variables")
    assert.ok(bar.includes("--vscode-"), "must provide --vscode-* fallbacks for theming")
  })

  it("selection feedback is not color-only (a check glyph marks the choice)", () => {
    assert.match(bar, /\.question-bar-option\.selected/, "selected state must be styled")
    assert.match(bar, /\.question-bar-option\.selected::before[\s\S]*?content:\s*''/, "selected adds a non-color cue via CSS-drawn checkmark")
  })

  it("never pushes the composer off-screen — bounded height with internal scroll", () => {
    assert.match(bar, /#question-bar[\s\S]*?max-height:/, "panel is height-bounded")
    assert.match(bar, /\.question-bar-items[\s\S]*?overflow-y:\s*auto/, "items scroll internally")
  })

  it("interactive controls are keyboard-visible (focus-visible rings)", () => {
    assert.match(bar, /\.question-bar-option:focus-visible/)
    assert.match(bar, /\.question-bar-submit-btn:focus-visible/)
  })

  it("respects prefers-reduced-motion", () => {
    assert.match(bar, /prefers-reduced-motion[\s\S]*?#question-bar[\s\S]*?animation:\s*none/)
  })

  it("the transcript shows a passive pointer, not interactive controls", () => {
    assert.match(messages, /\.question-block-pointer/, "transcript pointer styling present")
    assert.ok(!/\.question-submit\b/.test(messages), "inline transcript submit styling removed")
    assert.ok(!/\.question-option\b/.test(messages), "inline transcript option styling removed")
  })
})
