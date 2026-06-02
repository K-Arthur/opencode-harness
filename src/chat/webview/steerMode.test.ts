/**
 * Regression tests for the steering-mode selector (interrupt / append / queue).
 *
 * The selector tells the user which mode a mid-stream send will use. Exactly
 * one button must read as active (class `active` + `aria-pressed="true"`) at a
 * time. A prior bug deselected via the wrong class (`.steer-option` instead of
 * `.steer-mode-btn`) on an undefined element ref, so old buttons kept `active`
 * and several modes appeared selected at once.
 */
import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { createSendLogic, type SendLogicDeps } from "./sendLogic"

let dom: JSDOM

function setupDom() {
  dom = new JSDOM(`<!doctype html><html><body>
    <div id="input-area">
      <div class="steer-mode-selector" id="steer-mode-selector" role="radiogroup">
        <button class="steer-mode-btn active" id="steer-mode-interrupt" data-mode="interrupt" aria-pressed="true"></button>
        <button class="steer-mode-btn" id="steer-mode-append" data-mode="append" aria-pressed="false"></button>
        <button class="steer-mode-btn" id="steer-mode-queue" data-mode="queue" aria-pressed="false"></button>
      </div>
    </div>
  </body></html>`)
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).HTMLElement = dom.window.HTMLElement
}

function makeSendLogic() {
  const inputArea = dom.window.document.getElementById("input-area") as unknown as HTMLDivElement
  const noop = () => {}
  const deps = {
    els: { inputArea, promptInput: { value: "" }, sendBtn: {} } as any,
    stateManager: {
      getState: () => ({ sessions: {} }) as any,
      getActiveSession: () => null,
      getSession: () => undefined,
      getAllSessions: () => [],
      setStreaming: noop,
    },
    vscode: { postMessage: noop },
    attachmentManager: { getAttachments: () => [], clearAttachments: noop },
    streamHandlers: { get: () => undefined },
    modelDropdown: { getCurrentModel: () => undefined },
    hideWelcomeView: noop,
    handleRequestError: noop,
    addMessage: noop,
    updateTabBar: noop,
    switchTab: noop,
    switchToTab: noop,
    createTabUI: noop,
    createNewTab: () => undefined,
    updateAgentStatus: noop,
    updateModeSelectorState: noop,
    renderAttachmentChips: noop,
    autoResizeTextarea: noop,
    runSlashCommandText: noop,
    STREAM_LIMIT_TOOLTIP: "limit",
  } as unknown as SendLogicDeps
  return createSendLogic(deps)
}

function activeModes(): string[] {
  return Array.from(dom.window.document.querySelectorAll(".steer-mode-btn.active")).map(
    (b) => b.getAttribute("data-mode") ?? "",
  )
}

function pressedModes(): string[] {
  return Array.from(dom.window.document.querySelectorAll('.steer-mode-btn[aria-pressed="true"]')).map(
    (b) => b.getAttribute("data-mode") ?? "",
  )
}

describe("setSteerMode", () => {
  beforeEach(() => setupDom())

  it("activates exactly one button when switching modes", () => {
    const sl = makeSendLogic()
    sl.setSteerMode("queue")
    assert.deepEqual(activeModes(), ["queue"], "only queue is active")
    assert.deepEqual(pressedModes(), ["queue"], "only queue is aria-pressed")

    sl.setSteerMode("append")
    assert.deepEqual(activeModes(), ["append"], "switching deselects the previous mode")
    assert.deepEqual(pressedModes(), ["append"])
  })

  it("never leaves two buttons active after consecutive switches", () => {
    const sl = makeSendLogic()
    sl.setSteerMode("interrupt")
    sl.setSteerMode("queue")
    sl.setSteerMode("append")
    sl.setSteerMode("interrupt")
    assert.equal(activeModes().length, 1, "exactly one active button")
    assert.equal(pressedModes().length, 1, "exactly one aria-pressed button")
    assert.deepEqual(activeModes(), ["interrupt"])
  })

  it("reflects the mode on #input-area for the border accent", () => {
    const sl = makeSendLogic()
    const inputArea = dom.window.document.getElementById("input-area")!
    sl.setSteerMode("queue")
    assert.ok(inputArea.classList.contains("steer-queue"))
    assert.ok(!inputArea.classList.contains("steer-interrupt"))
    sl.setSteerMode("interrupt")
    assert.ok(inputArea.classList.contains("steer-interrupt"))
    assert.ok(!inputArea.classList.contains("steer-queue"))
  })

  it("syncSteerModeUI re-asserts the current mode (e.g. when the selector reappears)", () => {
    const sl = makeSendLogic()
    sl.setSteerMode("queue")
    // Simulate the selector being torn down and a stale `active` left on another button.
    const interruptBtn = dom.window.document.getElementById("steer-mode-interrupt")!
    interruptBtn.classList.add("active")
    interruptBtn.setAttribute("aria-pressed", "true")
    assert.equal(activeModes().length, 2, "precondition: stale double-active")

    sl.syncSteerModeUI()
    assert.deepEqual(activeModes(), ["queue"], "sync restores single active = current mode")
    assert.equal(sl.getSteerMode(), "queue")
  })
})
