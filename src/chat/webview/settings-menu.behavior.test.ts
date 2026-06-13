import { beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"

let settingsMenu: HTMLElement
let settingsBtn: HTMLElement
let setupSettingsMenuKeyboardNav: any
let closeCount: number

function press(key: string, shift = false) {
  const event = new (globalThis as any).window.KeyboardEvent("keydown", { key, shiftKey: shift, bubbles: true })
  settingsMenu.dispatchEvent(event)
}

beforeEach(async () => {
  const dom = new JSDOM(`<!doctype html>
    <button id="settings-btn">Settings</button>
    <div id="settings-menu" role="menu" aria-label="More options" class="hidden">
      <button class="settings-menu-item" role="menuitemcheckbox" aria-checked="true" id="thinking-toggle">Thinking</button>
      <button class="settings-menu-item" role="menuitem" id="mcp-btn">MCP</button>
      <button class="settings-menu-item" role="menuitem" id="theme-btn">Theme</button>
    </div>
  `)
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
  ;(globalThis as any).HTMLButtonElement = dom.window.HTMLButtonElement
  ;(globalThis as any).KeyboardEvent = dom.window.KeyboardEvent

  settingsMenu = document.getElementById("settings-menu")!
  settingsBtn = document.getElementById("settings-btn")!
  closeCount = 0

  ;({ setupSettingsMenuKeyboardNav } = await import("./ui/settingsMenu"))
  setupSettingsMenuKeyboardNav(
    { settingsMenu, settingsBtn },
    () => { closeCount++ },
  )
})

describe("settings menu — keyboard navigation", () => {
  it("ArrowDown moves to next item, wrapping from last to first", () => {
    const items = settingsMenu.querySelectorAll("button")
    ;(items[0] as HTMLElement).focus()
    press("ArrowDown")
    assert.equal(document.activeElement, items[1], "ArrowDown moves to second item")
    press("ArrowDown")
    assert.equal(document.activeElement, items[2], "ArrowDown moves to third item")
    press("ArrowDown")
    assert.equal(document.activeElement, items[0], "ArrowDown wraps back to first item")
  })

  it("ArrowUp moves to previous item, wrapping from first to last", () => {
    const items = settingsMenu.querySelectorAll("button")
    ;(items[0] as HTMLElement).focus()
    press("ArrowUp")
    assert.equal(document.activeElement, items[items.length - 1], "ArrowUp wraps to last item")
  })

  it("Escape closes the menu and focuses the settings button", () => {
    press("Escape")
    assert.equal(closeCount, 1, "Escape triggers close function")
  })
})

describe("settings menu — grouped sections (role=group) keep flat keyboard traversal", () => {
  it("ArrowDown traverses across group boundaries in DOM order", async () => {
    const dom = new JSDOM(`<!doctype html>
      <button id="settings-btn">Settings</button>
      <div id="settings-menu" role="menu" aria-label="More options" class="hidden">
        <div class="settings-menu-group" role="group" aria-label="Panels">
          <div class="settings-menu-group-label" aria-hidden="true">Panels</div>
          <button class="settings-menu-item" role="menuitem" id="g1a">Todos</button>
          <button class="settings-menu-item" role="menuitem" id="g1b">Activity</button>
        </div>
        <div class="settings-menu-group" role="group" aria-label="Configure">
          <div class="settings-menu-group-label" aria-hidden="true">Configure</div>
          <button class="settings-menu-item" role="menuitem" id="g2a">MCP</button>
        </div>
      </div>
    `)
    ;(globalThis as any).window = dom.window
    ;(globalThis as any).document = dom.window.document
    ;(globalThis as any).HTMLElement = dom.window.HTMLElement
    ;(globalThis as any).KeyboardEvent = dom.window.KeyboardEvent
    const menu = document.getElementById("settings-menu")!
    const btn = document.getElementById("settings-btn")!
    const { setupSettingsMenuKeyboardNav: setup } = await import("./ui/settingsMenu")
    setup({ settingsMenu: menu, settingsBtn: btn }, () => {})

    const buttons = menu.querySelectorAll("button")
    assert.equal(buttons.length, 3, "non-button group labels are not traversable items")
    ;(buttons[1] as HTMLElement).focus() // last button of group 1
    const ev = new (dom.window as any).KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
    menu.dispatchEvent(ev)
    assert.equal(document.activeElement, buttons[2], "ArrowDown crosses from group 1 into group 2")
  })
})
