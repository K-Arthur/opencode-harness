/**
 * Commands Modal — central palette for all slash commands (local + server + custom prompts)
 * and for browsing stashed prompts. Triggered by /commands, the `list_commands` flow, or a keybinding.
 *
 * Patterned after skills-modal.ts. Uses postMessage for execution so the host owns auth/state.
 */

export interface CommandEntry {
  /** Without leading slash. */
  name: string
  description: string
  /** "local" — handled in webview; "server" — proxied via execute_command; "prompt" — custom prompt template. */
  source: "local" | "server" | "prompt"
  /** When source === "local", a fully formed slash command to insert into the prompt input. */
  insertText?: string
}

export interface StashEntry {
  id: string
  name: string
  content: string
  isGlobal: boolean
}

export interface CommandsModalOptions {
  /** Local (webview-resolved) commands — populated up front in main.ts. */
  localCommands: CommandEntry[]
  /** Called when the user picks a command — receives the entry. The modal closes on its own. */
  onRun: (entry: CommandEntry) => void
  /** Insert a string into the prompt input (used to populate /command stubs without sending). */
  onInsert: (text: string) => void
  /** Use a stashed prompt — caller decides whether to insert vs send. */
  onUseStash: (stash: StashEntry) => void
  /** Delete a stash by id. */
  onDeleteStash: (id: string) => void
  /** Mention dropdown to hide when modal opens. */
  mentionDropdown?: HTMLElement | null
}

type Mode = "commands" | "stashes"

export interface CommandsModalHandle {
  open(): void
  openStashList(stashes: StashEntry[]): void
  close(): void
  updateServerCommands(commands: Array<{ name: string; description?: string; template?: string }>): void
  updatePromptCommands(prompts: Array<{ name: string; description?: string }>): void
}

export function setupCommandsModal(els: {
  commandsModal: HTMLElement | null
  commandsList: HTMLElement | null
  commandsSearchInput: HTMLInputElement | null
  commandsTitle: HTMLElement | null
  commandsFilter: HTMLElement | null
  commandsModalCloseBtn: HTMLElement | null
}, options: CommandsModalOptions): CommandsModalHandle {
  const { commandsModal, commandsList, commandsSearchInput, commandsTitle, commandsFilter, commandsModalCloseBtn } = els
  if (!commandsModal || !commandsList || !commandsSearchInput || !commandsModalCloseBtn) {
    console.warn("[commands-modal] required elements missing — modal disabled")
    return { open() {}, openStashList() {}, close() {}, updateServerCommands() {}, updatePromptCommands() {} }
  }

  let serverCommands: CommandEntry[] = []
  let promptCommands: CommandEntry[] = []
  let stashEntries: StashEntry[] = []
  let mode: Mode = "commands"
  /** "all" | "local" | "server" | "prompt" | "stash" — filter chip state */
  let activeFilter: string = "all"
  let lastFocused: HTMLElement | null = null

  function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
  }

  function open(): void {
    mode = "commands"
    activeFilter = "all"
    if (options.mentionDropdown) options.mentionDropdown.classList.add("hidden")
    commandsModal!.classList.remove("hidden")
    if (commandsTitle) commandsTitle.textContent = "Commands"
    commandsSearchInput!.value = ""
    commandsSearchInput!.placeholder = "Search commands..."
    lastFocused = document.activeElement as HTMLElement | null
    renderFilters()
    render()
    setTimeout(() => commandsSearchInput!.focus(), 0)
  }

  function openStashList(stashes: StashEntry[]): void {
    mode = "stashes"
    stashEntries = stashes
    activeFilter = "all"
    if (options.mentionDropdown) options.mentionDropdown.classList.add("hidden")
    commandsModal!.classList.remove("hidden")
    if (commandsTitle) commandsTitle.textContent = "Stashed prompts"
    commandsSearchInput!.value = ""
    commandsSearchInput!.placeholder = "Search stashes..."
    renderFilters()
    render()
    setTimeout(() => commandsSearchInput!.focus(), 0)
  }

  function close(): void {
    commandsModal!.classList.add("hidden")
    if (lastFocused && typeof lastFocused.focus === "function") {
      try { lastFocused.focus() } catch { /* element may have been removed */ }
    }
  }

  function updateServerCommands(commands: Array<{ name: string; description?: string; template?: string }>): void {
    serverCommands = commands.map(c => ({
      name: c.name,
      description: c.description || c.template || "Server command",
      source: "server" as const,
    }))
    if (mode === "commands" && !commandsModal!.classList.contains("hidden")) render()
  }

  function updatePromptCommands(prompts: Array<{ name: string; description?: string }>): void {
    promptCommands = prompts.map(p => ({
      name: p.name,
      description: p.description || "Custom prompt",
      source: "prompt" as const,
    }))
    if (mode === "commands" && !commandsModal!.classList.contains("hidden")) render()
  }

  function renderFilters(): void {
    if (!commandsFilter) return
    commandsFilter.innerHTML = ""
    const chips: Array<{ key: string; label: string }> = mode === "stashes"
      ? [
          { key: "all", label: "All" },
          { key: "global", label: "Global" },
          { key: "session", label: "Session" },
        ]
      : [
          { key: "all", label: "All" },
          { key: "local", label: "Built-in" },
          { key: "server", label: "Server" },
          { key: "prompt", label: "Custom" },
        ]
    for (const chip of chips) {
      const btn = document.createElement("button")
      btn.className = "commands-modal-filter-btn" + (activeFilter === chip.key ? " active" : "")
      btn.textContent = chip.label
      btn.dataset.filter = chip.key
      btn.setAttribute("aria-pressed", activeFilter === chip.key ? "true" : "false")
      btn.addEventListener("click", () => {
        activeFilter = chip.key
        commandsFilter!.querySelectorAll<HTMLElement>(".commands-modal-filter-btn").forEach(b => {
          const isActive = b.dataset.filter === activeFilter
          b.classList.toggle("active", isActive)
          b.setAttribute("aria-pressed", isActive ? "true" : "false")
        })
        render()
      })
      commandsFilter.appendChild(btn)
    }
  }

  function matchesQuery(name: string, description: string, query: string): boolean {
    if (!query) return true
    const q = query.toLowerCase()
    return name.toLowerCase().includes(q) || description.toLowerCase().includes(q)
  }

  function render(): void {
    const query = commandsSearchInput!.value.trim()
    commandsList!.innerHTML = ""

    if (mode === "stashes") {
      renderStashes(query)
      return
    }
    renderCommands(query)
  }

  function renderCommands(query: string): void {
    const all = [...options.localCommands, ...serverCommands, ...promptCommands]
    const filtered = all.filter(c => {
      if (activeFilter !== "all" && c.source !== activeFilter) return false
      return matchesQuery(c.name, c.description, query)
    })

    if (filtered.length === 0) {
      const empty = document.createElement("div")
      empty.className = "commands-modal-empty"
      empty.textContent = query ? `No commands match "${query}".` : "No commands available."
      commandsList!.appendChild(empty)
      return
    }

    for (const entry of filtered) {
      const item = document.createElement("button")
      item.className = "commands-modal-item"
      item.setAttribute("role", "option")
      item.dataset.command = entry.name

      const left = document.createElement("div")
      left.className = "commands-modal-item-main"
      const label = document.createElement("div")
      label.className = "commands-modal-item-label"
      label.textContent = `/${entry.name}`
      const desc = document.createElement("div")
      desc.className = "commands-modal-item-desc"
      desc.textContent = entry.description
      left.appendChild(label)
      left.appendChild(desc)

      const badge = document.createElement("span")
      badge.className = `commands-modal-item-badge commands-modal-item-badge-${entry.source}`
      badge.textContent = entry.source === "local" ? "Built-in" : entry.source === "server" ? "Server" : "Custom"

      item.appendChild(left)
      item.appendChild(badge)

      item.addEventListener("click", () => {
        close()
        options.onRun(entry)
      })
      commandsList!.appendChild(item)
    }
  }

  function renderStashes(query: string): void {
    const filtered = stashEntries.filter(s => {
      if (activeFilter === "global" && !s.isGlobal) return false
      if (activeFilter === "session" && s.isGlobal) return false
      return matchesQuery(s.name, s.content, query)
    })

    if (filtered.length === 0) {
      const empty = document.createElement("div")
      empty.className = "commands-modal-empty"
      empty.textContent = query ? `No stashes match "${query}".` : "No stashed prompts yet. Use /stash <name> <content> to save one."
      commandsList!.appendChild(empty)
      return
    }

    for (const stash of filtered) {
      const item = document.createElement("div")
      item.className = "commands-modal-stash-item"

      const header = document.createElement("div")
      header.className = "commands-modal-stash-header"
      const label = document.createElement("div")
      label.className = "commands-modal-item-label"
      label.textContent = stash.name
      const badge = document.createElement("span")
      badge.className = `commands-modal-item-badge commands-modal-item-badge-${stash.isGlobal ? "local" : "server"}`
      badge.textContent = stash.isGlobal ? "Global" : "Session"
      header.appendChild(label)
      header.appendChild(badge)

      const preview = document.createElement("div")
      preview.className = "commands-modal-stash-preview"
      // Two-line preview (CSS handles clamping). Escape because we use textContent — safe.
      preview.textContent = stash.content

      const actions = document.createElement("div")
      actions.className = "commands-modal-stash-actions"
      const useBtn = document.createElement("button")
      useBtn.className = "commands-modal-stash-btn commands-modal-stash-btn-primary"
      useBtn.textContent = "Use"
      useBtn.addEventListener("click", () => {
        close()
        options.onUseStash(stash)
      })
      const delBtn = document.createElement("button")
      delBtn.className = "commands-modal-stash-btn commands-modal-stash-btn-danger"
      delBtn.textContent = "Delete"
      delBtn.addEventListener("click", (ev) => {
        ev.stopPropagation()
        options.onDeleteStash(stash.id)
      })
      actions.appendChild(useBtn)
      actions.appendChild(delBtn)

      item.appendChild(header)
      item.appendChild(preview)
      item.appendChild(actions)
      commandsList!.appendChild(item)
    }
  }

  // Wire input + close
  commandsSearchInput.addEventListener("input", () => render())
  commandsModalCloseBtn.addEventListener("click", () => close())
  commandsModal.addEventListener("click", (e) => {
    // Click on backdrop closes
    if (e.target === commandsModal) close()
  })
  // Esc closes; Enter runs first visible item
  commandsModal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation()
      close()
    } else if (e.key === "Enter" && document.activeElement === commandsSearchInput) {
      const first = commandsList!.querySelector<HTMLElement>(".commands-modal-item, .commands-modal-stash-item .commands-modal-stash-btn-primary")
      if (first) first.click()
    } else if (e.key === "ArrowDown") {
      const first = commandsList!.querySelector<HTMLElement>(".commands-modal-item, .commands-modal-stash-btn-primary")
      if (first) {
        e.preventDefault()
        first.focus()
      }
    }
  })

  // Reference escapeHtml to keep TS happy if reused later (defense-in-depth helper).
  void escapeHtml

  return { open, openStashList, close, updateServerCommands, updatePromptCommands }
}
