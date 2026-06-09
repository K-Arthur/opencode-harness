import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { JSDOM } from "jsdom"
import { updateContextBarFromSession, type TokenCostDeps } from "./tokenCostDisplay"

const source = readFileSync(path.join(__dirname, "tokenCostDisplay.ts"), "utf8")

describe("tokenCostDisplay context status UI", () => {
  it("renders authoritative context usage as a bounded percent chip", () => {
    assert.ok(source.includes("context-label"), "must target the context-label element")
    assert.ok(source.includes("context-progress-fill"), "must target the custom progress fill")
    assert.ok(source.includes("buildSummaryText"), "must keep token/limit detail in tooltip text")
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

  it("renders long model names and large context values into bounded status-strip slots", () => {
    const dom = new JSDOM(`<!doctype html><body>
      <div id="status-strip" hidden>
        <span id="status-tokens"></span>
        <span id="status-model"></span>
        <div id="context-usage" class="context-usage-bar hidden">
          <div id="context-progress-track" class="context-usage-track">
            <div id="context-progress-fill" class="context-usage-fill"></div>
          </div>
          <span id="context-label"></span>
          <span id="context-cost" class="context-cost hidden"></span>
        </div>
        <span id="status-cost" class="hidden"></span>
      </div>
      <div id="quota-bar"></div>
      <div id="quota-progress-bar"></div>
      <div id="quota-label"></div>
      <div id="quota-detail"></div>
    </body>`)
    const doc = dom.window.document
    const longModel = "provider/supercalifragilistic-context-rendering-model-with-a-very-long-suffix"
    const statusStrip = doc.getElementById("status-strip")!
    const contextUsage = doc.getElementById("context-usage")!
    const contextLabel = doc.getElementById("context-label")!
    const contextFill = doc.getElementById("context-progress-fill")!
    const contextCost = doc.getElementById("context-cost")!
    const statusModel = doc.getElementById("status-model")!
    const statusCost = doc.getElementById("status-cost")!

    const deps: TokenCostDeps = {
      els: {
        tokenDisplay: null,
        statusTokens: doc.getElementById("status-tokens")!,
        statusModel,
        costDisplay: null,
        statusCost,
        contextUsage,
        statusStrip,
        quotaBar: doc.getElementById("quota-bar")!,
        quotaProgressBar: doc.getElementById("quota-progress-bar")!,
        quotaLabel: doc.getElementById("quota-label")!,
        quotaDetail: doc.getElementById("quota-detail")!,
      },
      getSession: () => ({
        model: longModel,
        cost: 12.3456,
        tokenUsage: { prompt: 900_000_000, completion: 87_654_321, total: 987_654_321 },
        contextUsage: { percent: 98.7654321, tokens: 987_654_321, maxTokens: 1_000_000_000 },
      }),
      getActiveSessionId: () => "session-a",
      save: () => {},
      getContextWindow: () => 1_000_000_000,
      showStatusStrip: () => statusStrip.removeAttribute("hidden"),
      getActiveMessageList: () => null,
      timers: { setTimeout },
    }

    updateContextBarFromSession(deps, "session-a")

    assert.equal(statusStrip.hasAttribute("hidden"), false)
    assert.equal(contextUsage.classList.contains("hidden"), false)
    assert.equal(statusModel.textContent, "supercalifragilistic-context-rendering-model-with-a-very-long-suffix")
    assert.equal(contextLabel.textContent, "98.8% used")
    assert.ok((contextLabel.getAttribute("title") ?? "").includes("987,654,321 / 1,000,000,000"))
    assert.equal(contextFill.style.getPropertyValue("--usage-pct"), "0.987654321")
    assert.equal(contextCost.textContent, "$12.3456")
    assert.equal(contextCost.classList.contains("hidden"), false)
    assert.equal(contextUsage.querySelector("#context-label"), contextLabel)
  })

  it("does not fabricate context usage from cumulative token spend", () => {
    const dom = new JSDOM(`<!doctype html><body>
      <div id="status-strip" hidden>
        <span id="status-tokens"></span>
        <span id="status-model"></span>
        <div id="context-usage" class="context-usage-bar hidden">
          <span id="context-label"></span>
          <span id="context-cost" class="context-cost hidden"></span>
        </div>
        <span id="status-cost" class="hidden"></span>
      </div>
      <div id="quota-bar"></div>
      <div id="quota-progress-bar"></div>
      <div id="quota-label"></div>
      <div id="quota-detail"></div>
    </body>`)
    const doc = dom.window.document
    const deps: TokenCostDeps = {
      els: {
        tokenDisplay: null,
        statusTokens: doc.getElementById("status-tokens")!,
        statusModel: doc.getElementById("status-model")!,
        costDisplay: null,
        statusCost: doc.getElementById("status-cost")!,
        contextUsage: doc.getElementById("context-usage")!,
        statusStrip: doc.getElementById("status-strip")!,
        quotaBar: doc.getElementById("quota-bar")!,
        quotaProgressBar: doc.getElementById("quota-progress-bar")!,
        quotaLabel: doc.getElementById("quota-label")!,
        quotaDetail: doc.getElementById("quota-detail")!,
      },
      getSession: () => ({
        model: "provider/model",
        tokenUsage: { prompt: 250_000, completion: 10_000, total: 260_000 },
      }),
      getActiveSessionId: () => "session-a",
      save: () => {},
      getContextWindow: () => 1_000_000,
      showStatusStrip: () => doc.getElementById("status-strip")!.removeAttribute("hidden"),
      getActiveMessageList: () => null,
      timers: { setTimeout },
    }

    updateContextBarFromSession(deps, "session-a")

    assert.equal(doc.getElementById("context-usage")!.classList.contains("hidden"), true)
    assert.equal(doc.getElementById("status-strip")!.hasAttribute("hidden"), true)
  })

  it("keeps the context usage bar hidden while the welcome screen is visible", () => {
    // Regression guard: a session with persisted contextUsage must NEVER reveal
    // the usage bar over the welcome/empty screen. updateContextBarFromSession
    // used to remove `hidden` unconditionally; it must respect isWelcomeVisible.
    const dom = new JSDOM(`<!doctype html><body>
      <div id="status-strip" hidden>
        <span id="status-tokens"></span>
        <span id="status-model"></span>
        <div id="context-usage" class="context-usage-bar hidden">
          <div id="context-progress-track" class="context-usage-track">
            <div id="context-progress-fill" class="context-usage-fill"></div>
          </div>
          <span id="context-label"></span>
          <span id="context-cost" class="context-cost hidden"></span>
        </div>
        <span id="status-cost" class="hidden"></span>
      </div>
      <div id="quota-bar"></div>
      <div id="quota-progress-bar"></div>
      <div id="quota-label"></div>
      <div id="quota-detail"></div>
    </body>`)
    const doc = dom.window.document
    const statusStrip = doc.getElementById("status-strip")!
    const contextUsage = doc.getElementById("context-usage")!

    const deps: TokenCostDeps = {
      els: {
        tokenDisplay: null,
        statusTokens: doc.getElementById("status-tokens")!,
        statusModel: doc.getElementById("status-model")!,
        costDisplay: null,
        statusCost: doc.getElementById("status-cost")!,
        contextUsage,
        statusStrip,
        quotaBar: doc.getElementById("quota-bar")!,
        quotaProgressBar: doc.getElementById("quota-progress-bar")!,
        quotaLabel: doc.getElementById("quota-label")!,
        quotaDetail: doc.getElementById("quota-detail")!,
      },
      // Valid usage that WOULD show the bar if the welcome guard were missing.
      getSession: () => ({
        model: "provider/model",
        cost: 1.23,
        tokenUsage: { prompt: 500_000, completion: 50_000, total: 550_000 },
        contextUsage: { percent: 55, tokens: 550_000, maxTokens: 1_000_000 },
      }),
      getActiveSessionId: () => "session-a",
      save: () => {},
      getContextWindow: () => 1_000_000,
      showStatusStrip: () => statusStrip.removeAttribute("hidden"),
      getActiveMessageList: () => null,
      timers: { setTimeout },
      isWelcomeVisible: () => true,
    }

    updateContextBarFromSession(deps, "session-a")

    assert.equal(contextUsage.classList.contains("hidden"), true, "usage bar must stay hidden over the welcome screen")
    assert.equal(statusStrip.hasAttribute("hidden"), true, "status strip must stay hidden over the welcome screen")
  })

  it("still shows the context usage bar when the welcome screen is not visible", () => {
    // Counterpart: with a valid session and welcome hidden, the bar shows.
    const dom = new JSDOM(`<!doctype html><body>
      <div id="status-strip" hidden>
        <span id="status-tokens"></span>
        <span id="status-model"></span>
        <div id="context-usage" class="context-usage-bar hidden">
          <span id="context-label"></span>
          <span id="context-cost" class="context-cost hidden"></span>
        </div>
        <span id="status-cost" class="hidden"></span>
      </div>
      <div id="quota-bar"></div>
      <div id="quota-progress-bar"></div>
      <div id="quota-label"></div>
      <div id="quota-detail"></div>
    </body>`)
    const doc = dom.window.document
    const statusStrip = doc.getElementById("status-strip")!
    const contextUsage = doc.getElementById("context-usage")!

    const deps: TokenCostDeps = {
      els: {
        tokenDisplay: null,
        statusTokens: doc.getElementById("status-tokens")!,
        statusModel: doc.getElementById("status-model")!,
        costDisplay: null,
        statusCost: doc.getElementById("status-cost")!,
        contextUsage,
        statusStrip,
        quotaBar: doc.getElementById("quota-bar")!,
        quotaProgressBar: doc.getElementById("quota-progress-bar")!,
        quotaLabel: doc.getElementById("quota-label")!,
        quotaDetail: doc.getElementById("quota-detail")!,
      },
      getSession: () => ({
        model: "provider/model",
        cost: 1.23,
        tokenUsage: { prompt: 500_000, completion: 50_000, total: 550_000 },
        contextUsage: { percent: 55, tokens: 550_000, maxTokens: 1_000_000 },
      }),
      getActiveSessionId: () => "session-a",
      save: () => {},
      getContextWindow: () => 1_000_000,
      showStatusStrip: () => statusStrip.removeAttribute("hidden"),
      getActiveMessageList: () => null,
      timers: { setTimeout },
      isWelcomeVisible: () => false,
    }

    updateContextBarFromSession(deps, "session-a")

    assert.equal(contextUsage.classList.contains("hidden"), false, "usage bar should show once a session is active")
  })
})
