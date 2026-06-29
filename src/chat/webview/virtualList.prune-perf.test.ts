/**
 * Performance regression guard for VirtualMessageList.pruneOffScreen.
 *
 * The "lag that grows the longer two sessions stream" report traced to this:
 * pruneOffScreen measured EVERY message element with getBoundingClientRect() on
 * every IntersectionObserver callback to recompute the visible window. Because
 * the IntersectionObserver fires on every auto-scroll during streaming (~10/s)
 * and the detached placeholders ALSO carry data-message-id, the forced
 * synchronous layout scaled with the full accumulated transcript — an O(N)
 * layout flush many times a second, getting worse as history grew.
 *
 * The observer already knows what is on screen, so the rect scan is redundant.
 * This test pins the cost: a single prune over a large transcript must perform a
 * BOUNDED number of layout-forcing getBoundingClientRect() reads, independent of
 * the message count. (Per-element offsetHeight reads during detach are a
 * one-time, bounded-per-prune cost and are not what this guards.)
 */
import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"

import { VirtualMessageList } from "./virtualList"
import type { ChatMessage, SessionState } from "./types"

let rafQueue: Array<() => void> = []
let gbcrCalls = 0
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

  // Count layout-forcing reads. The scroll parent reports a 600px viewport; each
  // message reports a top derived from data-top so a fixed window sits in [0,600].
  gbcrCalls = 0
  win.Element.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
    gbcrCalls++
    if (this.id === "scroll") return rect(0, 600)
    const top = Number(this.dataset?.top ?? "0")
    return rect(top, top + 80)
  }
  // offsetHeight backs placeholder sizing during detach (bounded per prune).
  Object.defineProperty(win.HTMLElement.prototype, "offsetHeight", { configurable: true, get() { return 80 } })
  // jsdom's nwsapi rejects :focus-within in some versions; the prune path probes
  // it via matches(). Make it a benign "false" so the test exercises the loop.
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

// Restore the process globals this suite installs so it cannot leak JSDOM
// state into unrelated test files sharing the same `node --test` process — the
// pollution pattern that makes the webview suite order-dependent. A fresh JSDOM
// is built per test, so simply dropping the globals is sufficient.
function teardownDom(): void {
  const g = globalThis as unknown as Record<string, unknown>
  for (const key of ["document", "window", "HTMLElement", "Element", "IntersectionObserver", "requestAnimationFrame", "cancelAnimationFrame"]) {
    delete g[key]
  }
  ioCallback = null
}

function buildTranscript(n: number, visibleStartIdx: number): {
  list: HTMLElement
  messages: ChatMessage[]
} {
  const list = document.getElementById("list") as HTMLElement
  const messages: ChatMessage[] = []
  for (let i = 0; i < n; i++) {
    const el = document.createElement("div")
    el.className = "message-bubble"
    el.dataset.messageId = `m${i}`
    // Lay messages 100px apart; the window [visibleStartIdx .. +6] lands in [0,600].
    el.dataset.top = String((i - visibleStartIdx) * 100)
    el.textContent = `msg ${i}`
    list.appendChild(el)
    messages.push({ role: "assistant", id: `m${i}`, blocks: [{ type: "text", text: "x" }], timestamp: i })
  }
  return { list, messages }
}

void describe("VirtualMessageList.pruneOffScreen layout cost", () => {
  beforeEach(setupDom)
  afterEach(teardownDom)

  void it("performs a bounded number of layout reads regardless of transcript size", () => {
    const N = 240
    const visibleStartIdx = 100
    const { list, messages } = buildTranscript(N, visibleStartIdx)

    const session: SessionState = {
      id: "s1", name: "S", model: "", mode: "build", messages, isStreaming: false,
    }
    const vl = new VirtualMessageList(
      "s1",
      list,
      (id) => messages.find((m) => m.id === id),
      () => session,
      (m) => {
        const d = document.createElement("div")
        d.dataset.messageId = m.id
        return d as HTMLDivElement
      },
      () => {},
    )
    vl.start()

    // Drive the observer: messages 100..106 are on screen. This both populates
    // the observer's intersection state AND (for the old impl) is consistent with
    // the rect window, so a prune actually happens in either implementation.
    const visibleEls = messages
      .slice(visibleStartIdx, visibleStartIdx + 7)
      .map((m) => list.querySelector(`[data-message-id="${m.id}"]`)!)
    ioCallback!(visibleEls.map((target) => ({ target, isIntersecting: true })))

    // Reset the counter so we measure ONLY the prune pass (not start()/observe()).
    gbcrCalls = 0
    flushRaf() // runs pruneOffScreen

    // Sanity: the prune must have actually detached off-screen messages, otherwise
    // the assertion below is vacuous.
    const remaining = list.querySelectorAll("[data-message-id]:not(.msg-placeholder)").length
    assert.ok(remaining < N, `prune must detach some messages (remaining=${remaining}, N=${N})`)

    // The guard: layout reads must be bounded by a small constant, NOT ~N.
    // Old impl scans every message → ~N+1 reads. New impl derives the window from
    // the observer → a small constant.
    assert.ok(
      gbcrCalls <= 12,
      `pruneOffScreen forced ${gbcrCalls} getBoundingClientRect reads for N=${N} messages — must be bounded (<=12), not O(N)`,
    )
  })
})
