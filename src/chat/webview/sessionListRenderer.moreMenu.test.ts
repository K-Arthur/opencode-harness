/**
 * Regression tests for the session-modal ⋮ more-menu.
 *
 * Two regressions, both introduced in commit ae2ef2e:
 *
 *  1. The more menu was nested inside `.modal-session-actions` with
 *     `position: absolute; right: 0; top: 100%`. With no positioned
 *     ancestor the menu anchored to the viewport initial containing
 *     block, rendering bottom-right, off-screen.
 *  2. Even if the menu *were* visible, `.modal-content { overflow: hidden }`
 *     and `.modal-session-list { overflow-y: auto }` clipped it, so the
 *     Pin/Archive/Rename/Tags/Delete actions looked removed.
 *
 * The fix ports the menu to <body> with `position: fixed` and re-anchors
 * it via `getBoundingClientRect` of the trigger. These tests pin that
 * behaviour so it cannot regress.
 */
import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { JSDOM } from "jsdom"
import {
  setSessionListPostMessage,
  setUnifiedLocalSessions,
  setUnifiedServerSessions,
  setUnifiedSessionQuery,
  renderUnifiedSessionList,
  disposePortaledMoreMenus,
} from "./sessionListRenderer"

let warn: typeof console.warn
let dom: JSDOM
function setupDom() {
  dom = new JSDOM(`<!doctype html><html><body>
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

describe("sessionListRenderer — more-menu regression", () => {
  beforeEach(() => {
    setupDom()
    setUnifiedServerSessions([])
    setUnifiedSessionQuery("")
  })
  afterEach(() => {
    console.warn = warn
    disposePortaledMoreMenus()
  })

  it("more-menu is portaled to <body>, not nested in the actions cell", () => {
    setUnifiedLocalSessions([{ id: "a", title: "Alpha", time: 1000 }])
    renderUnifiedSessionList()
    const menu = document.querySelector<HTMLElement>(".modal-session-more-menu")
    assert.ok(menu, "menu must be in the DOM")
    // The row is in the modal-session-list; the menu must NOT be.
    assert.equal(
      menu!.closest(".modal-session-list"),
      null,
      "more-menu must not be nested inside .modal-session-list (it would be clipped by overflow:auto)",
    )
    assert.equal(
      menu!.parentElement,
      document.body,
      "more-menu must be portaled to <body> so it escapes the modal's containing block",
    )
  })

  it("more-menu is positioned with fixed coordinates anchored to the trigger button", () => {
    setUnifiedLocalSessions([{ id: "a", title: "Alpha", time: 1000 }])
    renderUnifiedSessionList()
    const moreBtn = document.querySelector<HTMLButtonElement>(".modal-session-more-btn")!
    moreBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    const menu = document.querySelector<HTMLElement>(".modal-session-more-menu")!
    assert.ok(!menu.classList.contains("hidden"), "menu must be visible after click")
    const cs = dom.window.getComputedStyle(menu)
    assert.equal(cs.position, "fixed", "menu must use position:fixed so it escapes ancestor clip/transform contexts")
    // The JS positions the menu via top/left inline styles.
    const topPx = menu.style.top
    const leftPx = menu.style.left
    assert.ok(topPx.endsWith("px"), `menu.style.top must be a px value, got "${topPx}"`)
    assert.ok(leftPx.endsWith("px"), `menu.style.left must be a px value, got "${leftPx}"`)
  })

  it("more-menu does not get re-added on every render (no leak)", () => {
    setUnifiedLocalSessions([{ id: "a", title: "Alpha", time: 1000 }])
    renderUnifiedSessionList()
    renderUnifiedSessionList()
    renderUnifiedSessionList()
    // One menu per rendered row. Re-rendering must dispose the previous
    // portaled menus before adding new ones — otherwise we leak <body> nodes.
    const menuCount = document.querySelectorAll(".modal-session-more-menu").length
    assert.equal(menuCount, 1, `expected 1 portaled menu, got ${menuCount}`)
  })

  it("Pin / Archive / Rename / Edit tags / Delete all reachable via the more menu", () => {
    const posted: Record<string, unknown>[] = []
    setSessionListPostMessage((m) => posted.push(m as Record<string, unknown>))
    setUnifiedLocalSessions([{ id: "a", title: "Full", time: 1000 }])
    renderUnifiedSessionList()
    const moreBtn = document.querySelector<HTMLButtonElement>(".modal-session-more-btn")!
    moreBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    const menu = document.querySelector<HTMLElement>(".modal-session-more-menu")!
    const labels = Array.from(menu.querySelectorAll(".more-menu-item"))
      .map((e) => e.textContent?.trim() ?? "")
    for (const required of ["Pin", "Rename", "Edit tags", "Archive", "Delete"]) {
      assert.ok(
        labels.some((l) => l.includes(required)),
        `more menu must contain a "${required}" action so users can recover the previously-visible buttons`,
      )
    }
    // And clicking one of them actually does something (Archive removes the
    // row + posts archive_session, which is the original "Archive" behavior).
    const archiveItem = Array.from(menu.querySelectorAll(".more-menu-item"))
      .find((e) => e.textContent?.includes("Archive")) as HTMLButtonElement
    archiveItem.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    assert.ok(
      posted.some((m) => m.type === "archive_session" && m.targetSessionId === "a"),
      "Archive menu item must still post archive_session",
    )
  })

  it("clicking outside the menu closes it", () => {
    setUnifiedLocalSessions([{ id: "a", title: "Alpha", time: 1000 }])
    renderUnifiedSessionList()
    const moreBtn = document.querySelector<HTMLButtonElement>(".modal-session-more-btn")!
    moreBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    const menu = document.querySelector<HTMLElement>(".modal-session-more-menu")!
    assert.ok(!menu.classList.contains("hidden"), "menu opens on click")
    // Click somewhere else
    document.body.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
    assert.ok(menu.classList.contains("hidden"), "menu must close on outside click")
  })

  it("more-menu stacks ABOVE the modal (z-index regression that made the ⋮ button look dead)", () => {
    // The menu is portaled to <body>, so it shares a stacking context with the
    // session modal. If its z-index is below the modal's, it renders behind the
    // backdrop and clicks appear to do nothing. Pin the CSS relationship at the
    // source level (jsdom does not evaluate stylesheet z-index ordering).
    const cssDir = path.join(__dirname, "css")
    const blocks = readFileSync(path.join(cssDir, "blocks.css"), "utf8")
    const tokens = readFileSync(path.join(cssDir, "tokens.css"), "utf8")

    // The menu rule must use the dedicated modal-menu token, NOT --z-dropdown.
    const menuRule = blocks.slice(blocks.indexOf(".modal-session-more-menu {"))
    const zLine = menuRule.slice(0, menuRule.indexOf("}")).split("\n").find((l) => l.includes("z-index")) ?? ""
    assert.ok(zLine.includes("--z-modal-menu"), `.modal-session-more-menu must use var(--z-modal-menu), got: ${zLine.trim()}`)
    assert.ok(!zLine.includes("--z-dropdown"), "menu must not use --z-dropdown (50), which renders behind the modal")

    const tokenValue = (name: string): number => {
      const m = tokens.match(new RegExp(`--${name}:\\s*(\\d+)`))
      assert.ok(m, `token --${name} must be defined`)
      return Number(m![1])
    }
    assert.ok(
      tokenValue("z-modal-menu") > tokenValue("z-modal"),
      "--z-modal-menu must be greater than --z-modal so the menu renders above modal content",
    )
  })

  it("disposePortaledMoreMenus() removes every portaled menu", () => {
    setUnifiedLocalSessions([
      { id: "a", title: "A", time: 1000 },
      { id: "b", title: "B", time: 900 },
    ])
    renderUnifiedSessionList()
    assert.equal(document.querySelectorAll(".modal-session-more-menu").length, 2)
    disposePortaledMoreMenus()
    assert.equal(document.querySelectorAll(".modal-session-more-menu").length, 0)
  })
})
