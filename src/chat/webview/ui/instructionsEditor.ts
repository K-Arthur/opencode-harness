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

  let resizeHandler: (() => void) | null = null

  function positionEditor() {
    const btn = els.instructionsGearBtn
    const editor = els.instructionsEditor
    if (!btn || !editor) return
    const margin = 8
    const r = btn.getBoundingClientRect()
    const editorW = 320
    const estimatedHeight = 180
    
    const spaceBelow = window.innerHeight - r.bottom - margin
    const spaceAbove = r.top - margin
    const openAbove = spaceBelow < estimatedHeight && spaceAbove > spaceBelow
    const maxHeight = Math.max(160, Math.floor((openAbove ? spaceAbove : spaceBelow) - 4))
    
    const leftEdge = Math.min(
      Math.max(margin, r.right - editorW),
      Math.max(margin, window.innerWidth - editorW - margin),
    )
    const top = openAbove
      ? Math.max(margin, r.top - estimatedHeight - 6)
      : Math.min(window.innerHeight - margin - estimatedHeight, r.bottom + 6)
      
    editor.style.position = "fixed"
    editor.style.top = `${Math.max(margin, top)}px`
    editor.style.left = `${leftEdge}px`
    editor.style.right = "auto"
    editor.style.width = `${editorW}px`
  }

  function openEditor() {
    const active = getActiveSession()
    els.instructionsTextarea.value = active?.instructions ?? ""
    els.instructionsEditor.classList.remove("hidden")
    els.instructionsGearBtn.setAttribute("aria-expanded", "true")
    positionEditor()
    resizeHandler = () => positionEditor()
    window.addEventListener("resize", resizeHandler)
    els.instructionsTextarea.focus()
  }

  function closeEditor() {
    els.instructionsEditor.classList.add("hidden")
    els.instructionsGearBtn.setAttribute("aria-expanded", "false")
    if (saveDebounce) { clearTimeout(saveDebounce); saveDebounce = null }
    if (resizeHandler) {
      window.removeEventListener("resize", resizeHandler)
      resizeHandler = null
    }
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
