import type { WebviewState } from "./types"
import type { ElementRefs } from "./dom"

export interface InputHandlerDeps {
  els: ElementRefs
  vscode: {
    postMessage: (msg: Record<string, unknown>) => void
    getState: <T>() => T | undefined
    setState: (state: WebviewState) => void
  }
  stateManager: {
    getState: () => WebviewState
    getActiveSession: () => { id: string; isStreaming: boolean; model?: string; mode?: string; name?: string } | null
    getAllSessions: () => Array<{ id: string; isStreaming: boolean }>
    save: () => void
  }
  attachmentManager: {
    onPaste: (e: ClipboardEvent) => void
    getAttachments: () => Array<{ data: string; mimeType: string }>
    attachImageBlob: (file: File) => void
  }
  mention: {
    handleTrigger: () => void
    handleKeydown: (e: KeyboardEvent) => void
  }
  commandsModal: {
    open: () => void
  }
  timers: {
    setTimeout: (fn: (...args: any[]) => void, ms: number) => any
  }
  sendMessage: () => void
  sendSteerPrompt: () => void
  setSteerMode: (mode: "interrupt" | "append" | "queue") => void
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
  const {
    els, vscode, stateManager, attachmentManager, mention,
    commandsModal, timers,
    sendMessage, sendSteerPrompt, setSteerMode,
    updateSendButton, createNewTab, closeTab, switchTab,
  } = deps

  function autoResizeTextarea(): void {
    if (!els.promptInput) return
    const el = els.promptInput
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 200) + "px"
  }

  function onInputChange(): void {
    autoResizeTextarea()
    mention.handleTrigger()
    updateSendButton()
  }

  function onInputKeydown(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === "Enter") {
        e.preventDefault()
        const active = stateManager.getActiveSession()
        if (active?.isStreaming) {
          sendSteerPrompt()
        } else {
          sendMessage()
        }
        els.sendBtn?.classList.add("active-feedback")
        timers.setTimeout(() => els.sendBtn?.classList.remove("active-feedback"), 200)
        return
      }
      if (e.key === "t") {
        e.preventDefault()
        createNewTab()
        return
      }
      if (e.key === "w") {
        e.preventDefault()
        const active = stateManager.getActiveSession()
        if (active) closeTab(active.id)
        return
      }
      if (e.key === "Tab") {
        e.preventDefault()
        const sessions = stateManager.getAllSessions()
        const activeId = stateManager.getState().activeSessionId
        if (sessions.length > 1 && activeId) {
          const idx = sessions.findIndex((s) => s.id === activeId)
          const nextIdx = e.shiftKey
            ? (idx - 1 + sessions.length) % sessions.length
            : (idx + 1) % sessions.length
          const nextSession = sessions[nextIdx]
          if (nextSession) switchTab(nextSession.id)
        }
        return
      }
      if (e.key === "1") {
        e.preventDefault()
        setSteerMode("interrupt")
        return
      }
      if (e.key === "2") {
        e.preventDefault()
        setSteerMode("append")
        return
      }
      if (e.key === "3") {
        e.preventDefault()
        setSteerMode("queue")
        return
      }
    }

    if (!els.mentionDropdown.classList.contains("hidden")) {
      mention.handleKeydown(e)
      return
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      const active = stateManager.getActiveSession()
      if (active?.isStreaming) {
        sendSteerPrompt()
      } else {
        sendMessage()
      }
    }
  }

  function onPaste(e: ClipboardEvent): void {
    attachmentManager.onPaste(e)
  }

  function insertTextAtCursor(text: string): void {
    const input = els.promptInput
    const start = input.selectionStart ?? input.value.length
    const before = input.value.slice(0, start)
    const after = input.value.slice(input.selectionEnd ?? start)
    input.value = before + text + after
    autoResizeTextarea()
    updateSendButton()
    stateManager.save()
  }

  function insertIntoPrompt(text: string): void {
    els.promptInput.value = text
    autoResizeTextarea()
    updateSendButton()
    els.promptInput.focus()
  }

  function setupInput(): void {
    els.promptInput.addEventListener("input", onInputChange)
    els.promptInput.addEventListener("keyup", updateSendButton)
    els.promptInput.addEventListener("change", updateSendButton)
    els.promptInput.addEventListener("compositionend", onInputChange)
    els.promptInput.addEventListener("keydown", onInputKeydown)
    els.promptInput.addEventListener("paste", onPaste)
    els.sendBtn.addEventListener("click", sendMessage)
    els.mentionBtn.addEventListener("click", () => {
      els.promptInput.value += "@"
      els.promptInput.focus()
      mention.handleTrigger()
    })
    els.commandsPaletteBtn.addEventListener("click", () => {
      commandsModal.open()
      vscode.postMessage({ type: "list_commands" })
    })

    const interruptBtn = document.getElementById("steer-mode-interrupt") as HTMLButtonElement
    const appendBtn = document.getElementById("steer-mode-append") as HTMLButtonElement
    const queueBtn = document.getElementById("steer-mode-queue") as HTMLButtonElement

    if (interruptBtn) {
      interruptBtn.addEventListener("click", () => setSteerMode("interrupt"))
    }
    if (appendBtn) {
      appendBtn.addEventListener("click", () => setSteerMode("append"))
    }
    if (queueBtn) {
      queueBtn.addEventListener("click", () => setSteerMode("queue"))
    }

    els.sendBtn?.setAttribute("title", "Send (Ctrl+Enter)")

    window.addEventListener("oc-input-changed", () => {
      autoResizeTextarea()
      updateSendButton()
    })

    els.inputArea.addEventListener("dragover", (e) => {
      e.preventDefault()
      e.stopPropagation()
      els.inputArea.classList.add("drag-over")
    })
    els.inputArea.addEventListener("dragleave", (e) => {
      e.preventDefault()
      e.stopPropagation()
      els.inputArea.classList.remove("drag-over")
    })
    els.inputArea.addEventListener("drop", (e) => {
      e.preventDefault()
      e.stopPropagation()
      els.inputArea.classList.remove("drag-over")
      const files = e.dataTransfer?.files
      if (files && files.length > 0) {
        const fileMentions: string[] = []
        const allowedMimes = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const
        for (const f of Array.from(files)) {
          if (allowedMimes.includes(f.type as typeof allowedMimes[number])) {
            attachmentManager.attachImageBlob(f)
          } else {
            const relPath = (f as { webkitRelativePath?: string }).webkitRelativePath || f.name
            fileMentions.push(`@file:${relPath}`)
          }
        }
        if (fileMentions.length > 0) insertTextAtCursor(fileMentions.join(" "))
      }
    })
  }

  return {
    autoResizeTextarea,
    onInputChange,
    onInputKeydown,
    onPaste,
    insertTextAtCursor,
    insertIntoPrompt,
    setupInput,
  }
}
