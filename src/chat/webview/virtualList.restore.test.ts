/**
 * Behavioral guards for VirtualMessageList detach/restore lifecycle.
 *
 * Two problems pinned here (found in the 2026-06-11 two-session-lag audit):
 *
 * 1. RESTORE-ON-SCROLLBACK WAS DEAD. detachMessage() unobserved the message
 *    element and explicitly did NOT observe the placeholder that replaced it,
 *    so the IntersectionObserver could never fire for a pruned message again
 *    and restoreOne() was unreachable from scrolling. Scrolling back through
 *    history showed permanent fixed-height empty boxes. The bug was masked by
 *    resume_session_data's dispose→restoreAll→recreate cycle, which re-rendered
 *    EVERY detached message synchronously on each session resume — the masking
 *    itself being a major session-switch cost.
 *
 * 2. DISPOSE ALWAYS PAID restoreAll(). dispose() unconditionally re-rendered
 *    every detached message — even on tab close / session delete / DOM rebuild,
 *    where the container is discarded immediately afterwards. dispose() now
 *    takes { restoreDom: false } for those paths.
 */
import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"

import { VirtualMessageList } from "./virtualList"
import type { ChatMessage, SessionState } from "./types"

let rafQueue: Array<() => void> = []
let ioCallback: ((entries: Array<{ target: Element; isIntersecting: boolean }>) => void) | null = null
let observed: Set<Element>

function rect(top: number, bottom: number): DOMRect {
  return {
    top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top,
    toJSON() { return {} },
  } as DOMRect
}

function setupDom(): void {
  const dom = new JSDOM(`<!DOCTYPE html><body><div id="scroll"><div id="list"></div></div></body>`)
  const win = dom.window
  const g = globalThis as unknown as Record<string, unknown>
  g.document = win.document
  g.window = win as unknown as Window
  g.HTMLElement = win.HTMLElement
  g.Element = win.Element

  rafQueue = []
  g.requestAnimationFrame = (cb: () => void) => { rafQueue.push(cb); return rafQueue.length }
  g.cancelAnimationFrame = () => {}

  observed = new Set()
  ioCallback = null
  g.IntersectionObserver = class {
    constructor(cb: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void) { ioCallback = cb }
    observe(el: Element): void { observed.add(el) }
    unobserve(el: Element): void { observed.delete(el) }
    disconnect(): void { observed.clear() }
    takeRecords(): [] { return [] }
  }

  win.Element.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
    if (this.id === "scroll") return rect(0, 600)
    const top = Number(this.dataset?.top ?? "0")
    return rect(top, top + 80)
  }
  Object.defineProperty(win.HTMLElement.prototype, "offsetHeight", { configurable: true, get() { return 80 } })
  const realMatches = win.Element.prototype.matches
  // TS 6's lib.dom types `matches` as an overloaded type predicate; this test
  // stub is a plain boolean probe, so assert it back to the member's own type.
  win.Element.prototype.matches = function (this: Element, sel: string): boolean {
    if (sel === ":focus-within") return false
    return realMatches.call(this, sel)
  } as typeof win.Element.prototype.matches
}

function flushRaf(): void {
  const q = rafQueue
  rafQueue = []
  q.forEach((cb) => cb())
}

function teardownDom(): void {
  const g = globalThis as unknown as Record<string, unknown>
  for (const key of ["document", "window", "HTMLElement", "Element", "IntersectionObserver", "requestAnimationFrame", "cancelAnimationFrame"]) {
    delete g[key]
  }
  ioCallback = null
}

function buildTranscript(n: number, visibleStartIdx: number): { list: HTMLElement; messages: ChatMessage[] } {
  const list = document.getElementById("list") as HTMLElement
  const messages: ChatMessage[] = []
  for (let i = 0; i < n; i++) {
    const el = document.createElement("div")
    el.className = "message-bubble"
    el.dataset.messageId = `m${i}`
    el.dataset.top = String((i - visibleStartIdx) * 100)
    el.textContent = `msg ${i}`
    list.appendChild(el)
    messages.push({ role: "assistant", id: `m${i}`, blocks: [{ type: "text", text: "x" }], timestamp: i })
  }
  return { list, messages }
}

interface Harness {
  vl: VirtualMessageList
  list: HTMLElement
  messages: ChatMessage[]
  renderCalls: () => number
}

function buildPrunedList(): Harness {
  const N = 240
  const visibleStartIdx = 100
  const { list, messages } = buildTranscript(N, visibleStartIdx)
  const session: SessionState = { id: "s1", name: "S", model: "", mode: "build", messages, isStreaming: false }
  let renders = 0
  const vl = new VirtualMessageList(
    "s1",
    list,
    (id) => messages.find((m) => m.id === id),
    () => session,
    (m) => {
      renders++
      const d = document.createElement("div")
      d.className = "message-bubble"
      d.dataset.messageId = m.id
      return d as HTMLDivElement
    },
    () => {},
  )
  vl.start()
  const visibleEls = messages
    .slice(visibleStartIdx, visibleStartIdx + 7)
    .map((m) => list.querySelector(`[data-message-id="${m.id}"]`)!)
  ioCallback!(visibleEls.map((target) => ({ target, isIntersecting: true })))
  flushRaf() // pruneOffScreen

  const placeholders = list.querySelectorAll(".msg-placeholder").length
  assert.ok(placeholders > 0, `setup must produce pruned placeholders (got ${placeholders})`)
  return { vl, list, messages, renderCalls: () => renders }
}

void describe("VirtualMessageList — restore on scrollback", () => {
  beforeEach(setupDom)
  afterEach(teardownDom)

  void it("observes placeholders so pruned messages can come back into view", () => {
    const { list } = buildPrunedList()
    const placeholder = list.querySelector(".msg-placeholder") as HTMLElement
    assert.ok(
      observed.has(placeholder),
      "placeholder must be observed by the IntersectionObserver — otherwise restoreOne is unreachable and scrollback shows empty boxes forever",
    )
  })

  void it("re-renders a pruned message when its placeholder intersects the viewport", () => {
    const { list, renderCalls } = buildPrunedList()
    const placeholder = list.querySelector(".msg-placeholder") as HTMLElement
    const msgId = placeholder.dataset.messageId!
    const before = renderCalls()

    ioCallback!([{ target: placeholder, isIntersecting: true }])

    const restored = list.querySelector(`[data-message-id="${msgId}"]`) as HTMLElement
    assert.ok(restored, "an element for the message must exist after restore")
    assert.ok(!restored.classList.contains("msg-placeholder"), "the placeholder must be replaced by the real message")
    assert.equal(renderCalls(), before + 1, "exactly one render for the restored message")
    assert.ok(observed.has(restored), "the restored element must be observed again")
  })
})

void describe("VirtualMessageList — dispose cost control", () => {
  beforeEach(setupDom)
  afterEach(teardownDom)

  void it("dispose({ restoreDom: false }) discards placeholders without re-rendering", () => {
    const { vl, renderCalls } = buildPrunedList()
    const before = renderCalls()
    vl.dispose({ restoreDom: false })
    assert.equal(
      renderCalls(),
      before,
      "tab-close / DOM-rebuild dispose must not synchronously re-render every detached message",
    )
  })

  void it("dispose() default still restores detached messages (back-compat)", () => {
    const { vl, list, renderCalls } = buildPrunedList()
    const before = renderCalls()
    const placeholdersBefore = list.querySelectorAll(".msg-placeholder").length
    vl.dispose()
    assert.ok(renderCalls() > before, "default dispose keeps restoreAll semantics")
    assert.equal(list.querySelectorAll(".msg-placeholder").length, 0, "no placeholders left after restoring dispose")
    assert.ok(placeholdersBefore > 0)
  })
})
