import { afterEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import {
  setupModeToggle,
  updateModeDropdown,
  cycleModeForward,
  resetCycleTimer,
  type ModeDropdownElements,
  type ModeDropdownDeps,
} from "./ui/modeDropdown"
import { renderWelcomeContext, type WelcomeViewDeps } from "./ui/welcomeView"

let cleanupDom: (() => void) | null = null

function installModeDom(): ModeDropdownElements {
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
  const d = dom.window.document
  return {
    modeDropdown: d.getElementById("mode-dropdown") as HTMLDivElement,
    modeDropdownBtn: d.getElementById("mode-dropdown-btn") as HTMLButtonElement,
    modeDropdownMenu: d.getElementById("mode-dropdown-menu") as HTMLDivElement,
    modeDropdownLabel: d.getElementById("mode-dropdown-label") as HTMLSpanElement,
    modeCurrentText: d.getElementById("mode-current-text") as HTMLSpanElement,
    modeOptPlan: d.getElementById("mode-opt-plan") as HTMLButtonElement,
    modeOptAuto: d.getElementById("mode-opt-auto") as HTMLButtonElement,
    modeOptBuild: d.getElementById("mode-opt-build") as HTMLButtonElement,
  }
}

afterEach(() => cleanupDom?.())

describe("welcome screen mode selection (no active session)", () => {
  it("updates the pending default mode and the selector when a mode is clicked on the welcome screen", () => {
    const els = installModeDom()
    updateModeDropdown("build", els)
    let defaultMode = "build"
    const posted: Record<string, unknown>[] = []
    const deps: ModeDropdownDeps = {
      els,
      getActiveSession: () => undefined, // welcome screen — no active session
      setSessionMode: () => {},
      postMessage: (m) => posted.push(m),
      getDefaultMode: () => defaultMode,
      setDefaultMode: (m) => { defaultMode = m },
    }
    setupModeToggle(deps)

    els.modeOptPlan.click()

    assert.equal(defaultMode, "plan", "clicking Plan on welcome must update the pending mode")
    assert.equal(els.modeCurrentText.textContent, "Plan", "selector label must reflect the chosen mode")
    assert.equal(posted.length, 0, "must NOT post change_mode when there is no session to target")
  })

  it("cycleModeForward cycles the pending default mode when no session is active", () => {
    const els = installModeDom()
    resetCycleTimer()
    updateModeDropdown("build", els)
    let defaultMode = "build"
    const posted: Record<string, unknown>[] = []
    const deps: ModeDropdownDeps = {
      els,
      getActiveSession: () => undefined,
      setSessionMode: () => {},
      postMessage: (m) => posted.push(m),
      getDefaultMode: () => defaultMode,
      setDefaultMode: (m) => { defaultMode = m },
    }

    cycleModeForward(deps)

    assert.equal(defaultMode, "auto", "build → auto in MODE_ORDER when cycling the pending mode")
    assert.equal(posted.length, 0, "must not post change_mode with no active session")
  })

  it("still posts change_mode when a session IS active (regression guard)", () => {
    const els = installModeDom()
    updateModeDropdown("build", els)
    const posted: Record<string, unknown>[] = []
    const deps: ModeDropdownDeps = {
      els,
      getActiveSession: () => ({ id: "s1", isStreaming: false, mode: "build" }),
      setSessionMode: () => {},
      postMessage: (m) => posted.push(m),
      getDefaultMode: () => "build",
      setDefaultMode: () => { throw new Error("must not touch default mode when a session is active") },
    }
    setupModeToggle(deps)

    els.modeOptPlan.click()

    assert.deepEqual(posted, [{ type: "change_mode", mode: "plan", sessionId: "s1" }])
  })
})

describe("welcome model card", () => {
  function welcomeDom() {
    const dom = new JSDOM(`<span id="welcome-model-name">No model selected</span>`)
    const el = dom.window.document.getElementById("welcome-model-name") as HTMLElement
    return { dom, el }
  }

  function makeDeps(over: Partial<WelcomeViewDeps>, modelName: HTMLElement): WelcomeViewDeps {
    return {
      els: {
        welcomeView: { classList: { remove() {}, add() {}, toggle() {} } } as unknown as HTMLElement,
        welcomeNewBtn: {} as HTMLButtonElement,
        welcomeModelCtx: null,
        welcomeContinueBtn: null,
        welcomeModelName: modelName,
        welcomeSearchInput: null,
        promptInput: {} as HTMLTextAreaElement,
      },
      postMessage: () => {},
      getAllSessions: () => [],
      getState: () => ({}),
      openModelManager: () => {},
      renderRecentSessionsList: () => {},
      hideStatusStrip: () => {},
      applyTimelineVisibility: () => {},
      autoResizeTextarea: () => {},
      updateSendButton: () => {},
      ...over,
    }
  }

  it("falls back to the resolved model when globalModel has not arrived yet", () => {
    const { el } = welcomeDom()
    const deps = makeDeps(
      { getState: () => ({}), getResolvedModel: () => "anthropic/claude-opus-4-8" },
      el,
    )
    renderWelcomeContext(deps)
    assert.equal(el.textContent, "claude-opus-4-8", "welcome must show the resolved model, not stay on the placeholder")
  })

  it("prefers globalModel when present", () => {
    const { el } = welcomeDom()
    const deps = makeDeps(
      { getState: () => ({ globalModel: "openai/gpt-5" }), getResolvedModel: () => "anthropic/claude" },
      el,
    )
    renderWelcomeContext(deps)
    assert.equal(el.textContent, "gpt-5")
  })

  it("shows the placeholder when no model is known anywhere", () => {
    const { el } = welcomeDom()
    const deps = makeDeps({ getState: () => ({}), getResolvedModel: () => undefined }, el)
    renderWelcomeContext(deps)
    assert.equal(el.textContent, "No model selected")
  })
})
