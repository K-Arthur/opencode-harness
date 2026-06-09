import { trapModalFocus } from "./sessionModal"

export interface ModeWarningEls {
  modeWarningTitle: HTMLElement
  modeWarningDescription: HTMLElement
  modeWarningModal: HTMLElement
  modeWarningCancel: HTMLButtonElement
  modeWarningConfirm: HTMLButtonElement
  modeWarningDontShow: HTMLInputElement
}

export interface ModeWarningDeps {
  els: ModeWarningEls
  postMessage: (msg: Record<string, unknown>) => void
  setMode: (mode: string) => void
}

let pendingAutoMode: string | null = null
let focusTrap: ((e: KeyboardEvent) => void) | null = null
let lastFocus: HTMLElement | null = null

export function showAutoModeWarning(deps: ModeWarningDeps): void {
  if (!deps.els.modeWarningModal.classList.contains("hidden")) closeModeWarning(deps.els)
  pendingAutoMode = "auto"
  deps.els.modeWarningDontShow.checked = false
  deps.els.modeWarningTitle.textContent = "Switch to Auto mode?"
  deps.els.modeWarningDescription.textContent =
    "Auto mode will allow the agent to apply changes without asking. The agent will have full autonomy to read, write, and execute commands. Use with caution."
  deps.els.modeWarningModal.classList.remove("hidden")
  lastFocus = document.activeElement as HTMLElement | null
  focusTrap = trapModalFocus(deps.els.modeWarningModal)
  document.addEventListener("keydown", focusTrap)
  const firstBtn = deps.els.modeWarningModal.querySelector<HTMLElement>("button")
  if (firstBtn) firstBtn.focus()
}

export function closeModeWarning(els: ModeWarningEls): void {
  els.modeWarningModal.classList.add("hidden")
  if (focusTrap) {
    document.removeEventListener("keydown", focusTrap)
    focusTrap = null
  }
  if (lastFocus) {
    lastFocus.focus({ preventScroll: true })
    lastFocus = null
  }
  pendingAutoMode = null
}

export function setupModeWarning(deps: ModeWarningDeps): void {
  deps.els.modeWarningCancel.addEventListener("click", () => closeModeWarning(deps.els))
  deps.els.modeWarningConfirm.addEventListener("click", () => {
    const mode = pendingAutoMode
    if (mode) {
      const dontShow = deps.els.modeWarningDontShow.checked
      if (dontShow) {
        deps.postMessage({ type: "update_setting", key: "autoModeConfirmed", value: true })
      }
      deps.setMode(mode)
    }
    closeModeWarning(deps.els)
  })
  deps.els.modeWarningModal.addEventListener("click", (e) => {
    if (e.target === deps.els.modeWarningModal) closeModeWarning(deps.els)
  })
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !deps.els.modeWarningModal.classList.contains("hidden")) {
      closeModeWarning(deps.els)
    }
  })
}

export function isModeWarningOpen(els: ModeWarningEls): boolean {
  return !els.modeWarningModal.classList.contains("hidden")
}
