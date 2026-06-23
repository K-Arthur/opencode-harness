/**
 * Commands Modal — central palette for all slash commands (local + server + custom prompts)
 * and for browsing stashed prompts. Triggered by /commands, the `list_commands` flow, or a keybinding.
 *
 * Patterned after skills-modal.ts. Uses postMessage for execution so the host owns auth/state.
 */

import { dedupServerCommands } from "./slash-commands"
import { rankByFuzzy, findMatchRanges, highlightRanges } from "./fuzzyMatch"
import { devStalenessWarn } from "./streamHandlers"

export interface CommandEntry {
  /** Without leading slash. */
  name: string
  description: string
  /**
   * Origin of the command:
   *   - "local"  — handled directly in the webview (slash-commands.ts)
   *   - "server" — built-in opencode server command, proxied via execute_command
   *   - "mcp"    — exposed by a connected MCP server (also proxied)
   *   - "skill"  — derived from a skill definition
   *   - "prompt" — user's custom prompt template
   *   - "template" — saved prompt template
   */
  source: "local" | "server" | "mcp" | "skill" | "prompt" | "template"
  /** When source === "local", a fully formed slash command to insert into the prompt input. */
  insertText?: string
  /** Optional origin label (e.g. MCP server name or agent name) shown next to the badge. */
  origin?: string
  /** Optional direct callback for local commands that don't route through the slash dispatcher. */
  run?: () => void
  /**
   * Longer documentation shown in an expandable detail panel under the row.
   * For skill/server commands this is the full prompt template; for local
   * commands it includes usage hints and aliases. When absent, the row is
   * not expandable.
   */
  detail?: string
}

export interface StashEntry {
  id: string
  name: string
  content: string
  isGlobal: boolean
}

export interface TemplateEntry {
  id: string
  name: string
  content: string
  tags: string[]
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
  /** Use a saved template — inserts content into prompt. */
  onUseTemplate?: (template: TemplateEntry) => void
  /** Delete a template by id. */
  onDeleteTemplate?: (id: string) => void
  /** Mention dropdown to hide when modal opens. */
  mentionDropdown?: HTMLElement | null
}

type Mode = "commands" | "stashes" | "templates"

export interface CommandsModalHandle {
  open(): void
  openStashList(stashes: StashEntry[]): void
  openTemplateList(templates: TemplateEntry[]): void
  close(): void
  updateServerCommands(commands: Array<{ name: string; description?: string; template?: string }>): void
  updatePromptCommands(prompts: Array<{ name: string; description?: string }>): void
  updateTemplateCommands(templates: Array<{ id: string; name: string; content: string; tags: string[] }>): void
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
    return { open() {}, openStashList() {}, openTemplateList() {}, close() {}, updateServerCommands() {}, updatePromptCommands() {}, updateTemplateCommands() {} }
  }

  let serverCommands: CommandEntry[] = []
  let promptCommands: CommandEntry[] = []
  let stashEntries: StashEntry[] = []
  let templateEntries: TemplateEntry[] = []
  let mode: Mode = "commands"
  /** "all" | "local" | "server" | "prompt" | "stash" — filter chip state */
  let activeFilter: string = "all"
  let lastFocused: HTMLElement | null = null
  /** Dev-only diagnostic: tracks the previous server command count to detect unexpected shrinkage. */
  let lastServerCommandCount = 0

  /** Selected index used by keyboard navigation (ArrowDown/Up/Enter). */
  let selectedIdx = 0

  /** Track which command names have their detail panel expanded. */
  const expandedDetails = new Set<string>()

  /** Currently rendered focusable rows (commands or stash primary buttons). */
  function focusableRows(): HTMLElement[] {
    return Array.from(
      commandsList!.querySelectorAll<HTMLElement>(
        ".commands-modal-item, .commands-modal-stash-btn-primary",
      ),
    )
  }

  function highlight(idx: number): void {
    const rows = focusableRows()
    if (rows.length === 0) return
    selectedIdx = ((idx % rows.length) + rows.length) % rows.length
    rows.forEach((r, i) => {
      r.classList.toggle("active", i === selectedIdx)
      r.setAttribute("aria-selected", i === selectedIdx ? "true" : "false")
      // scrollIntoView isn't available in jsdom; guard so behavior tests
      // can exercise the rest of the path without crashing.
      if (i === selectedIdx && typeof r.scrollIntoView === "function") {
        r.scrollIntoView({ block: "nearest" })
      }
    })
  }

  /** Toggle the detail panel for a command row. */
  function toggleDetail(commandName: string): void {
    if (expandedDetails.has(commandName)) {
      expandedDetails.delete(commandName)
    } else {
      expandedDetails.add(commandName)
    }
    // Re-render to reflect the expanded/collapsed state.
    render()
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

  function openTemplateList(templates: TemplateEntry[]): void {
    mode = "templates"
    templateEntries = templates
    activeFilter = "all"
    if (options.mentionDropdown) options.mentionDropdown.classList.add("hidden")
    commandsModal!.classList.remove("hidden")
    if (commandsTitle) commandsTitle.textContent = "Prompt templates"
    commandsSearchInput!.value = ""
    commandsSearchInput!.placeholder = "Search templates..."
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

  function updateServerCommands(
    commands: Array<{ name: string; description?: string; template?: string; agent?: string; source?: string }>,
  ): void {
    // Dev-only diagnostic: a sudden shrink in the server command list can
    // indicate a stale or partial refresh (e.g. MCP server dropped). This
    // does not block the update; it only surfaces regressions during development.
    if (commands.length < lastServerCommandCount && lastServerCommandCount > 0) {
      devStalenessWarn(
        "commands-modal",
        `server command list shrank from ${lastServerCommandCount} to ${commands.length}`,
      )
    }
    lastServerCommandCount = commands.length
    // Drop server commands whose names collide with built-ins so users
    // don't see duplicate rows for /clear, /help, etc.
    serverCommands = dedupServerCommands(commands).map(c => {
      // The server's `source` field disambiguates command / mcp / skill;
      // if absent we default to "server" so older opencode builds still work.
      const rawSource = (c.source || "").toLowerCase()
      const mappedSource: CommandEntry["source"] =
        rawSource === "mcp" ? "mcp" :
        rawSource === "skill" ? "skill" :
        "server"
      const detailParts: string[] = []
      // Always include the description so users can expand and read the full
      // text even when the row's one-line label is truncated.
      if (c.description) detailParts.push(c.description)
      // Append the full template when it is present and adds more context than
      // the description alone (common for skill / MCP commands).
      if (c.template && c.template.length > (c.description?.length ?? 0)) {
        detailParts.push(c.template)
      }
      // Fallback to a generic note for commands that have no metadata at all.
      if (detailParts.length === 0) {
        detailParts.push(mappedSource === "mcp" ? "MCP-provided command" : "Server command")
      }
      return {
        name: c.name,
        description: c.description || c.template || (mappedSource === "mcp" ? "MCP-provided command" : "Server command"),
        source: mappedSource,
        // For MCP commands the agent string is typically the MCP server name —
        // shown as an origin chip next to the badge so users can tell which
        // server contributed which command.
        origin: c.agent || undefined,
        // detail is always populated so every command row has a chevron and an
        // expandable panel for reading more info.
        detail: detailParts.join("\n\n"),
      }
    })
    if (mode === "commands" && !commandsModal!.classList.contains("hidden")) render()
  }

  function updatePromptCommands(prompts: Array<{ name: string; description?: string }>): void {
    promptCommands = prompts.map(p => ({
      name: p.name,
      description: p.description || "Custom prompt",
      source: "prompt" as const,
      detail: p.description || "Custom prompt",
    }))
    if (mode === "commands" && !commandsModal!.classList.contains("hidden")) render()
  }

  function updateTemplateCommands(templates: Array<{ id: string; name: string; content: string; tags: string[] }>): void {
    templateEntries = templates
    if (!commandsModal!.classList.contains("hidden")) render()
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
      : mode === "templates"
      ? [
          { key: "all", label: "All" },
        ]
      : [
          { key: "all", label: "All" },
          { key: "local", label: "Built-in" },
          { key: "server", label: "Server" },
          { key: "mcp", label: "MCP" },
          { key: "skill", label: "Skill" },
          { key: "prompt", label: "Custom" },
          { key: "template", label: "Template" },
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

  function render(): void {
    const query = commandsSearchInput!.value.trim()
    commandsList!.innerHTML = ""

    if (mode === "stashes") {
      renderStashes(query)
    } else if (mode === "templates") {
      renderTemplates(query)
    } else {
      renderCommands(query)
    }
    selectedIdx = 0
    highlight(0)
  }

  function renderCommands(query: string): void {
    const templateCommandEntries: CommandEntry[] = templateEntries.map(t => ({
      name: t.name,
      description: t.tags.length > 0 ? `Template: ${t.tags.join(", ")}` : "Saved template",
      source: "template" as const,
      detail: t.tags.length > 0 ? `Template: ${t.tags.join(", ")}` : "Saved template",
    }))
    const all = [...options.localCommands, ...serverCommands, ...promptCommands, ...templateCommandEntries]
    const inFilter = all.filter(c => activeFilter === "all" || c.source === activeFilter)
    // Fuzzy match on the command name + substring match on its description,
    // ranked best-first. An empty query keeps the source-grouped order.
    const filtered = rankByFuzzy(inFilter, query, c => c.name, c => c.description)

    if (filtered.length === 0) {
      const empty = document.createElement("div")
      empty.className = "commands-modal-empty"
      empty.textContent = query ? `No commands match "${query}".` : "No commands available."
      commandsList!.appendChild(empty)
      return
    }

    for (const entry of filtered) {
      const wrapper = document.createElement("div")
      wrapper.className = "commands-modal-item-wrapper"
      wrapper.dataset.command = entry.name

      const item = document.createElement("button")
      item.className = "commands-modal-item"
      item.setAttribute("role", "option")
      item.dataset.command = entry.name

      const left = document.createElement("div")
      left.className = "commands-modal-item-main"
      const label = document.createElement("div")
      label.className = "commands-modal-item-label"
      const labelText = `/${entry.name}`
      const ranges = query ? findMatchRanges(query, labelText) : null
      if (ranges && ranges.length > 0) {
        label.innerHTML = highlightRanges(labelText, ranges)
      } else {
        label.textContent = labelText
      }
      const desc = document.createElement("div")
      desc.className = "commands-modal-item-desc"
      desc.textContent = entry.description
      left.appendChild(label)
      left.appendChild(desc)

      const badge = document.createElement("span")
      badge.className = `commands-modal-item-badge commands-modal-item-badge-${entry.source}`
      badge.textContent =
        entry.source === "local"  ? "Built-in" :
        entry.source === "server" ? "Server" :
        entry.source === "mcp"    ? "MCP" :
        entry.source === "skill"  ? "Skill" :
        entry.source === "template" ? "Template" :
        "Custom"

      item.appendChild(left)
      if (entry.origin) {
        // Small secondary chip showing which MCP server / agent provided the
        // command. Helps users tell e.g. github-mcp's /review apart from
        // linear-mcp's /review.
        const originChip = document.createElement("span")
        originChip.className = "commands-modal-item-origin"
        originChip.textContent = entry.origin
        originChip.title = `Provided by ${entry.origin}`
        item.appendChild(originChip)
      }
      item.appendChild(badge)

      // Chevron toggle for expandable detail panel. Only shown when the
      // entry has a `detail` field (skill template, local usage/aliases).
      if (entry.detail) {
        const chevron = document.createElement("button")
        chevron.className = "commands-modal-item-chevron"
        chevron.setAttribute("aria-label", "Toggle documentation")
        chevron.setAttribute("aria-expanded", String(expandedDetails.has(entry.name)))
        chevron.innerHTML = expandedDetails.has(entry.name) ? "\u25BC" : "\u25B8"
        chevron.addEventListener("click", (ev) => {
          ev.stopPropagation()
          toggleDetail(entry.name)
        })
        item.appendChild(chevron)
      }

      item.addEventListener("click", () => {
        close()
        options.onRun(entry)
      })
      wrapper.appendChild(item)

      // Expandable detail panel — shown when the user toggles the chevron.
      // The panel is a separate sibling of the button row so it doesn't
      // interfere with the click-to-run action.
      if (entry.detail) {
        const detailPanel = document.createElement("div")
        detailPanel.className = "commands-modal-item-detail"
        detailPanel.dataset.command = entry.name
        if (!expandedDetails.has(entry.name)) {
          detailPanel.classList.add("hidden")
        }
        const pre = document.createElement("pre")
        pre.className = "commands-modal-item-detail-content"
        pre.textContent = entry.detail
        detailPanel.appendChild(pre)
        wrapper.appendChild(detailPanel)
      }

      commandsList!.appendChild(wrapper)
    }
  }

  function renderStashes(query: string): void {
    const inFilter = stashEntries.filter(s => {
      if (activeFilter === "global" && !s.isGlobal) return false
      if (activeFilter === "session" && s.isGlobal) return false
      return true
    })
    // Same fuzzy ranking as commands: match the stash name, fall back to its
    // content (substring), best-first.
    const filtered = rankByFuzzy(inFilter, query, s => s.name, s => s.content)

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

  function renderTemplates(query: string): void {
    const inFilter = templateEntries.filter(() => activeFilter === "all")
    const filtered = rankByFuzzy(inFilter, query, s => s.name, s => s.content)

    if (filtered.length === 0) {
      const empty = document.createElement("div")
      empty.className = "commands-modal-empty"
      empty.textContent = query ? `No templates match "${query}".` : "No saved templates yet. Right-click a message and select \"Save as template\" to create one."
      commandsList!.appendChild(empty)
      return
    }

    for (const tpl of filtered) {
      const item = document.createElement("div")
      item.className = "commands-modal-stash-item"

      const header = document.createElement("div")
      header.className = "commands-modal-stash-header"
      const label = document.createElement("div")
      label.className = "commands-modal-item-label"
      label.textContent = tpl.name
      const badge = document.createElement("span")
      badge.className = "commands-modal-item-badge commands-modal-item-badge-local"
      badge.textContent = tpl.tags.length > 0 ? tpl.tags.join(", ") : "Template"
      header.appendChild(label)
      header.appendChild(badge)

      const preview = document.createElement("div")
      preview.className = "commands-modal-stash-preview"
      preview.textContent = tpl.content

      const actions = document.createElement("div")
      actions.className = "commands-modal-stash-actions"
      const useBtn = document.createElement("button")
      useBtn.className = "commands-modal-stash-btn commands-modal-stash-btn-primary"
      useBtn.textContent = "Use"
      useBtn.addEventListener("click", () => {
        close()
        options.onUseTemplate?.(tpl)
      })
      const delBtn = document.createElement("button")
      delBtn.className = "commands-modal-stash-btn commands-modal-stash-btn-danger"
      delBtn.textContent = "Delete"
      delBtn.addEventListener("click", (ev) => {
        ev.stopPropagation()
        options.onDeleteTemplate?.(tpl.id)
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
  // Full keyboard nav: ↑/↓ cycle through rows, Enter activates the highlighted
  // row, Esc closes. The previous handler only moved focus to the first item
  // once (no cycling, no ArrowUp), so users couldn't reach later commands
  // via keyboard at all.
  commandsModal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation()
      close()
      return
    }
    if (e.key === "ArrowDown") {
      e.preventDefault()
      highlight(selectedIdx + 1)
      return
    }
    if (e.key === "ArrowUp") {
      e.preventDefault()
      highlight(selectedIdx - 1)
      return
    }
    if (e.key === "Home") {
      e.preventDefault()
      highlight(0)
      return
    }
    if (e.key === "End") {
      e.preventDefault()
      highlight(focusableRows().length - 1)
      return
    }
    if (e.key === "Enter") {
      const rows = focusableRows()
      const target = rows[selectedIdx]
      if (target) {
        e.preventDefault()
        target.click()
      }
    }
    if (e.key === "ArrowRight") {
      // Expand the selected row's detail panel if it has one.
      const rows = focusableRows()
      const target = rows[selectedIdx]
      if (target) {
        const name = target.dataset.command
        if (name && !expandedDetails.has(name)) {
          e.preventDefault()
          toggleDetail(name)
        }
      }
    }
    if (e.key === "ArrowLeft") {
      // Collapse the selected row's detail panel if it's expanded.
      const rows = focusableRows()
      const target = rows[selectedIdx]
      if (target) {
        const name = target.dataset.command
        if (name && expandedDetails.has(name)) {
          e.preventDefault()
          toggleDetail(name)
        }
      }
    }
  })

  return { open, openStashList, openTemplateList, close, updateServerCommands, updatePromptCommands, updateTemplateCommands }
}
