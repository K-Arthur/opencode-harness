import type { WebviewState } from "./types"
import type { ElementRefs } from "./dom"
import { TOOLTIPS } from "./tooltips"

export interface InputHandlerDeps {
  els: ElementRefs
  vscode: { postMessage: (msg: Record<string, unknown>) => void; getState: <T>() => T | undefined; setState: (state: WebviewState) => void }
  stateManager: { getState: () => WebviewState; getActiveSession: () => { id: string; isStreaming: boolean; model?: string; mode?: string; name?: string } | null; getAllSessions: () => Array<{ id: string; isStreaming: boolean }>; save: () => void }
  attachmentManager: { onPaste: (e: ClipboardEvent) => void; getAttachments: () => Array<{ data: string; mimeType: string }>; attachImageBlob: (file: File) => void; attachFileBlob: (file: File, mimeType: string) => void; updatePromptContextChips: () => void; syncContextItemsWithPrompt: () => void }
  mention: { handleTrigger: () => void; handleKeydown: (e: KeyboardEvent) => void }
  commandsModal: { open: () => void }
  timers: { setTimeout: (fn: (...args: any[]) => void, ms: number) => any }
  sendMessage: () => void
  /** Send while streaming. `modeOverride` forces a one-shot mode (e.g. Cmd+Enter →
   *  "interrupt") without changing the tab's persisted send-mode default. */
  sendSteerPrompt: (modeOverride?: "interrupt" | "queue") => void
  setSteerMode: (mode: "interrupt" | "queue") => void
  updateSendButton: () => void
  createNewTab: (name?: string) => { id: string; name: string; mode?: string } | undefined
  closeTab: (id: string) => void
  switchTab: (id: string) => void
}

export interface InputHandlers {
  autoResizeTextarea: () => void
  onInputChange: () => void
  onInputKeydown: (e: KeyboardEvent) => void
  onPaste: (e: ClipboardEvent) => void
  insertTextAtCursor: (text: string) => void
  insertIntoPrompt: (text: string) => void
  setupInput: () => void
}

export function createInputHandlers(deps: InputHandlerDeps): InputHandlers {
  const { els, vscode, stateManager, attachmentManager, mention, commandsModal, timers, sendMessage, sendSteerPrompt, setSteerMode, updateSendButton, createNewTab, closeTab, switchTab } = deps

  function autoResizeTextarea(): void {
    if (!els.promptInput) return
    const el = els.promptInput
    const prev = el.style.overflow
    el.style.overflow = "hidden"
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 160) + "px"
    el.style.overflow = prev
  }

  // Refresh the context chips on every edit so typed/edited @file:/@folder:/@url:
  // mentions surface as styled chips live — previously chips only updated when a
  // mention was inserted via the picker, leaving manually-typed mentions as raw
  // "@file:…" text in the composer.
  function onInputChange(): void { autoResizeTextarea(); mention.handleTrigger(); attachmentManager.updatePromptContextChips(); updateSendButton() }

  // Composer submit. Not streaming → send a fresh prompt. Streaming → steer: plain
  // Enter uses the tab's send-mode default (Queue), Cmd/Ctrl+Enter forces Interrupt.
  // Steering modes are no longer bound to Ctrl+1/2/3 — that triplet clashed with the
  // session-mode shortcuts (now Alt+1/2/3 in modeDropdown).
  function dispatchSubmit(forceInterrupt: boolean): void {
    const active = stateManager.getActiveSession()
    if (active?.isStreaming) sendSteerPrompt(forceInterrupt ? "interrupt" : undefined)
    else sendMessage()
  }

  function onInputKeydown(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey) {
      const key = e.key.toLowerCase()
      if (e.key === "Enter") { e.preventDefault(); dispatchSubmit(true); els.sendBtn?.classList.add("active-feedback"); timers.setTimeout(() => els.sendBtn?.classList.remove("active-feedback"), 200); return }
      if (!e.shiftKey && key === "t") { e.preventDefault(); createNewTab(); return }
      if (!e.shiftKey && key === "w") { e.preventDefault(); const active = stateManager.getActiveSession(); if (active) closeTab(active.id); return }
      if (e.key === "Tab") { e.preventDefault(); const sessions = stateManager.getAllSessions(); const activeId = stateManager.getState().activeSessionId; if (sessions.length > 1 && activeId) { const idx = sessions.findIndex((s) => s.id === activeId); const nextIdx = e.shiftKey ? (idx - 1 + sessions.length) % sessions.length : (idx + 1) % sessions.length; const nextSession = sessions[nextIdx]; if (nextSession) switchTab(nextSession.id) }; return }
      if (!e.shiftKey && key === "k") { e.preventDefault(); commandsModal.open(); vscode.postMessage({ type: "list_commands" }); return }
    }
    if (!els.mentionDropdown.classList.contains("hidden")) { mention.handleKeydown(e); return }
    if (e.key === "Enter" && !e.shiftKey && !(e as any).isComposing) { e.preventDefault(); dispatchSubmit(false) }
  }

  function onPaste(e: ClipboardEvent): void { attachmentManager.onPaste(e) }

  function insertTextAtCursor(text: string): void {
    const input = els.promptInput
    const start = input.selectionStart ?? input.value.length
    const before = input.value.slice(0, start)
    const after = input.value.slice(input.selectionEnd ?? start)
    input.value = before + text + after
    const newPos = start + text.length
    input.selectionStart = newPos
    input.selectionEnd = newPos
    autoResizeTextarea()
    updateSendButton()
    stateManager.save()
  }

  function insertIntoPrompt(text: string): void { els.promptInput.value = text; autoResizeTextarea(); updateSendButton(); els.promptInput.focus() }

  function setupInput(): void {
    els.promptInput.addEventListener("input", onInputChange)
    els.promptInput.addEventListener("keyup", updateSendButton)
    els.promptInput.addEventListener("change", updateSendButton)
    els.promptInput.addEventListener("compositionend", onInputChange)
    els.promptInput.addEventListener("keydown", onInputKeydown)
    els.promptInput.addEventListener("paste", onPaste)
    els.sendBtn.addEventListener("click", sendMessage)
    els.mentionBtn.addEventListener("click", () => { els.promptInput.value += "@"; els.promptInput.focus(); mention.handleTrigger() })
    els.commandsPaletteBtn?.addEventListener("click", () => { commandsModal.open(); vscode.postMessage({ type: "list_commands" }) })
    const interruptBtn = document.getElementById("steer-mode-interrupt")
    const queueBtn = document.getElementById("steer-mode-queue")
    if (interruptBtn) interruptBtn.addEventListener("click", () => setSteerMode("interrupt"))
    if (queueBtn) queueBtn.addEventListener("click", () => setSteerMode("queue"))
    els.sendBtn?.setAttribute("title", TOOLTIPS.chat.send)
    window.addEventListener("oc-input-changed", () => { autoResizeTextarea(); attachmentManager.updatePromptContextChips(); attachmentManager.syncContextItemsWithPrompt(); updateSendButton() })
    els.inputArea.addEventListener("dragover", (e) => { e.preventDefault(); els.inputArea.classList.add("drag-over") })
    els.inputArea.addEventListener("dragleave", (e) => { e.preventDefault(); els.inputArea.classList.remove("drag-over") })
    els.inputArea.addEventListener("drop", (e) => {
      e.preventDefault(); els.inputArea.classList.remove("drag-over")
      const files = e.dataTransfer?.files
      if (files && files.length > 0) {
        const fileMentions: string[] = []
        const imageMimes = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"] as const
        const docMimes = ["text/plain", "text/markdown", "text/csv", "text/html", "text/css", "text/javascript", "application/json", "application/xml", "application/pdf", "application/x-yaml", "application/x-sh"] as const
        for (const f of Array.from(files)) {
          if (imageMimes.includes(f.type as typeof imageMimes[number])) {
            attachmentManager.attachImageBlob(f)
          } else if (docMimes.includes(f.type as typeof docMimes[number])) {
            attachmentManager.attachFileBlob(f, f.type)
          } else {
            const relPath = (f as { webkitRelativePath?: string }).webkitRelativePath || f.name
            fileMentions.push(`@file:${relPath}`)
          }
        }
        if (fileMentions.length > 0) insertTextAtCursor(fileMentions.join(" "))
      }
    })
  }

  return { autoResizeTextarea, onInputChange, onInputKeydown, onPaste, insertTextAtCursor, insertIntoPrompt, setupInput }
}
