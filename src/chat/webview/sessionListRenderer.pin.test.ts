/**
 * DOM tests for session list with context menu pattern.
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
  warn = console.warn
  console.warn = () => {}
}

function rowNames(): string[] {
  return Array.from(document.querySelectorAll(".modal-session-name")).map((e) => e.textContent || "")
}

describe("sessionListRenderer — pinning", () => {
  beforeEach(() => {
    setupDom()
    setUnifiedServerSessions([])
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

  it("the more-menu pin action posts pin_session with the toggled state", () => {
    const posted: Record<string, unknown>[] = []
    setSessionListPostMessage((m) => posted.push(m as Record<string, unknown>))
    setUnifiedLocalSessions([{ id: "a", title: "Plain", time: 1000, pinned: false }])
    renderUnifiedSessionList()
    const moreBtn = document.querySelector<HTMLButtonElement>(".modal-session-more-btn")!
    assert.ok(moreBtn, "more-menu button must exist for local sessions")
    moreBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    const menu = document.querySelector<HTMLElement>(".modal-session-more-menu")
    assert.ok(menu, "more-menu must be rendered")
    assert.ok(!menu!.classList.contains("hidden"), "more-menu must be visible after clicking more-btn")
    const pinItem = Array.from(menu!.querySelectorAll(".more-menu-item")).find(
      (item) => item.textContent?.includes("Pin") || item.textContent?.includes("Unpin")
    )
    assert.ok(pinItem, "Pin/Unpin menu item must exist")
    pinItem!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    assert.deepEqual(posted, [{ type: "pin_session", targetSessionId: "a", pinned: true }])
  })

  it("a pinned session's Pin menu item reflects the pinned state", () => {
    setUnifiedLocalSessions([{ id: "b", title: "Pinned", time: 900, pinned: true }])
    renderUnifiedSessionList()
    const moreBtn = document.querySelector<HTMLButtonElement>(".modal-session-more-btn")!
    moreBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    const menu = document.querySelector<HTMLElement>(".modal-session-more-menu")
    const pinItem = Array.from(menu!.querySelectorAll(".more-menu-item")).find(
      (item) => item.textContent?.includes("Unpin")
    )
    assert.ok(pinItem, "Unpin menu item must exist for pinned sessions")
  })

  it("inline rename from more-menu posts rename_session on Enter", () => {
    const posted: Record<string, unknown>[] = []
    setSessionListPostMessage((m) => posted.push(m as Record<string, unknown>))
    setUnifiedLocalSessions([{ id: "a", title: "Old name", time: 1000 }])
    renderUnifiedSessionList()
    const moreBtn = document.querySelector<HTMLButtonElement>(".modal-session-more-btn")!
    moreBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    const menu = document.querySelector<HTMLElement>(".modal-session-more-menu")
    const renameItem = Array.from(menu!.querySelectorAll(".more-menu-item")).find(
      (item) => item.textContent?.includes("Rename")
    ) as HTMLButtonElement | undefined
    assert.ok(renameItem, "Rename menu item must exist")
    renameItem!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    const input = document.querySelector<HTMLInputElement>(".modal-session-rename-input")!
    assert.equal(input.value, "Old name")
    input.value = "New name"
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    assert.deepEqual(posted, [{ type: "rename_session", sessionId: "a", name: "New name" }])
    assert.equal(document.querySelector(".modal-session-name")!.textContent, "New name")
  })

  it("inline rename from more-menu cancels on Escape without posting", () => {
    const posted: Record<string, unknown>[] = []
    setSessionListPostMessage((m) => posted.push(m as Record<string, unknown>))
    setUnifiedLocalSessions([{ id: "a", title: "Keep me", time: 1000 }])
    renderUnifiedSessionList()
    const moreBtn = document.querySelector<HTMLButtonElement>(".modal-session-more-btn")!
    moreBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    const menu = document.querySelector<HTMLElement>(".modal-session-more-menu")
    const renameItem = Array.from(menu!.querySelectorAll(".more-menu-item")).find(
      (item) => item.textContent?.includes("Rename")
    ) as HTMLButtonElement | undefined
    assert.ok(renameItem!, "Rename menu item must exist")
    renameItem!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    const input = document.querySelector<HTMLInputElement>(".modal-session-rename-input")!
    input.value = "Discarded"
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    assert.equal(posted.length, 0)
    assert.equal(document.querySelector(".modal-session-name")!.textContent, "Keep me")
  })

  it("renders existing tag chips and edits tags from more-menu", () => {
    const posted: Record<string, unknown>[] = []
    setSessionListPostMessage((m) => posted.push(m as Record<string,unknown>))
    setUnifiedLocalSessions([{ id: "a", title: "Tagged", time: 1000, tags: ["wip"] }])
    renderUnifiedSessionList()
    assert.deepEqual(Array.from(document.querySelectorAll(".modal-session-tag")).map((e) => e.textContent), ["wip"])
    const moreBtn = document.querySelector<HTMLButtonElement>(".modal-session-more-btn")!
    moreBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    const menu = document.querySelector<HTMLElement>(".modal-session-more-menu")
    const tagItem = Array.from(menu!.querySelectorAll(".more-menu-item")).find(
      (item) => item.textContent?.includes("Edit tags") || item.textContent?.includes("Tags")
    ) as HTMLButtonElement | undefined
    assert.ok(tagItem, "Edit tags menu item must exist")
    tagItem!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
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

  it("renders a more-menu button with SVG icon for session actions", () => {
    setUnifiedLocalSessions([{ id: "a", title: "Has actions", time: 1000 }])
    renderUnifiedSessionList()
    const moreBtn = document.querySelector<HTMLButtonElement>(".modal-session-more-btn")
    assert.ok(moreBtn, ".modal-session-more-btn must be present")
    const svg = moreBtn!.querySelector("svg")
    assert.ok(svg, "more-btn must render an <svg> icon")
    assert.ok(moreBtn!.classList.contains("icon-btn"), "more-btn must use the icon-btn class")
  })

  it("more-menu reveals action items on click", () => {
    setUnifiedLocalSessions([{ id: "a", title: "Clickable", time: 1000 }])
    renderUnifiedSessionList()
    const moreBtn = document.querySelector<HTMLButtonElement>(".modal-session-more-btn")!
    assert.equal(moreBtn.getAttribute("aria-expanded"), "false")
    moreBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    const menu = document.querySelector<HTMLElement>(".modal-session-more-menu")
    assert.ok(menu, "more-menu must be rendered")
    assert.ok(!menu!.classList.contains("hidden"), "menu must be visible after click")
    assert.equal(moreBtn.getAttribute("aria-expanded"), "true")
  })

  it("more-menu contains all expected action items", () => {
    setUnifiedLocalSessions([{ id: "a", title: "Full", time: 1000 }])
    renderUnifiedSessionList()
    const moreBtn = document.querySelector<HTMLButtonElement>(".modal-session-more-btn")!
    moreBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    const menu = document.querySelector<HTMLElement>(".modal-session-more-menu")!
    const labels = Array.from(menu.querySelectorAll(".more-menu-item")).map((e) => e.textContent?.trim() ?? "")
    assert.ok(labels.some(l => l.includes("Pin") || l.includes("Unpin")), "Pin/Unpin must be in menu")
    assert.ok(labels.some(l => l.includes("Rename")), "Rename must be in menu")
    assert.ok(labels.some(l => l.includes("tags") || l.includes("Tags")), "Edit tags must be in menu")
    assert.ok(labels.some(l => l.includes("Archive")), "Archive must be in menu")
    assert.ok(labels.some(l => l.includes("Delete")), "Delete must be in menu")
  })

  it("more-menu items have accessible labels", () => {
    setUnifiedLocalSessions([{ id: "a", title: "Test", time: 1000 }])
    renderUnifiedSessionList()
    const moreBtn = document.querySelector<HTMLButtonElement>(".modal-session-more-btn")!
    assert.equal(moreBtn.getAttribute("aria-label"), "More session actions")
    assert.ok(moreBtn.title.includes("More"), "more button title must include 'More'")
    assert.equal(moreBtn.getAttribute("aria-haspopup"), "true")
    moreBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    const menu = document.querySelector<HTMLElement>(".modal-session-more-menu")!
    assert.equal(menu.getAttribute("role"), "menu")
    const items = menu.querySelectorAll(".more-menu-item")
    for (const item of items) {
      assert.ok(item.getAttribute("aria-label"), "each menu item must have aria-label")
      assert.equal(item.getAttribute("role"), "menuitem")
    }
  })
})
