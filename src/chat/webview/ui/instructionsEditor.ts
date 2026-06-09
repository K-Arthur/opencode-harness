export interface InstructionsEditorElements {
  instructionsEditor: HTMLElement
  instructionsGearBtn: HTMLButtonElement
  instructionsTextarea: HTMLTextAreaElement
  instructionsSaveBtn: HTMLButtonElement
  instructionsCancelBtn: HTMLButtonElement
}

export interface InstructionsEditorDeps {
  els: InstructionsEditorElements
  getActiveSession: () => { id: string; instructions?: string } | undefined
  saveSession: () => void
  postMessage: (msg: Record<string, unknown>) => void
  clearTimeout: (id: ReturnType<typeof setTimeout> | null) => void
}

export function setupInstructionsEditor(deps: InstructionsEditorDeps): void {
  const { els, getActiveSession, saveSession, postMessage, clearTimeout } = deps
  let saveDebounce: ReturnType<typeof setTimeout> | null = null

  function getFocusables(): HTMLElement[] {
    return Array.from(
      els.instructionsEditor.querySelectorAll<HTMLElement>("textarea, button:not([disabled])")
    )
  }

  function openEditor() {
    const active = getActiveSession()
    els.instructionsTextarea.value = active?.instructions ?? ""
    els.instructionsEditor.classList.remove("hidden")
    els.instructionsGearBtn.setAttribute("aria-expanded", "true")
    els.instructionsTextarea.focus()
  }

  function closeEditor() {
    els.instructionsEditor.classList.add("hidden")
    els.instructionsGearBtn.setAttribute("aria-expanded", "false")
    if (saveDebounce) { clearTimeout(saveDebounce); saveDebounce = null }
    els.instructionsGearBtn.focus()
  }

  function saveInstructions() {
    const active = getActiveSession()
    if (!active) return
    const text = els.instructionsTextarea.value
    active.instructions = text
    saveSession()
    postMessage({ type: "set_instructions", sessionId: active.id, instructions: text })
    closeEditor()
  }

  els.instructionsGearBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    if (els.instructionsEditor.classList.contains("hidden")) openEditor()
    else closeEditor()
  })

  els.instructionsSaveBtn.addEventListener("click", saveInstructions)
  els.instructionsCancelBtn.addEventListener("click", closeEditor)

  els.instructionsEditor.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveInstructions(); return }
    if (e.key === "Escape") { closeEditor(); return }
    if (e.key === "Tab") {
      const focusables = getFocusables()
      if (focusables.length === 0) return
      const first = focusables[0]!
      const last = focusables[focusables.length - 1]!
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus() }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
  })

  document.addEventListener("click", (e) => {
    const target = e.target as Node
    if (!els.instructionsEditor.contains(target) && !els.instructionsGearBtn.contains(target)) {
      if (!els.instructionsEditor.classList.contains("hidden")) closeEditor()
    }
  })
}
