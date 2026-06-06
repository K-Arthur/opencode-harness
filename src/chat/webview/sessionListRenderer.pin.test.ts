/**
 * DOM tests for session pinning in the unified session list (sessionListRenderer.ts):
 * pinned-first ordering, the pin toggle button + posted message, and the
 * always-visible pinned marker.
 */
import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import {
  setSessionListPostMessage,
  setUnifiedLocalSessions,
  setUnifiedServerSessions,
  setUnifiedSessionQuery,
  renderUnifiedSessionList,
} from "./sessionListRenderer"

let warn: typeof console.warn
function setupDom() {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="session-modal" class="hidden"></div>
    <div id="session-modal-body"><div class="modal-session-list"></div></div>
  </body></html>`)
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
  ;(globalThis as any).MouseEvent = dom.window.MouseEvent
  // getElementRefs() warns for unrelated missing elements — silence the noise.
  warn = console.warn
  console.warn = () => {}
}

function rowNames(): string[] {
  return Array.from(document.querySelectorAll(".modal-session-name")).map((e) => e.textContent || "")
}

describe("sessionListRenderer — pinning", () => {
  beforeEach(() => {
    setupDom()
    setUnifiedServerSessions([]) // not "loading"
    setUnifiedSessionQuery("")
  })
  afterEach(() => {
    console.warn = warn
  })

  it("sorts pinned sessions above more-recent unpinned ones", () => {
    setUnifiedLocalSessions([
      { id: "a", title: "Recent unpinned", time: 1000, pinned: false },
      { id: "b", title: "Old pinned", time: 10, pinned: true },
    ])
    renderUnifiedSessionList()
    assert.deepEqual(rowNames(), ["Old pinned", "Recent unpinned"])
  })

  it("renders a pinned marker and --pinned class on pinned rows only", () => {
    setUnifiedLocalSessions([
      { id: "a", title: "Plain", time: 1000, pinned: false },
      { id: "b", title: "Pinned", time: 900, pinned: true },
    ])
    renderUnifiedSessionList()
    assert.equal(document.querySelectorAll(".modal-session-item--pinned").length, 1)
    assert.equal(document.querySelectorAll(".modal-session-pin-marker").length, 1)
  })

  it("the pin button posts pin_session with the toggled state", () => {
    const posted: Record<string, unknown>[] = []
    setSessionListPostMessage((m) => posted.push(m as Record<string, unknown>))
    setUnifiedLocalSessions([{ id: "a", title: "Plain", time: 1000, pinned: false }])
    renderUnifiedSessionList()

    const pinBtn = document.querySelector<HTMLButtonElement>(".modal-session-pin")!
    assert.ok(pinBtn, "pin button must exist for local sessions")
    assert.equal(pinBtn.getAttribute("aria-pressed"), "false")
    pinBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    assert.deepEqual(posted, [{ type: "pin_session", targetSessionId: "a", pinned: true }])
  })

  it("a pinned session's pin button is marked pressed and offers Unpin", () => {
    setUnifiedLocalSessions([{ id: "b", title: "Pinned", time: 900, pinned: true }])
    renderUnifiedSessionList()
    const pinBtn = document.querySelector<HTMLButtonElement>(".modal-session-pin")!
    assert.equal(pinBtn.getAttribute("aria-pressed"), "true")
    assert.equal(pinBtn.title, "Unpin")
  })

  it("inline rename posts rename_session on Enter", () => {
    const posted: Record<string, unknown>[] = []
    setSessionListPostMessage((m) => posted.push(m as Record<string, unknown>))
    setUnifiedLocalSessions([{ id: "a", title: "Old name", time: 1000 }])
    renderUnifiedSessionList()

    document.querySelector<HTMLButtonElement>(".modal-session-rename")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    const input = document.querySelector<HTMLInputElement>(".modal-session-rename-input")!
    assert.equal(input.value, "Old name")
    input.value = "New name"
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }))

    assert.deepEqual(posted, [{ type: "rename_session", sessionId: "a", name: "New name" }])
    assert.equal(document.querySelector(".modal-session-name")!.textContent, "New name")
  })

  it("inline rename cancels on Escape without posting", () => {
    const posted: Record<string, unknown>[] = []
    setSessionListPostMessage((m) => posted.push(m as Record<string, unknown>))
    setUnifiedLocalSessions([{ id: "a", title: "Keep me", time: 1000 }])
    renderUnifiedSessionList()
    document.querySelector<HTMLButtonElement>(".modal-session-rename")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    const input = document.querySelector<HTMLInputElement>(".modal-session-rename-input")!
    input.value = "Discarded"
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    assert.equal(posted.length, 0)
    assert.equal(document.querySelector(".modal-session-name")!.textContent, "Keep me")
  })

  it("renders existing tag chips and edits tags inline", () => {
    const posted: Record<string, unknown>[] = []
    setSessionListPostMessage((m) => posted.push(m as Record<string,unknown>))
    setUnifiedLocalSessions([{ id: "a", title: "Tagged", time: 1000, tags: ["wip"] }])
    renderUnifiedSessionList()
    assert.deepEqual(Array.from(document.querySelectorAll(".modal-session-tag")).map((e) => e.textContent), ["wip"])

    document.querySelector<HTMLButtonElement>(".modal-session-tag-btn")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    const input = document.querySelector<HTMLInputElement>(".modal-session-tags-input")!
    assert.equal(input.value, "wip")
    input.value = "wip, urgent ,  "
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }))

    assert.deepEqual(posted, [{ type: "set_session_tags", targetSessionId: "a", tags: ["wip", "urgent"] }])
    assert.deepEqual(Array.from(document.querySelectorAll(".modal-session-tag")).map((e) => e.textContent), ["wip", "urgent"])
  })
})

describe("sessionListRenderer — action icons", () => {
  beforeEach(() => {
    setupDom()
    setUnifiedServerSessions([])
    setUnifiedSessionQuery("")
  })
  afterEach(() => {
    console.warn = warn
  })

  it("every action button renders an SVG icon instead of a text label", () => {
    setUnifiedLocalSessions([{ id: "a", title: "Has actions", time: 1000 }])
    renderUnifiedSessionList()

    const actionClasses = [
      ".modal-session-pin",
      ".modal-session-rename",
      ".modal-session-tag-btn",
      ".modal-session-archive",
      ".modal-session-delete",
    ]
    for (const sel of actionClasses) {
      const btn = document.querySelector<HTMLButtonElement>(sel)
      assert.ok(btn, `${sel} must be present`)
      const svg = btn.querySelector("svg")
      assert.ok(svg, `${sel} must render an <svg> icon, not text`)
      assert.equal(btn.textContent?.trim() ?? "", "", `${sel} must not contain visible text labels`)
      assert.ok(btn.classList.contains("icon-btn"), `${sel} must use the icon-btn class for sizing`)
    }
  })

  it("delete and archive icons render at the standard 14px action size (not the 10px REMOVE_SVG)", () => {
    setUnifiedLocalSessions([{ id: "a", title: "Sized", time: 1000 }])
    renderUnifiedSessionList()
    for (const sel of [".modal-session-archive", ".modal-session-delete"]) {
      const svg = document.querySelector(`${sel} svg`)
      assert.ok(svg, `${sel} must contain an svg`)
      assert.equal(svg!.getAttribute("width"), "14", `${sel} svg width must be 14`)
      assert.equal(svg!.getAttribute("height"), "14", `${sel} svg height must be 14`)
    }
  })

  it("pin icon swaps between outline (unpinned) and filled (pinned) variants", () => {
    setUnifiedLocalSessions([
      { id: "a", title: "Plain", time: 1000, pinned: false },
      { id: "b", title: "Stuck", time: 900, pinned: true },
    ])
    renderUnifiedSessionList()
    const pins = document.querySelectorAll<HTMLButtonElement>(".modal-session-pin")
    const unpinnedSvg = pins[0]!.querySelector("svg")
    const pinnedSvg = pins[1]!.querySelector("svg")
    assert.ok(unpinnedSvg && pinnedSvg, "both rows must render pin icons")
    assert.notEqual(
      unpinnedSvg!.innerHTML,
      pinnedSvg!.innerHTML,
      "pinned and unpinned pin icons must differ so the toggle state is visible",
    )
  })

  it("delete button keeps accessible labels even without visible text", () => {
    setUnifiedLocalSessions([{ id: "a", title: "Doomed", time: 1000 }])
    renderUnifiedSessionList()
    const del = document.querySelector<HTMLButtonElement>(".modal-session-delete")!
    assert.equal(del.getAttribute("aria-label"), "Delete")
    assert.equal(del.title, "Delete")
  })
})
