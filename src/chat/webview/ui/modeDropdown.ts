import { normalizeSessionMode } from "../../modePolicy"

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
}

const MODE_ICONS: Record<string, string> = {
  plan: '<svg class="mode-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3v18"/><path d="M7 3v18"/><path d="M3 7.5h18"/><path d="M3 16.5h18"/><path d="M17 3a2 2 0 0 1 2 2"/><path d="M17 21a2 2 0 0 0 2-2"/><path d="M7 3a2 2 0 0 0-2 2"/><path d="M7 21a2 2 0 0 1-2-2"/></svg>',
  auto: '<svg class="mode-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
  build: '<svg class="mode-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
}

const MODE_LABELS: Record<string, string> = { plan: "Plan", auto: "Auto", build: "Build" }
const MODE_DESCRIPTIONS: Record<string, string> = {
  plan: "Plan mode: review and propose changes before applying them.",
  build: "Build mode: apply changes with normal permission prompts.",
  auto: "Auto mode: apply changes without stopping for each permission prompt.",
}
const MODE_SHORTCUTS: Record<string, string> = {
  plan: "Ctrl/Cmd+Alt+1",
  build: "Ctrl/Cmd+Alt+2",
  auto: "Ctrl/Cmd+Alt+3",
}

export function getCurrentMode(): string {
  return "build"
}

export function updateModeDropdown(mode: string, els: ModeDropdownElements): void {
  const normalized = normalizeSessionMode(mode) || "build"
  els.modeCurrentText.textContent = MODE_LABELS[normalized] || normalized
  els.modeDropdownBtn.dataset.mode = normalized
  els.modeDropdownBtn.title = `${MODE_DESCRIPTIONS[normalized]} Shortcut: ${MODE_SHORTCUTS[normalized]}.`
  els.modeDropdownBtn.setAttribute("aria-label", `Mode: ${MODE_LABELS[normalized]}. ${MODE_DESCRIPTIONS[normalized]} Shortcut: ${MODE_SHORTCUTS[normalized]}.`)

  const iconSvg = MODE_ICONS[normalized] || MODE_ICONS["build"] || ""
  const iconEl = els.modeDropdownLabel.querySelector(".mode-icon") as HTMLElement | null
  if (iconEl) iconEl.outerHTML = iconSvg

  for (const key of ["plan", "auto", "build"]) {
    const opt = els[`modeOpt${key.charAt(0).toUpperCase() + key.slice(1)}` as keyof ModeDropdownElements] as HTMLButtonElement
    const isSelected = key === normalized
    opt.setAttribute("aria-selected", String(isSelected))
    opt.title = `${MODE_DESCRIPTIONS[key]} Shortcut: ${MODE_SHORTCUTS[key]}.`
    opt.setAttribute("aria-label", `${MODE_LABELS[key]} mode. ${MODE_DESCRIPTIONS[key]} Shortcut: ${MODE_SHORTCUTS[key]}.`)
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
    const currentSessionMode = normalizeSessionMode(active?.mode) || "build"
    if (currentSessionMode === normalized) { closeModeDropdown(els); return }
    closeModeDropdown(els)
    if (active) {
      postMessage({ type: "change_mode", mode: normalized, sessionId: active.id })
    }
  }

  function isTextEntryTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null
    if (!el) return false
    const tag = el.tagName?.toLowerCase()
    return Boolean(el.isContentEditable || tag === "input" || tag === "textarea" || tag === "select")
  }

  els.modeDropdownBtn.addEventListener("click", toggleDropdown)
  els.modeDropdownBtn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      if (els.modeDropdownMenu.classList.contains("hidden")) toggleDropdown()
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

  document.addEventListener("keydown", (e) => {
    if (!e.altKey || e.shiftKey || (!e.ctrlKey && !e.metaKey) || isTextEntryTarget(e.target)) return
    const modeByKey: Record<string, string> = { "1": "plan", "2": "build", "3": "auto" }
    const mode = modeByKey[e.key]
    if (!mode) return
    e.preventDefault()
    requestMode(mode)
  })
}

export function syncModeUI(els: ModeDropdownElements, getActiveSession: ModeDropdownDeps["getActiveSession"]): void {
  const active = getActiveSession()
  const mode = normalizeSessionMode(active?.mode) || "build"
  updateModeDropdown(mode, els)
  updateModeSelectorState(els, getActiveSession)
}
