import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "tokenCostDisplay.ts"), "utf8")

describe("tokenCostDisplay context status UI", () => {
  it("renders context as percent plus tokens/limit instead of overwriting the strip root", () => {
    assert.ok(source.includes("context-label"), "must target the context-label element")
    assert.ok(source.includes("context-progress-bar"), "must target the progress element")
    assert.ok(source.includes("tokens /"), "must render tokens/limit detail text")
    assert.ok(
      !source.includes("ctxBar.textContent = `${totalApiTokens.toLocaleString()} / ${contextWindow.toLocaleString()} tok (${pct}%)`"),
      "must not replace the context bar children with root textContent",
    )
  })

  it("shows model name and session cost alongside context usage", () => {
    assert.ok(source.includes("statusModel"), "must update the status model label")
    assert.ok(source.includes("statusCost"), "must update the session cost label")
    assert.ok(source.includes("showStatusStrip()"), "context/status updates must reveal the status strip")
  })
})
