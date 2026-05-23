import { beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"

describe("context usage panel", () => {
  beforeEach(() => {
    // Markup mirrors the real ids defined in index.html for the context-usage-panel modal
    const dom = new JSDOM(`<!doctype html>
      <section id="panel">
        <div class="context-breakdown-section"></div>
        <div class="projected-section"></div>
        <div class="cost-section"><p class="cost-display">Current Cost: $1.2300</p></div>
      </section>
    `)

    ;(globalThis as any).window = dom.window
    ;(globalThis as any).document = dom.window.document
    ;(globalThis as any).HTMLElement = dom.window.HTMLElement
    ;(globalThis as any).vscode = { postMessage() {} }
  })

  it("does not render NaN or Infinity widths for an empty breakdown", async () => {
    const { setupContextUsagePanel, setContextUsagePanel, handleContextUsageMessage } = await import("./context-usage-panel")
    const panel = document.getElementById("panel")
    assert.ok(panel)
    setContextUsagePanel(panel)
    setupContextUsagePanel()

    handleContextUsageMessage({
      type: "context_usage",
      tokens: 10,
      maxTokens: 200_000,
      percent: 0.005,
      breakdown: {
        system: 0,
        history: 0,
        workspace: 0,
        queued: 0,
        steer: 0,
      },
    })

    const html = panel.querySelector(".context-breakdown-section")?.innerHTML ?? ""
    assert.ok(!html.includes("NaN"))
    assert.ok(!html.includes("Infinity"))
  })
})
