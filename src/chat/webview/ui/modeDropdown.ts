import { normalizeSessionMode } from "../../modePolicy"
import { getModeOptionTooltip, getModeSelectorTooltip } from "../tooltips"
import { isTextEntryTarget, isModalOrDialogOpen as modalOpen } from "../keyboardShortcuts"

export interface ModeDropdownElements {
  modeDropdown: HTMLElement
  modeDropdownBtn: HTMLButtonElement
  modeDropdownMenu: HTMLElement
  modeDropdownLabel: HTMLElement
  modeCurrentText: HTMLElement
  modeOptPlan: HTMLButtonElement
  modeOptAuto: HTMLButtonElement
  modeOptBuild: HTMLButtonElement
}

export interface ModeDropdownDeps {
  els: ModeDropdownElements
  getActiveSession: () => { id: string; isStreaming?: boolean; mode?: string } | undefined
  setSessionMode: (sessionId: string, mode: string) => void
  postMessage: (msg: Record<string, unknown>) => void
  /**
   * Read the "pending" mode applied to the next session created while no
   * session is active (i.e. on the welcome screen). When omitted the dropdown
   * falls back to "build".
   */
  getDefaultMode?: () => string | undefined
  /**
   * Persist the pending mode chosen on the welcome screen so the next created
   * session adopts it. Called instead of `change_mode` when there is no active
   * session to target.
   */
  setDefaultMode?: (mode: string) => void
}

export const MODE_ORDER = ["plan", "build", "auto"] as const
const CYCLE_DEBOUNCE_MS = 200

const MODE_ICONS: Record<string, string> = {
  plan: '<svg class="mode-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3v18"/><path d="M7 3v18"/><path d="M3 7.5h18"/><path d="M3 16.5h18"/><path d="M17 3a2 2 0 0 1 2 2"/><path d="M17 21a2 2 0 0 0 2-2"/><path d="M7 3a2 2 0 0 0-2 2"/><path d="M7 21a2 2 0 0 1-2-2"/></svg>',
  auto: '<svg class="mode-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
  build: '<svg class="mode-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
}

const MODE_LABELS: Record<string, string> = { plan: "Plan", auto: "Auto", build: "Build" }

export function getCurrentMode(): string {
  return "build"
}

let _lastCycleTime = 0

/** @deprecated Use `isModalOrDialogOpen` from `../keyboardShortcuts` instead */
export function isModalOrDialogOpen(): boolean {
  return modalOpen()
}

/** Reset the cycle debounce timer. Exposed for testing. */
export function resetCycleTimer(): void {
  _lastCycleTime = 0
}

export function cycleModeForward(deps: ModeDropdownDeps): void {
  const now = Date.now()
  if (now - _lastCycleTime < CYCLE_DEBOUNCE_MS) return
  _lastCycleTime = now
  const { els, getActiveSession, postMessage } = deps
  const active = getActiveSession()
  if (active?.isStreaming) return

  // Welcome screen / no active session: cycle the pending default mode the
  // next session will adopt, and reflect it in the selector immediately.
  if (!active) {
    cyclePendingMode(deps)
    return
  }

  const currentMode = normalizeSessionMode(active?.mode) || "build"
  const idx = MODE_ORDER.indexOf(currentMode as typeof MODE_ORDER[number])
  if (idx === -1) {
    console.warn("[opencode-harness] Unknown mode for cycling:", currentMode)
    return
  }
  const nextMode = MODE_ORDER[(idx + 1) % MODE_ORDER.length]
  if (nextMode === currentMode) return
  closeModeDropdown(els)
  postMessage({ type: "change_mode", mode: nextMode, sessionId: active.id })
}

/**
 * Advance the pending "default mode" (used on the welcome screen, where no
 * session exists to receive a `change_mode`). Updates the selector UI and
 * persists the choice via `setDefaultMode` so the next created session adopts
 * it. No-op when the host did not wire the default-mode callbacks.
 */
function cyclePendingMode(deps: ModeDropdownDeps): void {
  const { els, getDefaultMode, setDefaultMode } = deps
  if (!getDefaultMode || !setDefaultMode) return
  const current = normalizeSessionMode(getDefaultMode()) || "build"
  const idx = MODE_ORDER.indexOf(current as typeof MODE_ORDER[number])
  const base = idx === -1 ? MODE_ORDER.indexOf("build") : idx
  const next = MODE_ORDER[(base + 1) % MODE_ORDER.length]!
  setDefaultMode(next)
  updateModeDropdown(next, els)
  closeModeDropdown(els)
}

export function updateModeDropdown(mode: string, els: ModeDropdownElements): void {
  const normalized = normalizeSessionMode(mode) || "build"
  els.modeCurrentText.textContent = MODE_LABELS[normalized] || normalized
  els.modeDropdownBtn.dataset.mode = normalized
  const selectorCopy = getModeSelectorTooltip(normalized as "plan" | "build" | "auto")
  els.modeDropdownBtn.title = selectorCopy.title
  els.modeDropdownBtn.setAttribute("aria-label", selectorCopy.ariaLabel)

  const iconSvg = MODE_ICONS[normalized] || MODE_ICONS["build"] || ""
  const iconEl = els.modeDropdownLabel.querySelector(".mode-icon") as HTMLElement | null
  if (iconEl) iconEl.outerHTML = iconSvg

  for (const key of ["plan", "auto", "build"]) {
    const opt = els[`modeOpt${key.charAt(0).toUpperCase() + key.slice(1)}` as keyof ModeDropdownElements] as HTMLButtonElement
    const isSelected = key === normalized
    opt.setAttribute("aria-selected", String(isSelected))
    const optionCopy = getModeOptionTooltip(key as "plan" | "build" | "auto")
    opt.title = optionCopy.title
    opt.setAttribute("aria-label", optionCopy.ariaLabel)
    opt.classList.toggle("selected", isSelected)
  }
}

export function closeModeDropdown(els: ModeDropdownElements): void {
  els.modeDropdownBtn.setAttribute("aria-expanded", "false")
  els.modeDropdownMenu.classList.add("hidden")
}

export function updateModeSelectorState(els: ModeDropdownElements, getActiveSession: ModeDropdownDeps["getActiveSession"]): void {
  const active = getActiveSession()
  const isStreaming = Boolean(active?.isStreaming)
  els.modeDropdown.classList.toggle("disabled", isStreaming)
  els.modeDropdownBtn.disabled = isStreaming
  els.modeDropdownBtn.setAttribute("aria-disabled", String(isStreaming))

  const buttons = [els.modeOptPlan, els.modeOptAuto, els.modeOptBuild]
  for (const btn of buttons) {
    btn.disabled = isStreaming
    btn.setAttribute("aria-disabled", String(isStreaming))
  }

  if (isStreaming) closeModeDropdown(els)
}

export function setupModeToggle(deps: ModeDropdownDeps): void {
  const { els, getActiveSession, postMessage } = deps

  function toggleDropdown() {
    const active = getActiveSession()
    if (active?.isStreaming) return
    const isOpen = els.modeDropdownMenu.classList.contains("hidden")
    if (isOpen) {
      els.modeDropdownMenu.classList.remove("hidden")
      els.modeDropdownBtn.setAttribute("aria-expanded", "true")
      const activeOpt = els.modeDropdownMenu.querySelector('[aria-selected="true"]') as HTMLElement | null
      if (activeOpt) activeOpt.focus()
    } else {
      closeModeDropdown(els)
    }
  }

  function requestMode(mode: string) {
    const normalized = normalizeSessionMode(mode)
    if (!normalized) return
    const active = getActiveSession()
    if (active?.isStreaming) return

    // Welcome screen / no active session: record the pending default mode and
    // reflect it in the selector instead of dropping the request on the floor.
    if (!active) {
      deps.setDefaultMode?.(normalized)
      updateModeDropdown(normalized, els)
      closeModeDropdown(els)
      return
    }

    const currentSessionMode = normalizeSessionMode(active?.mode) || "build"
    if (currentSessionMode === normalized) { closeModeDropdown(els); return }
    closeModeDropdown(els)
    postMessage({ type: "change_mode", mode: normalized, sessionId: active.id })
  }

  els.modeDropdownBtn.addEventListener("click", toggleDropdown)
  els.modeDropdownBtn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      if (els.modeDropdownMenu.classList.contains("hidden")) toggleDropdown()
    }
  })

  // Shift+Tab on the mode selector button: cycle mode forward.
  // Safe because the user is already focused on the cycle control,
  // so we are not breaking reverse-focus navigation.
  els.modeDropdownBtn.addEventListener("keydown", (e) => {
    if (e.shiftKey && e.key === "Tab") {
      e.preventDefault()
      if (isModalOrDialogOpen()) return
      const active = getActiveSession()
      if (active?.isStreaming) return
      try {
        cycleModeForward(deps)
      } catch (err) {
        console.error("[opencode-harness] Shift+Tab cycle failed:", err)
      }
    }
  })

  const options = [els.modeOptPlan, els.modeOptAuto, els.modeOptBuild]
  for (const opt of options) {
    opt.addEventListener("click", () => {
      const mode = opt.dataset.mode
      if (!mode) return
      requestMode(mode)
    })

    opt.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); opt.click() }
      if (e.key === "Escape") { closeModeDropdown(els); els.modeDropdownBtn.focus() }
      if (e.key === "ArrowDown") {
        e.preventDefault()
        const next = opt.nextElementSibling as HTMLElement | null
        if (next) next.focus()
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        const prev = opt.previousElementSibling as HTMLElement | null
        if (prev) prev.focus()
      }
    })
  }

  document.addEventListener("click", (e) => {
    const target = e.target as Node
    if (!els.modeDropdown.contains(target)) closeModeDropdown(els)
  })

  // Alt+1/2/3 set the session mode and — unlike the old Ctrl+Alt+digit binding —
  // work *while typing in the composer* (no isTextEntryTarget guard). They no longer
  // collide with steering, which dropped its Ctrl+1/2/3 triplet. Match on e.code
  // (Digit1/2/3) so layouts where Option/Alt+digit yields a special character
  // (e.g. macOS Option+1 = "¡") still resolve correctly; preventDefault stops that
  // character from being inserted into the textarea.
  document.addEventListener("keydown", (e) => {
    if (isModalOrDialogOpen()) return
    if (!e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return
    const modeByCode: Record<string, string> = { Digit1: "plan", Digit2: "build", Digit3: "auto" }
    const mode = modeByCode[e.code]
    if (!mode) return
    e.preventDefault()
    requestMode(mode)
  })

  document.addEventListener("keydown", (e) => {
    if (isModalOrDialogOpen()) return
    if (!e.altKey || !e.shiftKey || e.key !== "Tab") return
    if (e.ctrlKey || e.metaKey) return
    if (isTextEntryTarget(e.target)) return
    e.preventDefault()
    try {
      cycleModeForward(deps)
    } catch (err) {
      console.error("[opencode-harness] Alt+Shift+Tab cycle failed:", err)
    }
  })

  // Ctrl+Shift+M: cycle mode globally in the webview (M = Mode)
  document.addEventListener("keydown", (e) => {
    if (isModalOrDialogOpen()) return
    if (!e.ctrlKey && !e.metaKey) return
    if (!e.shiftKey || e.key.toLowerCase() !== "m") return
    if (isTextEntryTarget(e.target)) return
    e.preventDefault()
    try {
      cycleModeForward(deps)
    } catch (err) {
      console.error("[opencode-harness] Ctrl+Shift+M cycle failed:", err)
    }
  })
}

export function syncModeUI(
  els: ModeDropdownElements,
  getActiveSession: ModeDropdownDeps["getActiveSession"],
  getDefaultMode?: () => string | undefined,
): void {
  const active = getActiveSession()
  // With no active session (welcome screen) the selector reflects the pending
  // default mode the next session will start in, not a hardcoded "build".
  const mode = active
    ? normalizeSessionMode(active.mode) || "build"
    : normalizeSessionMode(getDefaultMode?.()) || "build"
  updateModeDropdown(mode, els)
  updateModeSelectorState(els, getActiveSession)
}
