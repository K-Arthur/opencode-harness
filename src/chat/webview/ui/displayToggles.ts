export interface DisplayToggleElements {
  toggleText: HTMLInputElement
  toggleTools: HTMLInputElement
  toggleDiffs: HTMLInputElement
  toggleErrors: HTMLInputElement
}

export interface DisplayPrefs {
  text: boolean
  tools: boolean
  diffs: boolean
  errors: boolean
}

export interface DisplayToggleDeps {
  els: DisplayToggleElements
  getState: () => { displayPrefs?: Partial<DisplayPrefs> }
  save: () => void
}

export function setupDisplayToggles(deps: DisplayToggleDeps): void {
  const { els, getState, save } = deps
  const prefs = loadDisplayPrefs(getState)
  els.toggleText.checked = prefs.text
  els.toggleTools.checked = prefs.tools
  els.toggleDiffs.checked = prefs.diffs
  els.toggleErrors.checked = prefs.errors
  applyDisplayPrefs(els)

  const persist = () => {
    saveDisplayPrefs(getState, save, {
      text: els.toggleText.checked,
      tools: els.toggleTools.checked,
      diffs: els.toggleDiffs.checked,
      errors: els.toggleErrors.checked,
    })
    applyDisplayPrefs(els)
  }
  els.toggleText.addEventListener("change", persist)
  els.toggleTools.addEventListener("change", persist)
  els.toggleDiffs.addEventListener("change", persist)
  els.toggleErrors.addEventListener("change", persist)
}

function loadDisplayPrefs(getState: () => { displayPrefs?: Partial<DisplayPrefs> }): DisplayPrefs {
  try {
    const prefs = getState().displayPrefs
    return {
      text: prefs?.text !== false,
      tools: prefs?.tools !== false,
      diffs: prefs?.diffs !== false,
      errors: prefs?.errors !== false,
    }
  } catch {
    return { text: true, tools: true, diffs: true, errors: true }
  }
}

function saveDisplayPrefs(getState: () => { displayPrefs?: Partial<DisplayPrefs> }, save: () => void, prefs: DisplayPrefs): void {
  try {
    getState().displayPrefs = prefs
    save()
  } catch {}
}

function applyDisplayPrefs(els: DisplayToggleElements): void {
  const root = document.body
  root.classList.toggle("hide-text", !els.toggleText.checked)
  root.classList.toggle("hide-tools", !els.toggleTools.checked)
  root.classList.toggle("hide-diffs", !els.toggleDiffs.checked)
  root.classList.toggle("hide-errors", !els.toggleErrors.checked)
}
