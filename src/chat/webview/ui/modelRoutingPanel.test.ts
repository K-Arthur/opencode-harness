import { afterEach, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { createModelRoutingPanel, type ModelRoutingDeps } from "./modelRoutingPanel"
import type { ModelInfo } from "../types"

describe("modelRoutingPanel.ts", () => {
  let originalDocument: typeof globalThis.document | undefined
  let originalWindow: typeof globalThis.window | undefined

  beforeEach(() => {
    originalDocument = globalThis.document
    originalWindow = globalThis.window
  })

  afterEach(() => {
    if (originalDocument) globalThis.document = originalDocument
    else Reflect.deleteProperty(globalThis, "document")
    if (originalWindow) globalThis.window = originalWindow
    else Reflect.deleteProperty(globalThis, "window")
  })

  function createDeps(overrides: Partial<ModelRoutingDeps> = {}) {
    const dom = new JSDOM(`
      <div id="model-routing-panel" class="hidden">
        <button id="model-routing-close"></button>
        <button id="model-routing-close-btn"></button>
        <button id="model-routing-reset"></button>
        <div id="model-routing-body">
          <input type="checkbox" id="model-routing-enabled-checkbox" checked>
          <div id="model-routing-list"></div>
          <div id="model-routing-global">
            <span id="model-routing-global-value"></span>
          </div>
          <div id="model-routing-status" class="hidden"></div>
        </div>
      </div>
    `)
    globalThis.document = dom.window.document
    globalThis.window = dom.window as unknown as typeof window
    ;(globalThis as any).HTMLElement = dom.window.HTMLElement

    const posted: Array<Record<string, unknown>> = []
    const models: ModelInfo[] = [
      { id: "claude-sonnet-5", provider: "anthropic", displayName: "Claude Sonnet 5" },
      { id: "gpt-5", provider: "openai", displayName: "GPT-5" },
    ]

    const els = {
      modelRoutingPanel: document.getElementById("model-routing-panel") as HTMLElement,
      modelRoutingClose: document.getElementById("model-routing-close") as HTMLElement,
      modelRoutingCloseBtn: document.getElementById("model-routing-close-btn") as HTMLElement,
      modelRoutingReset: document.getElementById("model-routing-reset") as HTMLElement,
      modelRoutingBody: document.getElementById("model-routing-body") as HTMLElement,
      modelRoutingList: document.getElementById("model-routing-list") as HTMLElement,
      modelRoutingGlobal: document.getElementById("model-routing-global") as HTMLElement,
      modelRoutingGlobalValue: document.getElementById("model-routing-global-value") as HTMLElement,
      modelRoutingStatus: document.getElementById("model-routing-status") as HTMLElement,
      modelRoutingEnabledCheckbox: document.getElementById("model-routing-enabled-checkbox") as HTMLInputElement,
    }

    const deps: ModelRoutingDeps = {
      els,
      vscode: { postMessage: (msg) => posted.push(msg) },
      getModels: () => models,
      getRoleModels: () => ({}),
      getModeModels: () => ({}),
      getGlobalModel: () => "anthropic/claude-sonnet-5",
      getSessionModel: () => undefined,
      getRoutingEnabled: () => true,
      ...overrides,
    }

    return { deps, els, posted, dom }
  }

  it("populates each phase's select with an Auto option plus every available model", () => {
    const { deps } = createDeps()
    const panel = createModelRoutingPanel(deps)
    panel.open()

    const selects = Array.from(document.querySelectorAll<HTMLSelectElement>(".model-routing-row-select"))
    assert.equal(selects.length, 4, "one select per orchestration phase")
    for (const select of selects) {
      const values = Array.from(select.options).map((o) => o.value)
      assert.deepEqual(values, ["", "anthropic/claude-sonnet-5", "openai/gpt-5"])
    }
  })

  it("selecting a model in a phase's dropdown updates pending state and the fallback label", () => {
    const { deps } = createDeps()
    const panel = createModelRoutingPanel(deps)
    panel.open()

    const select = document.getElementById("model-routing-input-review") as HTMLSelectElement
    select.value = "openai/gpt-5"
    select.dispatchEvent(new (globalThis.window as any).Event("change", { bubbles: true }))

    const row = document.querySelector('[data-role-id="review"]')!
    const fallback = row.querySelector(".model-routing-row-fallback") as HTMLElement
    assert.ok(fallback.textContent?.includes("Overrides default: openai/gpt-5"))
    assert.ok(fallback.className.includes("model-routing-row-fallback--overridden"))
  })

  it("keeps a previously-saved model selectable even if it's no longer in the available list", () => {
    const { deps } = createDeps({ getRoleModels: () => ({ debugging: "mistral/removed-model" }) })
    const panel = createModelRoutingPanel(deps)
    panel.open()

    const select = document.getElementById("model-routing-input-debugging") as HTMLSelectElement
    assert.equal(select.value, "mistral/removed-model")
    assert.ok(
      Array.from(select.options).some((o) => o.value === "mistral/removed-model" && o.textContent?.includes("not in available models")),
      "stale selection must render as its own labeled option instead of silently resetting to Auto"
    )
  })

  it("the master toggle disables every phase select and is included in the saved payload", () => {
    const { deps, els, posted } = createDeps()
    const panel = createModelRoutingPanel(deps)
    panel.open()

    els.modelRoutingEnabledCheckbox.checked = false
    els.modelRoutingEnabledCheckbox.dispatchEvent(new (globalThis.window as any).Event("change", { bubbles: true }))

    assert.ok(document.getElementById("model-routing-list")!.classList.contains("model-routing-list--disabled"))
    for (const select of document.querySelectorAll<HTMLSelectElement>(".model-routing-row-select")) {
      assert.equal(select.disabled, true)
    }

    ;(document.getElementById("model-routing-close-btn") as HTMLElement).dispatchEvent(new (globalThis.window as any).Event("click", { bubbles: true }))
    assert.deepEqual(posted, [{ type: "set_role_models", roleModels: {}, enabled: false }])
  })

  it("applyConfig re-renders an already-open panel with the host's saved config instead of leaving it blank", () => {
    const { deps, els } = createDeps({ getRoleModels: () => ({}), getRoutingEnabled: () => true })
    const panel = createModelRoutingPanel(deps)
    panel.open()

    // Before the host reply arrives, the panel opened with whatever the
    // synchronous getters returned (empty here) — simulating the async
    // get_role_models round trip.
    panel.applyConfig({ roleModels: { planning: "anthropic/claude-sonnet-5" }, modeModels: {}, enabled: false })

    const select = document.getElementById("model-routing-input-planning") as HTMLSelectElement
    assert.equal(select.value, "anthropic/claude-sonnet-5")
    assert.equal(els.modelRoutingEnabledCheckbox.checked, false)
    assert.ok(document.getElementById("model-routing-list")!.classList.contains("model-routing-list--disabled"))
  })

  it("reset all clears every phase override without touching the master switch", () => {
    const { deps, els, posted } = createDeps({ getRoleModels: () => ({ review: "openai/gpt-5" }) })
    const panel = createModelRoutingPanel(deps)
    panel.open()

    ;(document.getElementById("model-routing-reset") as HTMLElement).dispatchEvent(new (globalThis.window as any).Event("click", { bubbles: true }))
    const select = document.getElementById("model-routing-input-review") as HTMLSelectElement
    assert.equal(select.value, "")

    ;(document.getElementById("model-routing-close-btn") as HTMLElement).dispatchEvent(new (globalThis.window as any).Event("click", { bubbles: true }))
    assert.deepEqual(posted, [{ type: "set_role_models", roleModels: {}, enabled: true }])
    assert.equal(els.modelRoutingEnabledCheckbox.checked, true)
  })
})
