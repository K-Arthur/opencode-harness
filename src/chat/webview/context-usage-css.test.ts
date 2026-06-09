import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const css = readFileSync(path.join(__dirname, "css", "context-usage.css"), "utf8")

describe("context usage status strip CSS", () => {
  it("keeps the status-strip counter from overlapping adjacent controls", () => {
    assert.match(css, /#context-label\s*{[^}]*text-overflow:\s*ellipsis/s)
    assert.match(css, /#context-label\s*{[^}]*overflow:\s*hidden/s)
    assert.match(css, /\.context-usage-bar\s*{[^}]*flex:\s*0 1 auto/s)
  })

  it("uses a custom div track+fill bar instead of native progress element", () => {
    assert.match(css, /\.context-usage-track\s*{[^}]*width:\s*80px/s)
    assert.match(css, /\.context-usage-fill\s*{[^}]*transform:\s*scaleX/s)
  })

  it("gives the dropdown header a wrapping layout for long token values", () => {
    assert.match(css, /\.cup-header-row\s*{[^}]*min-width:\s*0/s)
    assert.match(css, /\.cup-summary-text\s*{[^}]*overflow-wrap:\s*anywhere/s)
  })
})
