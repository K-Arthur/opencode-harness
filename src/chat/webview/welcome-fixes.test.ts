import { afterEach, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { renderRecentSessions } from "./recent-sessions"
import type { SessionSummary } from "./types"
import type { WelcomeViewDeps } from "./ui/welcomeView"
import { setupWelcomeActions } from "./ui/welcomeView"

describe("Welcome Page Fixes", () => {
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

  describe("Delete button dispatches recent-session-delete event", () => {
    it("dispatches a bubbling custom event with the session ID when delete is clicked", () => {
      const dom = new JSDOM(`<div id="container"></div>`)
      globalThis.document = dom.window.document
      globalThis.window = dom.window as unknown as typeof window
      globalThis.CustomEvent = dom.window.CustomEvent as typeof CustomEvent

      const container = document.getElementById("container")!
      const sessions: SessionSummary[] = [
        { id: "session-abc", title: "Test Session", time: Date.now(), messageCount: 5 },
      ]

      let capturedDetail: { sessionId: string } | null = null
      container.addEventListener("recent-session-delete", ((e: CustomEvent) => {
        capturedDetail = e.detail
      }) as EventListener)

      renderRecentSessions(
        sessions,
        container,
        () => {},
        () => {},
        false,
      )

      const deleteBtn = container.querySelector(".recent-action-btn") as HTMLButtonElement
      assert.ok(deleteBtn, "delete button must be rendered")

      deleteBtn.click()

      assert.ok(capturedDetail, "recent-session-delete event must be dispatched")
      assert.equal((capturedDetail as { sessionId: string }).sessionId, "session-abc")
    })

    it("stops propagation so the parent item click does not fire", () => {
      const dom = new JSDOM(`<div id="container"></div>`)
      globalThis.document = dom.window.document
      globalThis.window = dom.window as unknown as typeof window
      globalThis.CustomEvent = dom.window.CustomEvent as typeof CustomEvent

      const container = document.getElementById("container")!
      const sessions: SessionSummary[] = [
        { id: "session-xyz", title: "Prop Test", time: Date.now(), messageCount: 1 },
      ]

      let parentClicked = false
      renderRecentSessions(
        sessions,
        container,
        () => {},
        () => { parentClicked = true },
        false,
      )

      const deleteBtn = container.querySelector(".recent-action-btn") as HTMLButtonElement
      deleteBtn.click()

      assert.ok(!parentClicked, "parent item click handler must NOT fire when delete is clicked")
    })
  })

  describe("Welcome search triggers local filter and extension query", () => {
    it("calls renderRecentSessionsList with the search query before posting list_sessions", () => {
      const dom = new JSDOM(`
        <button id="welcome-new-btn"></button>
        <div id="welcome-search-input">
          <span class="search-icon"></span>
          <input aria-label="Search sessions" />
        </div>
        <div id="welcome-greeting"></div>
      `)
      globalThis.document = dom.window.document
      globalThis.window = dom.window as unknown as typeof window

      const messages: Array<Record<string, unknown>> = []
      const renderedQueries: string[] = []
      const deps: WelcomeViewDeps = {
        els: {
          welcomeView: document.createElement("div"),
          welcomeNewBtn: document.getElementById("welcome-new-btn") as HTMLButtonElement,
          welcomeModelCtx: null,
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
        openModelManager: () => {},
        sendMessage: () => {},
        renderRecentSessionsList: (query = "") => { renderedQueries.push(query) },
        hideStatusStrip: () => {},
        applyTimelineVisibility: () => {},
        autoResizeTextarea: () => {},
        updateSendButton: () => {},
      }

      setupWelcomeActions(deps)
      const input = deps.els.welcomeSearchInput!.querySelector("input")!

      input.value = "fix auth"
      input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }))

      assert.deepEqual(renderedQueries, ["fix auth"], "local filter must be called with query")
      assert.deepEqual(messages, [{ type: "list_sessions", query: "fix auth" }], "extension query must be posted")
    })

    it("debounces local filtering on input events", () => {
      const dom = new JSDOM(`
        <button id="welcome-new-btn"></button>
        <div id="welcome-search-input">
          <span class="search-icon"></span>
          <input aria-label="Search sessions" />
        </div>
        <div id="welcome-greeting"></div>
      `)
      globalThis.document = dom.window.document
      globalThis.window = dom.window as unknown as typeof window

      const renderedQueries: string[] = []
      const deps: WelcomeViewDeps = {
        els: {
          welcomeView: document.createElement("div"),
          welcomeNewBtn: document.getElementById("welcome-new-btn") as HTMLButtonElement,
          welcomeModelCtx: null,
          welcomeContinueBtn: null,
          welcomeModelName: null,
          welcomeSearchInput: document.getElementById("welcome-search-input"),
          promptInput: document.createElement("textarea"),
          welcomeModelEmptyBanner: null,
          welcomeEmptyBannerLink: null,
        },
        postMessage: () => {},
        getAllSessions: () => [],
        getState: () => ({}),
        openModelManager: () => {},
        sendMessage: () => {},
        renderRecentSessionsList: (query = "") => { renderedQueries.push(query) },
        hideStatusStrip: () => {},
        applyTimelineVisibility: () => {},
        autoResizeTextarea: () => {},
        updateSendButton: () => {},
      }

      setupWelcomeActions(deps)
      const input = deps.els.welcomeSearchInput!.querySelector("input")!

      input.value = "debounce test"
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }))

      assert.equal(renderedQueries.length, 0, "debounced filter must not fire immediately on input")
    })

    it("clears search on Escape key", () => {
      const dom = new JSDOM(`
        <button id="welcome-new-btn"></button>
        <div id="welcome-search-input">
          <span class="search-icon"></span>
          <input aria-label="Search sessions" />
        </div>
        <div id="welcome-greeting"></div>
      `)
      globalThis.document = dom.window.document
      globalThis.window = dom.window as unknown as typeof window

      const renderedQueries: string[] = []
      const deps: WelcomeViewDeps = {
        els: {
          welcomeView: document.createElement("div"),
          welcomeNewBtn: document.getElementById("welcome-new-btn") as HTMLButtonElement,
          welcomeModelCtx: null,
          welcomeContinueBtn: null,
          welcomeModelName: null,
          welcomeSearchInput: document.getElementById("welcome-search-input"),
          promptInput: document.createElement("textarea"),
          welcomeModelEmptyBanner: null,
          welcomeEmptyBannerLink: null,
        },
        postMessage: () => {},
        getAllSessions: () => [],
        getState: () => ({}),
        openModelManager: () => {},
        sendMessage: () => {},
        renderRecentSessionsList: (query = "") => { renderedQueries.push(query) },
        hideStatusStrip: () => {},
        applyTimelineVisibility: () => {},
        autoResizeTextarea: () => {},
        updateSendButton: () => {},
      }

      setupWelcomeActions(deps)
      const input = deps.els.welcomeSearchInput!.querySelector("input")!

      input.value = "something"
      input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }))

      assert.ok(renderedQueries.includes(""), "Escape must trigger clear with empty query")
      assert.equal(input.value, "", "Escape must clear input value")
    })
  })

  describe("Recent sessions rendering with delete buttons", () => {
    it("renders delete buttons with session IDs as data attributes", () => {
      const dom = new JSDOM(`<div id="container"></div>`)
      globalThis.document = dom.window.document
      globalThis.window = dom.window as unknown as typeof window

      const container = document.getElementById("container")!
      const sessions: SessionSummary[] = [
        { id: "s1", title: "Session 1", time: Date.now(), messageCount: 3 },
        { id: "s2", title: "Session 2", time: Date.now(), messageCount: 7 },
      ]

      renderRecentSessions(sessions, container, () => {}, () => {}, false)

      const deleteButtons = container.querySelectorAll(".recent-action-btn")
      assert.equal(deleteButtons.length, 2, "each session must have a delete button")

      const ids = Array.from(deleteButtons).map((btn) => (btn as HTMLElement).dataset.sessionId)
      assert.deepEqual(ids, ["s1", "s2"], "delete buttons must carry their session ID")
    })

    it("renders limited results (3 unfiltered, 10 filtered)", () => {
      const dom = new JSDOM(`<div id="container"></div>`)
      globalThis.document = dom.window.document
      globalThis.window = dom.window as unknown as typeof window

      const container = document.getElementById("container")!
      const sessions: SessionSummary[] = Array.from({ length: 15 }, (_, i) => ({
        id: `s${i}`,
        title: `Session ${i}`,
        time: Date.now() - i * 1000,
        messageCount: i + 1,
      }))

      renderRecentSessions(sessions, container, () => {}, () => {}, false)
      const unfiltered = container.querySelectorAll(".recent-item")
      assert.equal(unfiltered.length, 3, "unfiltered must show max 3")

      renderRecentSessions(sessions, container, () => {}, () => {}, true)
      const filtered = container.querySelectorAll(".recent-item")
      assert.equal(filtered.length, 10, "filtered must show max 10")
    })
  })
})
