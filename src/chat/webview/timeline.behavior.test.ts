/**
 * Behavioral tests for the conversation timeline's interaction with
 * lazy-loaded history. Long sessions render only the most recent page of
 * messages; the timeline lists ALL turns, so it must (a) visually mark turns
 * whose DOM is not loaded, (b) route clicks on unloaded turns to a
 * load-then-scroll flow instead of failing silently, and (c) stay in sync
 * after more_messages prepends a page.
 */
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { JSDOM } from "jsdom"
import { createTimeline, type TimelineDeps } from "./timeline"
import { scrollToTurn, type ScrollMarkerDeps } from "./ui/scrollMarkers"
import type { ChatMessage } from "./types"

const mainSource = readFileSync(path.join(__dirname, "main.ts"), "utf8")

let dom: JSDOM

function setupDom() {
  dom = new JSDOM(`<!doctype html><html><body>
    <div id="welcome-view" class="hidden"></div>
    <button id="timeline-toggle-btn" aria-pressed="false"></button>
    <button id="timeline-toggle-header-btn" aria-pressed="false"></button>
    <div id="tab-panels">
      <div class="tab-panel" data-tab-id="s1">
        <div class="message-list" data-tab-id="s1"></div>
      </div>
    </div>
  </body></html>`)
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
  ;(globalThis as any).requestAnimationFrame = (cb: () => void) => { cb(); return 0 }
  ;(globalThis as any).cancelAnimationFrame = () => {}
  ;(globalThis as any).CSS = { escape: (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`) }
}

function msg(id: string, role: "user" | "assistant", text: string): ChatMessage {
  return { id, role, content: text, timestamp: 1, blocks: [{ type: "text", text }] } as unknown as ChatMessage
}

function makeDeps(overrides: Partial<TimelineDeps> = {}) {
  const messages: ChatMessage[] = [
    msg("u1", "user", "first question"),
    msg("a1", "assistant", "first answer"),
    msg("u2", "user", "second question"),
    msg("a2", "assistant", "second answer"),
  ]
  const msgList = document.querySelector<HTMLDivElement>('.message-list[data-tab-id="s1"]')!
  // Only the SECOND turn is rendered (lazy loading hid the first page).
  for (const id of ["u2", "a2"]) {
    const el = document.createElement("div")
    el.setAttribute("data-message-id", id)
    msgList.appendChild(el)
  }
  const unloadedClicks: Array<{ sessionId: string; messageId: string }> = []
  const scrolled: string[] = []
  const els = {
    timelineToggleBtn: document.getElementById("timeline-toggle-btn")!,
    timelineToggleHeaderBtn: document.getElementById("timeline-toggle-header-btn"),
    welcomeView: document.getElementById("welcome-view")!,
    tabPanels: document.getElementById("tab-panels")!,
  } as unknown as TimelineDeps["els"]
  let visible = true
  const deps: TimelineDeps = {
    els,
    getState: () => ({ sessions: {}, sessionOrder: [], activeSessionId: "s1", initialized: true } as any),
    getSession: () => ({ messages, isStreaming: false }),
    isTimelineVisible: () => visible,
    setTimelineVisible: (v: boolean) => { visible = v },
    getMessageList: () => msgList,
    scrollToTurn: (messageId: string) => {
      const found = Boolean(msgList.querySelector(`[data-message-id="${messageId}"]`))
      if (found) scrolled.push(messageId)
      return found
    },
    onUnloadedTurnClick: (sessionId: string, messageId: string) => { unloadedClicks.push({ sessionId, messageId }) },
    setThinkingVisible: () => {},
    getThinkingVisible: () => false,
    toggleAllThinkingBlocks: () => {},
    vscodeSetState: () => {},
    debouncedUpdateScrollMarkers: () => {},
    ...overrides,
  }
  return { deps, msgList, unloadedClicks, scrolled }
}

void describe("timeline + lazy-loaded history", () => {
  beforeEach(() => setupDom())

  void it("marks turns without a rendered DOM node as timeline-item--unloaded", () => {
    const { deps } = makeDeps()
    const api = createTimeline(deps)
    api.refreshConversationTimeline("s1")

    const items = Array.from(document.querySelectorAll<HTMLElement>(".timeline-item"))
    assert.equal(items.length, 2, "two turns expected")
    assert.ok(items[0]!.classList.contains("timeline-item--unloaded"), "turn 1 (u1 not in DOM) must be marked unloaded")
    assert.ok(!items[1]!.classList.contains("timeline-item--unloaded"), "turn 2 (u2 rendered) must not be marked")
  })

  void it("clicking an unloaded turn routes to onUnloadedTurnClick instead of failing silently", () => {
    const { deps, unloadedClicks, scrolled } = makeDeps()
    const api = createTimeline(deps)
    api.refreshConversationTimeline("s1")

    const items = Array.from(document.querySelectorAll<HTMLElement>(".timeline-item"))
    items[0]!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
    assert.deepEqual(unloadedClicks, [{ sessionId: "s1", messageId: "u1" }])
    assert.deepEqual(scrolled, [], "no scroll happened for the unloaded turn")

    items[1]!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
    assert.deepEqual(scrolled, ["u2"], "loaded turn scrolls normally")
    assert.equal(unloadedClicks.length, 1, "loaded turn does not invoke the unloaded handler")
  })

  void it("header toolbar toggle stays in sync with the settings-menu toggle", () => {
    const { deps } = makeDeps()
    deps.setTimelineVisible(false)
    const api = createTimeline(deps)
    api.setupTimelineToggle()

    const menuBtn = document.getElementById("timeline-toggle-btn")!
    const headerBtn = document.getElementById("timeline-toggle-header-btn")!

    headerBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
    assert.equal(menuBtn.getAttribute("aria-pressed"), "true", "menu toggle reflects header click")
    assert.equal(headerBtn.getAttribute("aria-pressed"), "true", "header toggle reflects its own click")

    menuBtn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }))
    assert.equal(headerBtn.getAttribute("aria-pressed"), "false", "header toggle reflects menu click")
  })
})

void describe("scrollToTurn load awareness", () => {
  beforeEach(() => setupDom())

  void it("returns false when the target message is not in the DOM, true when it is", () => {
    const msgList = document.querySelector<HTMLElement>('.message-list[data-tab-id="s1"]')!
    const el = document.createElement("div")
    el.setAttribute("data-message-id", "present")
    msgList.appendChild(el)
    ;(msgList as any).scrollTo = () => {}

    const deps: ScrollMarkerDeps = {
      getMessageList: () => msgList,
      getActiveMessageList: () => msgList,
      getSession: () => ({ messages: [] }),
      timers: { setTimeout: (fn: () => void, _ms: number) => setTimeout(fn, 0) },
    }
    assert.equal(scrollToTurn(deps, "present"), true)
    assert.equal(scrollToTurn(deps, "absent"), false)
  })
})

void describe("main.ts more_messages — session state + timeline sync", () => {
  void it("prepends the page into session.messages and refreshes the timeline", () => {
    const start = mainSource.indexOf('["more_messages"')
    assert.ok(start >= 0, "more_messages handler must exist")
    const block = mainSource.slice(start, mainSource.indexOf('["clear_messages"', start))
    assert.ok(
      block.includes("session.messages.unshift") || block.includes("messages.unshift"),
      "loaded page must be inserted into session.messages — the timeline and turn indexes are built from it",
    )
    assert.ok(
      block.includes("refreshConversationTimeline"),
      "timeline must refresh immediately after earlier messages load",
    )
    assert.ok(
      block.includes("pendingTimelineScroll"),
      "a pending timeline jump must be fulfilled (or chained) once the page renders",
    )
  })
})
