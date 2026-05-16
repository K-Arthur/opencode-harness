import { beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"

describe("context usage panel", () => {
  beforeEach(() => {
    const dom = new JSDOM(`<!doctype html>
      <div id="context-usage-bar">
        <div id="context-usage-progress-bar" style="width: 60%"></div>
        <span id="context-usage-detail">12 / 20</span>
        <span id="context-usage-cost">$1.2300</span>
      </div>
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

  it("clears stale cost display when usage becomes unavailable", async () => {
    const { setupContextUsagePanel } = await import("./context-usage-panel")
    setupContextUsagePanel()

    window.dispatchEvent(new window.MessageEvent("message", {
      data: {
        type: "context_usage",
        tokens: 0,
        maxTokens: 200_000,
        percent: 0,
      },
    }))

    const bar = document.getElementById("context-usage-bar")
    const cost = document.getElementById("context-usage-cost")

    assert.ok(bar?.classList.contains("hidden"))
    assert.ok(cost?.classList.contains("hidden"))
    assert.equal(cost?.textContent, "")
  })

  it("does not render NaN or Infinity widths for an empty breakdown", async () => {
    const { setupContextUsagePanel, setContextUsagePanel } = await import("./context-usage-panel")
    const panel = document.getElementById("panel")
    assert.ok(panel)
    setContextUsagePanel(panel)
    setupContextUsagePanel()

    window.dispatchEvent(new window.MessageEvent("message", {
      data: {
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
      },
    }))

    const html = panel.querySelector(".context-breakdown-section")?.innerHTML ?? ""
    assert.ok(!html.includes("NaN"))
    assert.ok(!html.includes("Infinity"))
  })
})
