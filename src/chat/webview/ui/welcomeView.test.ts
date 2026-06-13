import { afterEach, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { setupWelcomeActions, renderWelcomeContext, type WelcomeViewDeps } from "./welcomeView"

describe("welcomeView.ts", () => {
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

  function createDeps() {
    const dom = new JSDOM(`
      <button id="welcome-new-btn"></button>
      <div class="welcome-search-wrapper">
        <div id="welcome-search-input">
          <span class="search-icon"></span>
          <input aria-label="Search sessions" />
        </div>
      </div>
      <span id="welcome-model-ctx" role="button" tabindex="0"></span>
      <div id="welcome-recent-sessions"></div>
      <div id="welcome-greeting"></div>
    `)
    globalThis.document = dom.window.document
    globalThis.window = dom.window as unknown as typeof window

    const messages: Array<Record<string, unknown>> = []
    const renderedQueries: string[] = []
    const openModelCalls = { n: 0 }
    const deps: WelcomeViewDeps = {
      els: {
        welcomeView: document.createElement("div"),
        welcomeNewBtn: document.getElementById("welcome-new-btn") as HTMLButtonElement,
        welcomeModelCtx: document.getElementById("welcome-model-ctx"),
        welcomeContinueBtn: null,
        welcomeModelName: null,
        welcomeSearchInput: document.getElementById("welcome-search-input"),
        promptInput: document.createElement("textarea"),
        welcomeModelEmptyBanner: null,
        welcomeEmptyBannerLink: null,
      },
      postMessage: (msg) => { messages.push(msg) },
      getAllSessions: () => [],
      getState: () => ({}),
      openModelManager: () => { openModelCalls.n++ },
      sendMessage: () => {},
      renderRecentSessionsList: (query = "") => { renderedQueries.push(query) },
      hideStatusStrip: () => {},
      applyTimelineVisibility: () => {},
      autoResizeTextarea: () => {},
      updateSendButton: () => {},
      onDeleteRecentSession: (sessionId) => {
        messages.push({ type: "delete_session", targetSessionId: sessionId })
      },
    }

    setupWelcomeActions(deps)
    return { dom, deps, messages, renderedQueries, openModelCalls, input: deps.els.welcomeSearchInput!.querySelector("input")! }
  }

  it("submits the trimmed session search when Enter is pressed with no local result", () => {
    const { dom, messages, renderedQueries, input } = createDeps()

    input.value = "  hello session  "
    input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }))

    assert.deepEqual(renderedQueries, ["hello session"])
    assert.deepEqual(messages, [{ type: "list_sessions", query: "hello session" }])
  })

  it("treats the search icon as a session search button", () => {
    const { dom, messages, renderedQueries, input } = createDeps()
    const icon = document.querySelector(".search-icon") as HTMLElement

    input.value = "fix bugs"
    icon.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))

    assert.deepEqual(renderedQueries, ["fix bugs"])
    assert.deepEqual(messages, [{ type: "list_sessions", query: "fix bugs" }])
  })

  it("treats a click on the wrapper area as a session search (CSS pointer-events: none on the icon causes click target to bubble as the wrapper, not the span)", () => {
    const { dom, messages, renderedQueries, input } = createDeps()
    const wrapper = document.getElementById("welcome-search-input") as HTMLElement

    input.value = "race conditions"
    // Browsers with `pointer-events: none` on .search-icon deliver the click
    // event with `target === wrapper`. JSDOM doesn't apply CSS, so we
    // simulate the real-browser behaviour by dispatching on the wrapper.
    wrapper.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))

    assert.deepEqual(renderedQueries, ["race conditions"])
    assert.deepEqual(messages, [{ type: "list_sessions", query: "race conditions" }])
  })

  it("does NOT trigger search when the user clicks inside the input itself (lets them focus and type)", () => {
    const { dom, messages, renderedQueries, input } = createDeps()

    input.value = "anything"
    input.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))

    assert.deepEqual(renderedQueries, [])
    assert.deepEqual(messages, [])
  })

  it("debounces a host session search while typing", async () => {
    const { dom, messages, renderedQueries, input } = createDeps()

    input.value = "  pickle  "
    input.dispatchEvent(new dom.window.InputEvent("input", { bubbles: true }))

    assert.deepEqual(renderedQueries, [])
    assert.deepEqual(messages, [])

    await new Promise((resolve) => setTimeout(resolve, 175))

    assert.deepEqual(renderedQueries, ["pickle"])
    assert.deepEqual(messages, [{ type: "list_sessions", query: "pickle" }])
  })

  it("bridges recent session delete events through the supplied callback", () => {
    const { dom, messages } = createDeps()
    const recentContainer = document.getElementById("welcome-recent-sessions")!

    recentContainer.dispatchEvent(new dom.window.CustomEvent("recent-session-delete", {
      bubbles: true,
      detail: { sessionId: "sess_delete_me" },
    }))

    assert.deepEqual(messages, [{ type: "delete_session", targetSessionId: "sess_delete_me" }])
  })

  it("opens the model picker when the model chip is activated by keyboard (Enter)", () => {
    const { dom, openModelCalls, messages } = createDeps()
    const chip = document.getElementById("welcome-model-ctx")!
    chip.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    assert.equal(openModelCalls.n, 1, "Enter opens the model manager (keyboard accessible)")
    assert.deepEqual(messages, [{ type: "get_models" }])
  })

  it("opens the model picker when the model chip is activated by keyboard (Space)", () => {
    const { dom, openModelCalls } = createDeps()
    const chip = document.getElementById("welcome-model-ctx")!
    chip.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: " ", bubbles: true }))
    assert.equal(openModelCalls.n, 1, "Space opens the model manager")
  })

  it("does not open the model picker on unrelated keys", () => {
    const { dom, openModelCalls } = createDeps()
    const chip = document.getElementById("welcome-model-ctx")!
    chip.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "a", bubbles: true }))
    assert.equal(openModelCalls.n, 0)
  })
})

describe("renderWelcomeContext — search visibility", () => {
  let originalDocument: typeof globalThis.document | undefined
  let originalWindow: typeof globalThis.window | undefined
  beforeEach(() => { originalDocument = globalThis.document; originalWindow = globalThis.window })
  afterEach(() => {
    if (originalDocument) globalThis.document = originalDocument; else Reflect.deleteProperty(globalThis, "document")
    if (originalWindow) globalThis.window = originalWindow; else Reflect.deleteProperty(globalThis, "window")
  })

  function ctxDeps(sessions: Array<{ id: string; messages: Array<{ timestamp?: number }> }>): WelcomeViewDeps {
    const dom = new JSDOM(`
      <div class="welcome-search-wrapper">
        <div id="welcome-search-input"><input /></div>
      </div>
    `)
    globalThis.document = dom.window.document
    globalThis.window = dom.window as unknown as typeof window
    return {
      els: {
        welcomeView: document.createElement("div"),
        welcomeNewBtn: document.createElement("button"),
        welcomeModelCtx: null,
        welcomeContinueBtn: null,
        welcomeModelName: null,
        welcomeSearchInput: document.getElementById("welcome-search-input"),
        promptInput: document.createElement("textarea"),
        welcomeModelEmptyBanner: null,
        welcomeEmptyBannerLink: null,
      },
      postMessage: () => {},
      getAllSessions: () => sessions,
      getState: () => ({}),
      openModelManager: () => {},
      renderRecentSessionsList: () => {},
      hideStatusStrip: () => {},
      applyTimelineVisibility: () => {},
      autoResizeTextarea: () => {},
      updateSendButton: () => {},
    }
  }

  it("hides the search box for brand-new users with no sessions", () => {
    const deps = ctxDeps([])
    renderWelcomeContext(deps)
    const wrapper = document.querySelector(".welcome-search-wrapper")!
    assert.equal(wrapper.classList.contains("hidden"), true, "search hidden when there is no history")
  })

  it("shows the search box once the user has sessions with messages", () => {
    const deps = ctxDeps([{ id: "s1", messages: [{ timestamp: 1 }] }])
    renderWelcomeContext(deps)
    const wrapper = document.querySelector(".welcome-search-wrapper")!
    assert.equal(wrapper.classList.contains("hidden"), false, "search shown when history exists")
  })
})
