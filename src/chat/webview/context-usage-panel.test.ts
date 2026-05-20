import { beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"

describe("context usage panel", () => {
  beforeEach(() => {
    // Markup mirrors the real ids defined in index.html so we test against the
    // same DOM the production webview targets. The progress element is a real
    // <progress>, not a styled <div>.
    const dom = new JSDOM(`<!doctype html>
      <div id="context-usage" class="hidden">
        <progress id="context-progress-bar" max="100" value="0"></progress>
        <span id="context-label" class="context-usage-label">0%</span>
        <span id="context-cost" class="context-cost hidden"></span>
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
    ;(globalThis as any).HTMLProgressElement = dom.window.HTMLProgressElement
    ;(globalThis as any).vscode = { postMessage() {} }
  })

  it("clears stale cost display when usage becomes unavailable", async () => {
    const { setupContextUsagePanel, handleContextUsageMessage } = await import("./context-usage-panel")
    setupContextUsagePanel()

    handleContextUsageMessage({
      type: "context_usage",
      tokens: 0,
      maxTokens: 200_000,
      percent: 0,
    })

    const bar = document.getElementById("context-usage")
    const cost = document.getElementById("context-cost")

    assert.ok(bar?.classList.contains("hidden"))
    assert.ok(cost?.classList.contains("hidden"))
    assert.equal(cost?.textContent, "")
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

  it("hides the bar when maxTokens is 0 (unknown context window)", async () => {
    // Regression: previously the bar rendered "X / 0" or "X / 100,000" when
    // the model's context window hadn't resolved. We now hide the bar until
    // both tokens and maxTokens are known.
    const { setupContextUsagePanel, handleContextUsageMessage } = await import("./context-usage-panel")
    setupContextUsagePanel()

    handleContextUsageMessage({
      type: "context_usage",
      tokens: 1500,
      maxTokens: 0, // model context window not yet resolved
      percent: 0,
    })

    const bar = document.getElementById("context-usage")
    assert.ok(bar?.classList.contains("hidden"), "bar must be hidden when maxTokens is 0")
  })

  it("resets context usage panel on tab switch", async () => {
    const { resetContextUsagePanel, handleContextUsageMessage } = await import("./context-usage-panel")

    // First, set some usage data
    handleContextUsageMessage({
      type: "context_usage",
      tokens: 1000,
      maxTokens: 200_000,
      percent: 50,
      cost: 0.5,
    })

    const bar = document.getElementById("context-usage")
    const progressBar = document.getElementById("context-progress-bar") as HTMLProgressElement | null
    const label = document.getElementById("context-label")
    const cost = document.getElementById("context-cost")

    assert.ok(!bar?.classList.contains("hidden"), "bar should be visible after non-zero usage")
    assert.equal(label?.textContent, "1,000 / 200,000")
    assert.equal(progressBar?.value, 50)
    assert.equal(cost?.textContent, "$0.5000")

    // Reset the panel
    resetContextUsagePanel()

    assert.ok(bar?.classList.contains("hidden"), "bar should be hidden after reset")
    assert.equal(progressBar?.value, 0, "progress bar should be zeroed")
    assert.equal(label?.textContent, "0%", "label should be cleared to default")
    assert.equal(cost?.textContent, "")
    assert.ok(cost?.classList.contains("hidden"))
  })
})
