import { afterEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import {
  setupModeToggle,
  updateModeDropdown,
  type ModeDropdownElements,
} from "./modeDropdown"

let cleanupDom: (() => void) | null = null

type TestModeDropdownElements = ModeDropdownElements & { modeOptions: HTMLButtonElement[] }

function installDom(): TestModeDropdownElements {
  const dom = new JSDOM(`
    <div id="mode-dropdown">
      <button id="mode-dropdown-btn" aria-expanded="false">
        <span id="mode-dropdown-label"><svg class="mode-icon"></svg><span id="mode-current-text"></span></span>
      </button>
      <div id="mode-dropdown-menu" class="hidden">
        <button id="mode-opt-plan" class="mode-option" data-mode="plan"></button>
        <button id="mode-opt-build" class="mode-option" data-mode="build"></button>
        <button id="mode-opt-auto" class="mode-option" data-mode="auto"></button>
      </div>
    </div>
  `)

  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    HTMLElement: globalThis.HTMLElement,
    KeyboardEvent: globalThis.KeyboardEvent,
    MouseEvent: globalThis.MouseEvent,
  }

  Object.assign(globalThis, {
    document: dom.window.document,
    window: dom.window,
    HTMLElement: dom.window.HTMLElement,
    KeyboardEvent: dom.window.KeyboardEvent,
    MouseEvent: dom.window.MouseEvent,
  })

  cleanupDom = () => {
    Object.assign(globalThis, previous)
    dom.window.close()
    cleanupDom = null
  }

  return {
    modeDropdown: dom.window.document.getElementById("mode-dropdown") as HTMLDivElement,
    modeDropdownBtn: dom.window.document.getElementById("mode-dropdown-btn") as HTMLButtonElement,
    modeDropdownMenu: dom.window.document.getElementById("mode-dropdown-menu") as HTMLDivElement,
    modeDropdownLabel: dom.window.document.getElementById("mode-dropdown-label") as HTMLSpanElement,
    modeCurrentText: dom.window.document.getElementById("mode-current-text") as HTMLSpanElement,
    modeOptPlan: dom.window.document.getElementById("mode-opt-plan") as HTMLButtonElement,
    modeOptAuto: dom.window.document.getElementById("mode-opt-auto") as HTMLButtonElement,
    modeOptBuild: dom.window.document.getElementById("mode-opt-build") as HTMLButtonElement,
    modeOptions: Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>(".mode-option")),
  }
}

afterEach(() => {
  cleanupDom?.()
})

void describe("mode dropdown", () => {
  void it("sends change_mode directly for auto without a separate webview warning", () => {
    const els = installDom()
    const posted: Record<string, unknown>[] = []

    updateModeDropdown("build", els)
    setupModeToggle({
      els,
      getActiveSession: () => ({ id: "s1", isStreaming: false }),
      setSessionMode: () => {},
      postMessage: (msg) => posted.push(msg),
    })

    els.modeOptions.find((option) => option.dataset.mode === "auto")?.click()

    assert.equal(posted.length, 1)
    assert.deepEqual(posted[0], { type: "change_mode", mode: "auto", sessionId: "s1" })
  })

  void it("requests mode changes through keyboard shortcuts without mutating local state first", () => {
    const els = installDom()
    const posted: Record<string, unknown>[] = []
    const localModes: string[] = []

    updateModeDropdown("build", els)
    setupModeToggle({
      els,
      getActiveSession: () => ({ id: "s1", isStreaming: false }),
      setSessionMode: (_id, mode) => localModes.push(mode),
      postMessage: (msg) => posted.push(msg),
    })

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "1", ctrlKey: true, altKey: true, bubbles: true }))

    assert.deepEqual(posted, [{ type: "change_mode", mode: "plan", sessionId: "s1" }])
    assert.deepEqual(localModes, [], "local state should wait for host acknowledgement")
  })

  void it("adds discoverable mode tooltips and labels", () => {
    const els = installDom()

    updateModeDropdown("build", els)

    assert.match(els.modeDropdownBtn.title, /Build mode/)
    assert.match(els.modeDropdownBtn.getAttribute("aria-label") ?? "", /Ctrl/)
    assert.match(els.modeOptions.find((option) => option.dataset.mode === "plan")?.title ?? "", /Plan mode/)
    assert.match(els.modeOptions.find((option) => option.dataset.mode === "auto")?.getAttribute("aria-label") ?? "", /Auto mode/)
  })
})
