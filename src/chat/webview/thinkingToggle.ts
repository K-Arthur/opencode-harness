import type { WebviewState } from "./types"
import type { ElementRefs } from "./dom"

export interface ThinkingToggleDeps {
  els: ElementRefs
  getState: () => WebviewState
  setThinkingVisible: (visible: boolean) => void
  getThinkingVisible: () => boolean
  toggleAllThinkingBlocks: (visible: boolean) => void
  vscodeSetState: (state: WebviewState) => void
}

export function createThinkingToggle(deps: ThinkingToggleDeps): { setup: () => void } {
  const {
    els,
    getState,
    setThinkingVisible,
    getThinkingVisible,
    toggleAllThinkingBlocks,
    vscodeSetState,
  } = deps

  function setup() {
    const state = getState()
    const thinkingVisible = state.displayPrefs?.thinkingVisible ?? true
    setThinkingVisible(thinkingVisible)
    toggleAllThinkingBlocks(thinkingVisible)
    els.thinkingToggleMenuItem.setAttribute("aria-checked", String(thinkingVisible))
    els.thinkingToggleMenuItem.classList.toggle("active", thinkingVisible)
    if (els.thinkingCheckmark) {
      els.thinkingCheckmark.style.visibility = thinkingVisible ? "visible" : "hidden"
    }

    els.thinkingToggleMenuItem.addEventListener("click", () => {
      const newVisible = !getThinkingVisible()
      const currentState = getState()
      const updatedState: WebviewState = {
        ...currentState,
        displayPrefs: {
          text: currentState.displayPrefs?.text ?? true,
          tools: currentState.displayPrefs?.tools ?? true,
          diffs: currentState.displayPrefs?.diffs ?? true,
          errors: currentState.displayPrefs?.errors ?? true,
          diffWrapEnabled: currentState.displayPrefs?.diffWrapEnabled ?? false,
          thinkingVisible: newVisible,
        },
      }
      currentState.displayPrefs = updatedState.displayPrefs
      vscodeSetState(updatedState)
      setThinkingVisible(newVisible)
      els.thinkingToggleMenuItem.setAttribute("aria-checked", String(newVisible))
      els.thinkingToggleMenuItem.classList.toggle("active", newVisible)
      if (els.thinkingCheckmark) {
        els.thinkingCheckmark.style.visibility = newVisible ? "visible" : "hidden"
      }
      toggleAllThinkingBlocks(newVisible)
    })

    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault()
        els.thinkingToggleMenuItem.click()
      }
    })
  }

  return { setup }
}
