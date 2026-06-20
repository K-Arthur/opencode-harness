import type { ElementRefs } from "../dom"
import { isModalOrDialogOpen } from "./modeDropdown"
import { openKeyboardShortcutsModal } from "./keyboardShortcutsModal"
import type { SurfaceCoordinator } from "../surfaceCoordinator"

/**
 * Dependencies required by the global keyboard-shortcut handler.
 * Threaded explicitly from the main IIFE to avoid closure capture.
 */
export interface KeyboardShortcutDeps {
  els: ElementRefs
  vscode: {
    postMessage: (msg: Record<string, unknown>) => void
  }
  stateManager: {
    getAllSessions: () => Array<{ id: string }>
    getState: () => { activeSessionId: string | null }
    getActiveSession: () => { id: string } | undefined
  }
  switchTab: (id: string) => void
  createNewTab: () => void
  closeTab: (id: string) => void
  surfaceCoord: SurfaceCoordinator | null
  commandsModal: {
    open: () => void
  }
}

/**
 * Wires document-level keyboard shortcuts for tab management, command palette,
 * search, timeline/todos/checkpoint/subagent/skills toggles, and the shortcuts
 * help overlay. Extracted from main.ts to reduce the god-module's surface.
 *
 * @param deps - Explicit closure dependencies from the main IIFE.
 */
export function setupGlobalKeyboardShortcutsImpl(deps: KeyboardShortcutDeps): void {
  const { els, vscode, stateManager, switchTab, createNewTab, closeTab, surfaceCoord, commandsModal } = deps
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented) return
    const isTextInput = (el: EventTarget | null): boolean => {
      const target = el as HTMLElement | null
      if (!target) return false
      const tag = target.tagName?.toLowerCase()
      return Boolean(target.isContentEditable || tag === "input" || tag === "textarea" || tag === "select")
    }
    const switchRelativeTab = (direction: 1 | -1): void => {
      const sessions = stateManager.getAllSessions()
      const activeId = stateManager.getState().activeSessionId
      if (sessions.length <= 1 || !activeId) return
      const idx = sessions.findIndex((s) => s.id === activeId)
      if (idx < 0) return
      const nextSession = sessions[(idx + direction + sessions.length) % sessions.length]
      if (nextSession) switchTab(nextSession.id)
    }

    if (isModalOrDialogOpen()) return

    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const key = e.key.toLowerCase()
      if (!e.shiftKey && key === "t" && !isTextInput(e.target)) {
        e.preventDefault()
        createNewTab()
        return
      }
      if (!e.shiftKey && key === "w" && !isTextInput(e.target)) {
        const active = stateManager.getActiveSession()
        if (active) {
          e.preventDefault()
          closeTab(active.id)
        }
        return
      }
      if (key === "tab" && !isTextInput(e.target)) {
        e.preventDefault()
        switchRelativeTab(e.shiftKey ? -1 : 1)
        return
      }
    }

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      const key = e.key.toLowerCase()
      if (key === "l" && !isTextInput(e.target)) {
        e.preventDefault()
        els.promptInput.focus()
        return
      }
      if (key === "k" && !isTextInput(e.target)) {
        e.preventDefault()
        surfaceCoord?.closeOthers("commands-modal")
        commandsModal.open()
        vscode.postMessage({ type: "list_commands" })
        return
      }
      if (key === "f" && !isTextInput(e.target)) {
        e.preventDefault()
        const searchBar = document.getElementById("chat-search-bar")
        if (searchBar) {
          searchBar.classList.toggle("hidden")
          if (!searchBar.classList.contains("hidden")) {
            const input = document.getElementById("chat-search-input") as HTMLInputElement | null
            input?.focus()
            input?.select()
          }
        }
        return
      }
    }

    if (e.key === "/" && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && !isTextInput(e.target)) {
      e.preventDefault()
      openKeyboardShortcutsModal()
      return
    }

    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.altKey) {
      switch (e.key) {
        case "L":
        case "l":
          e.preventDefault()
          els.timelineToggleBtn.click()
          break
        case "T":
        case "t":
          e.preventDefault()
          els.todosToggleBtn.click()
          break
        case "K":
        case "k":
          e.preventDefault()
          els.checkpointToggleBtn.click()
          break
        case "A":
        case "a":
          e.preventDefault()
          els.subagentsToggleBtn.click()
          break
        case "S":
        case "s":
          e.preventDefault()
          els.skillsBtn.click()
          break
        case "N":
        case "n":
          e.preventDefault()
          vscode.postMessage({ type: "create_tab" })
          break
        case "H":
        case "h":
          e.preventDefault()
          els.historyBtn.click()
          break
      }
    }
  })
}
