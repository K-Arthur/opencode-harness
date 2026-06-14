import { afterEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import {
  setupModeToggle,
  updateModeDropdown,
  cycleModeForward,
  isModalOrDialogOpen,
  resetCycleTimer,
  MODE_ORDER,
  type ModeDropdownElements,
  type ModeDropdownDeps,
} from "./modeDropdown"
import { isTextEntryTarget, resetShortcutRegistry } from "../keyboardShortcuts"

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
    <div id="modal-1" aria-modal="true" class="hidden"></div>
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

function makeDeps(els: ModeDropdownElements, overrides?: Partial<ModeDropdownDeps>): ModeDropdownDeps {
  return {
    els,
    getActiveSession: () => ({ id: "s1", isStreaming: false }),
    setSessionMode: () => {},
    postMessage: () => {},
    ...overrides,
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

  void it("requests mode changes through Alt+1/2/3 without mutating local state first", () => {
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

    // The mock always reports the current mode as the "build" default, so Alt+2
    // (build) is correctly a no-op; Alt+1 (plan) and Alt+3 (auto) differ and post.
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit1", altKey: true, bubbles: true }))
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit3", altKey: true, bubbles: true }))

    assert.deepEqual(posted, [
      { type: "change_mode", mode: "plan", sessionId: "s1" },
      { type: "change_mode", mode: "auto", sessionId: "s1" },
    ])
    assert.deepEqual(localModes, [], "local state should wait for host acknowledgement")
  })

  void it("Alt+1/2/3 fire while focused in a text input (composer), unlike the old guard", () => {
    const els = installDom()
    const posted: Record<string, unknown>[] = []
    updateModeDropdown("build", els)
    setupModeToggle({
      els,
      getActiveSession: () => ({ id: "s1", isStreaming: false }),
      setSessionMode: () => {},
      postMessage: (msg) => posted.push(msg),
    })
    const textarea = document.createElement("textarea")
    document.body.appendChild(textarea)
    // dispatch from the textarea as the event target
    textarea.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit1", altKey: true, bubbles: true }))
    assert.deepEqual(posted, [{ type: "change_mode", mode: "plan", sessionId: "s1" }])
  })

  void it("does NOT treat the old Ctrl+Alt+1 as a mode shortcut (digit triplet freed)", () => {
    const els = installDom()
    const posted: Record<string, unknown>[] = []
    updateModeDropdown("build", els)
    setupModeToggle({
      els,
      getActiveSession: () => ({ id: "s1", isStreaming: false }),
      setSessionMode: () => {},
      postMessage: (msg) => posted.push(msg),
    })
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit1", ctrlKey: true, altKey: true, bubbles: true }))
    assert.deepEqual(posted, [], "Ctrl/Cmd+Alt+digit must no longer change mode")
  })

  void it("adds discoverable mode tooltips and labels", () => {
    const els = installDom()

    updateModeDropdown("build", els)

    assert.match(els.modeDropdownBtn.title, /Build mode/)
    assert.match(els.modeDropdownBtn.getAttribute("aria-label") ?? "", /Ctrl/)
    assert.match(els.modeDropdownBtn.getAttribute("aria-label") ?? "", /Alt\+Shift\+Tab/)
    assert.match(els.modeOptions.find((option) => option.dataset.mode === "plan")?.title ?? "", /Plan mode/)
    assert.match(els.modeOptions.find((option) => option.dataset.mode === "auto")?.getAttribute("aria-label") ?? "", /Auto mode/)
  })

  void describe("cycleModeForward", () => {
    void it("cycles from plan to build", () => {
      const els = installDom()
      resetCycleTimer()
      const posted: Record<string, unknown>[] = []
      const deps = makeDeps(els, {
        getActiveSession: () => ({ id: "s1", isStreaming: false, mode: "plan" }),
        postMessage: (msg) => posted.push(msg),
      })
      cycleModeForward(deps)
      assert.equal(posted.length, 1)
      assert.deepEqual(posted[0], { type: "change_mode", mode: "build", sessionId: "s1" })
    })

    void it("cycles from build to auto", () => {
      const els = installDom()
      resetCycleTimer()
      const posted: Record<string, unknown>[] = []
      const deps = makeDeps(els, {
        getActiveSession: () => ({ id: "s1", isStreaming: false, mode: "build" }),
        postMessage: (msg) => posted.push(msg),
      })
      cycleModeForward(deps)
      assert.equal(posted.length, 1)
      assert.deepEqual(posted[0], { type: "change_mode", mode: "auto", sessionId: "s1" })
    })

    void it("cycles from auto to plan (wrap around)", () => {
      const els = installDom()
      resetCycleTimer()
      const posted: Record<string, unknown>[] = []
      const deps = makeDeps(els, {
        getActiveSession: () => ({ id: "s1", isStreaming: false, mode: "auto" }),
        postMessage: (msg) => posted.push(msg),
      })
      cycleModeForward(deps)
      assert.equal(posted.length, 1)
      assert.deepEqual(posted[0], { type: "change_mode", mode: "plan", sessionId: "s1" })
    })

    void it("defaults to build when no session mode is set", () => {
      const els = installDom()
      resetCycleTimer()
      const posted: Record<string, unknown>[] = []
      const deps = makeDeps(els, {
        getActiveSession: () => ({ id: "s1", isStreaming: false }),
        postMessage: (msg) => posted.push(msg),
      })
      cycleModeForward(deps)
      assert.equal(posted.length, 1)
      assert.deepEqual(posted[0], { type: "change_mode", mode: "auto", sessionId: "s1" })
    })

    void it("cycles even when session is streaming (mode applies to next prompt)", () => {
      const els = installDom()
      resetCycleTimer()
      const posted: Record<string, unknown>[] = []
      const deps = makeDeps(els, {
        getActiveSession: () => ({ id: "s1", isStreaming: true, mode: "plan" }),
        postMessage: (msg) => posted.push(msg),
      })
      cycleModeForward(deps)
      assert.equal(posted.length, 1, "mode is a per-session label safe to change mid-stream")
      assert.deepEqual(posted[0], { type: "change_mode", mode: "build", sessionId: "s1" })
    })

    void it("does not fire twice within debounce window", () => {
      const els = installDom()
      resetCycleTimer()
      const posted: Record<string, unknown>[] = []
      const deps = makeDeps(els, {
        getActiveSession: () => ({ id: "s1", isStreaming: false, mode: "plan" }),
        postMessage: (msg) => posted.push(msg),
      })
      cycleModeForward(deps)
      cycleModeForward(deps)
      assert.equal(posted.length, 1, "second call within debounce window should be ignored")
    })

    void it("fires again after debounce window elapses", async () => {
      const els = installDom()
      resetCycleTimer()
      const posted: Record<string, unknown>[] = []
      const deps = makeDeps(els, {
        getActiveSession: () => ({ id: "s1", isStreaming: false, mode: "plan" }),
        postMessage: (msg) => posted.push(msg),
      })
      cycleModeForward(deps)
      await new Promise((r) => setTimeout(r, 250))
      cycleModeForward(deps)
      assert.equal(posted.length, 2, "should fire again after debounce expires")
    })

    void it("falls back to build for unknown mode then cycles to auto", () => {
      const els = installDom()
      resetCycleTimer()
      const posted: Record<string, unknown>[] = []
      const deps = makeDeps(els, {
        getActiveSession: () => ({ id: "s1", isStreaming: false, mode: "unknown" }),
        postMessage: (msg) => posted.push(msg),
      })
      cycleModeForward(deps)
      assert.equal(posted.length, 1, "unknown mode falls back to build, then cycles to auto")
      assert.deepEqual(posted[0], { type: "change_mode", mode: "auto", sessionId: "s1" })
    })
  })

  void describe("isModalOrDialogOpen", () => {
    void it("returns false when no modals are visible", () => {
      installDom()
      assert.equal(isModalOrDialogOpen(), false)
    })

    void it("returns true when a visible modal exists", () => {
      installDom()
      const modal = document.getElementById("modal-1")
      if (modal) modal.classList.remove("hidden")
      assert.equal(isModalOrDialogOpen(), true)
    })

    void it("returns false when modal is hidden", () => {
      installDom()
      const modal = document.getElementById("modal-1")
      if (modal) modal.classList.add("hidden")
      assert.equal(isModalOrDialogOpen(), false)
    })
  })

  void describe("Alt+Shift+Tab mode cycling", () => {
    void it("posts change_mode when Alt+Shift+Tab is pressed", () => {
      const els = installDom()
      resetCycleTimer()
      const posted: Record<string, unknown>[] = []
      updateModeDropdown("build", els)
      setupModeToggle({
        els,
        getActiveSession: () => ({ id: "s1", isStreaming: false }),
        setSessionMode: () => {},
        postMessage: (msg) => posted.push(msg),
      })
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", altKey: true, shiftKey: true, bubbles: true }))
      assert.equal(posted.length, 1)
    })

    void it("does not fire for plain Tab without Alt", () => {
      const els = installDom()
      resetCycleTimer()
      const posted: Record<string, unknown>[] = []
      updateModeDropdown("build", els)
      setupModeToggle({
        els,
        getActiveSession: () => ({ id: "s1", isStreaming: false }),
        setSessionMode: () => {},
        postMessage: (msg) => posted.push(msg),
      })
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }))
      assert.equal(posted.length, 0, "plain Tab should not trigger mode cycle")
    })

    void it("does not fire when a modal is open", () => {
      const els = installDom()
      resetCycleTimer()
      const modal = document.getElementById("modal-1")
      if (modal) modal.classList.remove("hidden")
      const posted: Record<string, unknown>[] = []
      updateModeDropdown("build", els)
      setupModeToggle({
        els,
        getActiveSession: () => ({ id: "s1", isStreaming: false }),
        setSessionMode: () => {},
        postMessage: (msg) => posted.push(msg),
      })
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", altKey: true, shiftKey: true, bubbles: true }))
      assert.equal(posted.length, 0, "should not cycle when modal is open")
    })
  })

  void describe("MODE_ORDER", () => {
    void it("has expected order", () => {
      assert.deepEqual([...MODE_ORDER], ["plan", "build", "auto"])
    })
  })

  void describe("Shift+Tab on mode button", () => {
    void it("cycles mode when mode button is focused", () => {
      const els = installDom()
      resetCycleTimer()
      const posted: Record<string, unknown>[] = []
      updateModeDropdown("build", els)
      setupModeToggle({
        els,
        getActiveSession: () => ({ id: "s1", isStreaming: false }),
        setSessionMode: () => {},
        postMessage: (msg) => posted.push(msg),
      })
      els.modeDropdownBtn.focus()
      els.modeDropdownBtn.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }))
      assert.equal(posted.length, 1, "Shift+Tab on mode button should cycle mode")
    })

    void it("does not cycle when a modal is open", () => {
      const els = installDom()
      resetCycleTimer()
      const modal = document.getElementById("modal-1")
      if (modal) modal.classList.remove("hidden")
      const posted: Record<string, unknown>[] = []
      updateModeDropdown("build", els)
      setupModeToggle({
        els,
        getActiveSession: () => ({ id: "s1", isStreaming: false }),
        setSessionMode: () => {},
        postMessage: (msg) => posted.push(msg),
      })
      els.modeDropdownBtn.focus()
      els.modeDropdownBtn.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }))
      assert.equal(posted.length, 0, "should not cycle when modal is open")
    })

    void it("does not cycle when session is streaming", () => {
      const els = installDom()
      resetCycleTimer()
      const posted: Record<string, unknown>[] = []
      updateModeDropdown("build", els)
      setupModeToggle({
        els,
        getActiveSession: () => ({ id: "s1", isStreaming: true }),
        setSessionMode: () => {},
        postMessage: (msg) => posted.push(msg),
      })
      els.modeDropdownBtn.focus()
      els.modeDropdownBtn.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }))
      assert.equal(posted.length, 0, "should not cycle while streaming")
    })

    void it("does not cycle when the mode button is not focused", () => {
      const els = installDom()
      resetCycleTimer()
      const posted: Record<string, unknown>[] = []
      updateModeDropdown("build", els)
      setupModeToggle({
        els,
        getActiveSession: () => ({ id: "s1", isStreaming: false }),
        setSessionMode: () => {},
        postMessage: (msg) => posted.push(msg),
      })
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }))
      assert.equal(posted.length, 0, "plain Shift+Tab should not cycle mode")
    })
  })

  void describe("Ctrl+Shift+M mode cycling", () => {
    void it("posts change_mode when Ctrl+Shift+M is pressed", () => {
      const els = installDom()
      resetCycleTimer()
      const posted: Record<string, unknown>[] = []
      updateModeDropdown("build", els)
      setupModeToggle({
        els,
        getActiveSession: () => ({ id: "s1", isStreaming: false }),
        setSessionMode: () => {},
        postMessage: (msg) => posted.push(msg),
      })
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "m", ctrlKey: true, shiftKey: true, bubbles: true }))
      assert.equal(posted.length, 1)
    })

    void it("does not fire for Ctrl+Shift without M", () => {
      const els = installDom()
      resetCycleTimer()
      const posted: Record<string, unknown>[] = []
      updateModeDropdown("build", els)
      setupModeToggle({
        els,
        getActiveSession: () => ({ id: "s1", isStreaming: false }),
        setSessionMode: () => {},
        postMessage: (msg) => posted.push(msg),
      })
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "n", ctrlKey: true, shiftKey: true, bubbles: true }))
      assert.equal(posted.length, 0, "Ctrl+Shift+N should not trigger mode cycle")
    })

    void it("does not fire when a modal is open", () => {
      const els = installDom()
      resetCycleTimer()
      const modal = document.getElementById("modal-1")
      if (modal) modal.classList.remove("hidden")
      const posted: Record<string, unknown>[] = []
      updateModeDropdown("build", els)
      setupModeToggle({
        els,
        getActiveSession: () => ({ id: "s1", isStreaming: false }),
        setSessionMode: () => {},
        postMessage: (msg) => posted.push(msg),
      })
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "m", ctrlKey: true, shiftKey: true, bubbles: true }))
      assert.equal(posted.length, 0, "should not cycle when modal is open")
    })

    void it("does not fire in text input", () => {
      const els = installDom()
      resetCycleTimer()
      const posted: Record<string, unknown>[] = []
      updateModeDropdown("build", els)
      setupModeToggle({
        els,
        getActiveSession: () => ({ id: "s1", isStreaming: false }),
        setSessionMode: () => {},
        postMessage: (msg) => posted.push(msg),
      })
      const textarea = document.createElement("textarea")
      document.body.appendChild(textarea)
      textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "m", ctrlKey: true, shiftKey: true, bubbles: true }))
      assert.equal(posted.length, 0, "should not cycle in text input")
      document.body.removeChild(textarea)
    })

    void it("fires even when session is streaming (mode applies to next prompt)", () => {
      const els = installDom()
      resetCycleTimer()
      const posted: Record<string, unknown>[] = []
      updateModeDropdown("build", els)
      setupModeToggle({
        els,
        getActiveSession: () => ({ id: "s1", isStreaming: true }),
        setSessionMode: () => {},
        postMessage: (msg) => posted.push(msg),
      })
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "m", ctrlKey: true, shiftKey: true, bubbles: true }))
      assert.equal(posted.length, 1, "mode is safe to cycle mid-stream")
    })
  })
})
