export interface ShortcutRow {
  keys: string
  action: string
  context: string
}

const SHORTCUT_TABLE: ShortcutRow[] = [
  { keys: "Ctrl+Alt+O", action: "Toggle OpenCode chat focus", context: "Global" },
  { keys: "Ctrl+Alt+N", action: "New session", context: "Global" },
  { keys: "Ctrl+I", action: "Quick chat", context: "Editor focused" },
  { keys: "Alt+K", action: "Insert file reference (@)", context: "Editor focused" },
  { keys: "Escape", action: "Stop / close modal / close dropdown", context: "Chat view / modals" },
  { keys: "Ctrl+Shift+Esc", action: "Stop active session", context: "Chat view" },
  { keys: "Ctrl+Shift+/", action: "Commands palette", context: "Chat view" },
  { keys: "Shift+Tab", action: "Cycle mode (Plan → Build → Auto)", context: "Mode button focused" },
  { keys: "Alt+Shift+Tab", action: "Cycle mode (Plan → Build → Auto)", context: "Chat view" },
  { keys: "Ctrl+Shift+M", action: "Cycle mode (Plan → Build → Auto)", context: "Chat view" },
  { keys: "Ctrl/Cmd+Alt+1", action: "Set Plan mode", context: "Chat view" },
  { keys: "Ctrl/Cmd+Alt+2", action: "Set Build mode", context: "Chat view" },
  { keys: "Ctrl/Cmd+Alt+3", action: "Set Auto mode", context: "Chat view" },
  { keys: "Ctrl/Cmd+L", action: "Focus prompt input", context: "Chat view" },
  { keys: "Ctrl/Cmd+Enter", action: "Send / Steer", context: "Prompt focused" },
  { keys: "Enter", action: "Send", context: "Prompt focused" },
  { keys: "Ctrl/Cmd+T", action: "New tab", context: "Prompt focused" },
  { keys: "Ctrl/Cmd+W", action: "Close tab", context: "Prompt focused" },
  { keys: "Ctrl/Cmd+Tab", action: "Next tab", context: "Prompt focused" },
  { keys: "Ctrl/Cmd+Shift+Tab", action: "Previous tab", context: "Prompt focused" },
  { keys: "Ctrl+Alt+]", action: "Next tab", context: "Chat view" },
  { keys: "Ctrl+Alt+[", action: "Previous tab", context: "Chat view" },
  { keys: "Ctrl/Cmd+1", action: "Steer mode: Interrupt", context: "Prompt focused" },
  { keys: "Ctrl/Cmd+2", action: "Steer mode: Append", context: "Prompt focused" },
  { keys: "Ctrl/Cmd+3", action: "Steer mode: Queue", context: "Prompt focused" },
  { keys: "Ctrl/Cmd+K", action: "Open commands palette", context: "Prompt focused" },
  { keys: "Ctrl/Cmd+Shift+T", action: "Toggle thinking blocks", context: "Chat view" },
  { keys: "Ctrl+Shift+E", action: "Toggle errors", context: "Chat view" },
  { keys: "Ctrl+Shift+D", action: "Toggle diffs / changed files", context: "Chat view" },
  { keys: "Ctrl+Shift+O", action: "Toggle tools visibility", context: "Chat view" },
  { keys: "Ctrl+Shift+Alt+L", action: "Toggle timeline sidebar", context: "Chat view" },
  { keys: "Ctrl+Shift+Alt+T", action: "Toggle todos panel", context: "Chat view" },
  { keys: "Ctrl+Shift+Alt+K", action: "Toggle checkpoint panel", context: "Chat view" },
  { keys: "Ctrl+Shift+Alt+A", action: "Toggle activity/subagent panel", context: "Chat view" },
  { keys: "Ctrl+Shift+Alt+S", action: "Open skills modal", context: "Chat view" },
  { keys: "Ctrl+Shift+Alt+H", action: "Open session history", context: "Chat view" },
  { keys: "Ctrl+Shift+Alt+N", action: "New session", context: "Chat view" },
  { keys: "Ctrl+Alt+R", action: "Retry last failed run", context: "Chat view" },
  { keys: "Ctrl/Cmd+F", action: "Search messages in session", context: "Chat view" },
  { keys: "? (Shift+/)", action: "Open this help", context: "Chat view" },
  { keys: "E / Space", action: "Expand / collapse current tool call", context: "Tool call focused" },
  { keys: "C", action: "Copy current tool output", context: "Tool call focused" },
]

let modalEl: HTMLElement | null = null
let closeBtnEl: HTMLElement | null = null

function renderTable(rows: ShortcutRow[]): string {
  return rows
    .map(
      (r) =>
        `<tr><td><kbd>${r.keys.replace(/\//g, "</kbd>+<kbd>")}</kbd></td><td>${r.action}</td><td>${r.context}</td></tr>`
    )
    .join("")
}

export function openKeyboardShortcutsModal(): void {
  if (!modalEl) return
  modalEl.classList.remove("hidden")
  closeBtnEl?.focus()
}

export function closeKeyboardShortcutsModal(): void {
  if (!modalEl) return
  modalEl.classList.add("hidden")
}

export function setupKeyboardShortcutsModal(container: HTMLElement): void {
  modalEl = document.createElement("div")
  modalEl.id = "keyboard-shortcuts-modal"
  modalEl.className = "modal-overlay hidden"
  modalEl.setAttribute("role", "dialog")
  modalEl.setAttribute("aria-label", "Keyboard Shortcuts")
  modalEl.setAttribute("aria-modal", "true")

  const inner = document.createElement("div")
  inner.className = "modal-content keyboard-shortcuts-content"

  const header = document.createElement("div")
  header.className = "modal-header"
  const title = document.createElement("h2")
  title.textContent = "Keyboard Shortcuts"
  header.appendChild(title)

  closeBtnEl = document.createElement("button")
  closeBtnEl.className = "modal-close-btn"
  closeBtnEl.setAttribute("aria-label", "Close")
  closeBtnEl.textContent = "\u00D7"
  closeBtnEl.addEventListener("click", () => closeKeyboardShortcutsModal())
  header.appendChild(closeBtnEl)
  inner.appendChild(header)

  const table = document.createElement("table")
  table.className = "keyboard-shortcuts-table"
  table.innerHTML = `
    <thead><tr><th>Shortcut</th><th>Action</th><th>Context</th></tr></thead>
    <tbody>${renderTable(SHORTCUT_TABLE)}</tbody>
  `
  inner.appendChild(table)
  modalEl.appendChild(inner)
  container.appendChild(modalEl)

  modalEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation()
      closeKeyboardShortcutsModal()
    }
  })
}
