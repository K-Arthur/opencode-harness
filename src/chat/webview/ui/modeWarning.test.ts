import { afterEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import {
  closeModeWarning,
  isModeWarningOpen,
  setupModeWarning,
  showAutoModeWarning,
  type ModeWarningDeps,
  type ModeWarningEls,
} from "./modeWarning"

let cleanupDom: (() => void) | null = null

function installDom(): ModeWarningEls {
  const dom = new JSDOM(`
    <button id="mode-button">Mode</button>
    <div id="mode-warning-modal" class="hidden">
      <h2 id="mode-warning-title"></h2>
      <p id="mode-warning-description"></p>
      <button id="mode-warning-confirm">Confirm</button>
      <button id="mode-warning-cancel">Cancel</button>
      <input id="mode-warning-dont-show" type="checkbox" />
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
    modeWarningTitle: dom.window.document.getElementById("mode-warning-title") as HTMLElement,
    modeWarningDescription: dom.window.document.getElementById("mode-warning-description") as HTMLElement,
    modeWarningModal: dom.window.document.getElementById("mode-warning-modal") as HTMLDivElement,
    modeWarningConfirm: dom.window.document.getElementById("mode-warning-confirm") as HTMLButtonElement,
    modeWarningCancel: dom.window.document.getElementById("mode-warning-cancel") as HTMLButtonElement,
    modeWarningDontShow: dom.window.document.getElementById("mode-warning-dont-show") as HTMLInputElement,
  }
}

afterEach(() => {
  cleanupDom?.()
})

void describe("mode warning", () => {
  void it("confirming auto mode closes through the shared cleanup path", () => {
    const els = installDom()
    const modes: string[] = []
    let removedKeydownListeners = 0
    const originalRemove = document.removeEventListener.bind(document)
    document.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
      if (type === "keydown") removedKeydownListeners += 1
      originalRemove(type, listener, options)
    }) as typeof document.removeEventListener

    const deps: ModeWarningDeps = {
      els,
      postMessage: () => {},
      setMode: (mode) => modes.push(mode),
    }

    setupModeWarning(deps)
    showAutoModeWarning(deps)
    assert.equal(isModeWarningOpen(els), true)

    els.modeWarningConfirm.click()

    assert.deepEqual(modes, ["auto"])
    assert.equal(isModeWarningOpen(els), false)
    assert.equal(removedKeydownListeners, 1, "confirm should remove the modal focus trap")
  })

  void it("persists the auto-mode confirmation preference when requested", () => {
    const els = installDom()
    const messages: Record<string, unknown>[] = []
    const deps: ModeWarningDeps = {
      els,
      postMessage: (msg) => messages.push(msg),
      setMode: () => {},
    }

    setupModeWarning(deps)
    showAutoModeWarning(deps)
    els.modeWarningDontShow.checked = true
    els.modeWarningConfirm.click()

    assert.deepEqual(messages, [{ type: "update_setting", key: "autoModeConfirmed", value: true }])
  })

  void it("does not leak an open modal when closed directly", () => {
    const els = installDom()
    const deps: ModeWarningDeps = {
      els,
      postMessage: () => {},
      setMode: () => {},
    }

    showAutoModeWarning(deps)
    closeModeWarning(els)

    assert.equal(isModeWarningOpen(els), false)
  })
})
