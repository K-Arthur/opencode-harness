import type { MentionItem } from "./types"
import type { ElementRefs } from "./dom"
import {
  GEAR_SVG,
  COMMAND_SVG,
  BRAIN_SVG,
  MCP_SVG,
  PLUS_SVG,
  SHARE_SVG,
  REFRESH_SVG,
  PLAY_SVG,
  HISTORY_SVG,
  CODE_SVG,
  BUG_SVG,
} from "./icons"
import { toMentionItems, dedupServerCommands } from "./slash-commands"
import { rankByFuzzy } from "./fuzzyMatch"

// Icons live here (webview-only) rather than in the registry: the registry is
// also bundled into the extension host for /help generation, and the SVG
// strings must not ship in dist/extension.js.
const SLASH_COMMAND_ICONS: Readonly<Record<string, string>> = {
  clear: COMMAND_SVG,
  model: BRAIN_SVG,
  cost: MCP_SVG,
  new: PLUS_SVG,
  continue: PLAY_SVG,
  compact: REFRESH_SVG,
  stash: SHARE_SVG,
  stashes: SHARE_SVG,
  queue: MCP_SVG,
  commands: HISTORY_SVG,
  methodology: BRAIN_SVG,
  export: SHARE_SVG,
  "export-json": SHARE_SVG,
  "export-text": SHARE_SVG,
  copy: SHARE_SVG,
  "diagnose:generation": BUG_SVG,
  help: CODE_SVG,
}

// Local slash commands come from the canonical registry in slash-commands.ts
// — single source of truth shared with the commands palette modal so the two
// surfaces can never drift out of sync again. They are all built-ins, so they
// carry the "Built-in" badge.
const LOCAL_COMMANDS: MentionItem[] = toMentionItems(SLASH_COMMAND_ICONS).map((c) => ({
  ...c,
  badge: "Built-in",
}))

// Cap the rendered suggestions so a short query against a large server/MCP
// command set can't produce a runaway dropdown. Results are fuzzy-ranked
// best-first, so the cap keeps the most relevant rows; the rest are summarised
// by a non-interactive "+N more" hint.
const MAX_COMMAND_RESULTS = 50

export interface MentionState {
  query: string
  selectedIndex: number
  mode: "mention" | "command"
}

export function setupMentions(els: ElementRefs, state: MentionState, postMessage: (msg: Record<string, unknown>) => void) {
  let serverCommands: MentionItem[] = []
  let _resizeHandler: (() => void) | null = null

  function positionDropdown() {
    const input = els.promptInput
    const dropdown = els.mentionDropdown
    if (!input || !dropdown) return
    const margin = 8
    const r = input.getBoundingClientRect()
    const dropdownW = Math.min(520, Math.max(240, window.innerWidth - margin * 2))
    const estimatedHeight = Math.min(320, dropdown.getBoundingClientRect().height || 320)
    const spaceAbove = r.top - margin
    const maxHeight = Math.max(200, Math.floor(spaceAbove - 4))
    const leftEdge = Math.max(margin, Math.min(r.left, window.innerWidth - dropdownW - margin))
    const top = Math.max(margin, r.top - Math.min(estimatedHeight, maxHeight) - 6)

    dropdown.style.position = "fixed"
    dropdown.style.top = `${top}px`
    dropdown.style.left = `${leftEdge}px`
    dropdown.style.right = "auto"
    dropdown.style.width = `${dropdownW}px`
    dropdown.style.maxHeight = `${maxHeight}px`
  }

  function showDropdown() {
    els.mentionDropdown.classList.remove("hidden")
    els.promptInput.setAttribute("aria-expanded", "true")
    positionDropdown()
    if (!_resizeHandler) {
      _resizeHandler = () => positionDropdown()
      window.addEventListener("resize", _resizeHandler)
    }
  }

  function hideDropdown() {
    els.mentionDropdown.classList.remove("command-mode", "mention-mode")
    els.mentionDropdown.classList.add("hidden")
    els.promptInput.setAttribute("aria-expanded", "false")
    els.promptInput.removeAttribute("aria-activedescendant")
    if (_resizeHandler) {
      window.removeEventListener("resize", _resizeHandler)
      _resizeHandler = null
    }
  }

  function handleTrigger() {
    const val = els.promptInput.value
    const cursorPos = els.promptInput.selectionStart
    const textBefore = val.slice(0, cursorPos)

    // Trigger when the current token starts with "/". The old anchor (`^`)
    // only fired when the slash sat at position 0, so typing "hello /clear"
    // mid-prompt never opened the dropdown. We now accept a slash that is
    // either at the start of input or preceded by whitespace. The token
    // charset includes "-" and ":" so /export-json and /diagnose:generation
    // keep the dropdown open while being typed.
    const slashMatch = textBefore.match(/(?:^|\s)\/([\w:-]*)$/)
    if (slashMatch) {
      state.mode = "command"
      state.query = slashMatch[1]!
      els.mentionDropdown.classList.add("command-mode")
      els.mentionDropdown.classList.remove("mention-mode")
      showDropdown()
      const uniqueServer = dedupServerCommands(serverCommands, (c) => c.display)
      const allCommands = [...LOCAL_COMMANDS, ...uniqueServer]
      // Fuzzy subsequence match (not startsWith): typing "/review" must
      // surface a custom "/code-review" command, and "/cr" should too. The
      // old startsWith filter hid every command whose name didn't begin with
      // the typed characters, which made custom/MCP commands look missing.
      const ranked = rankByFuzzy(
        allCommands,
        state.query,
        (c) => c.display ?? "",
        (c) => c.description ?? "",
      )
      renderCommandResults(ranked.slice(0, MAX_COMMAND_RESULTS), ranked.length)
      return
    }

    const atMatch = textBefore.match(/@(\S*)$/)
    if (atMatch) {
      state.mode = "mention"
      state.query = atMatch[1]!
      els.mentionDropdown.classList.add("mention-mode")
      els.mentionDropdown.classList.remove("command-mode")
      showDropdown()
      postMessage({ type: "mention_search", query: state.query })
    } else {
      hideDropdown()
    }
  }

  function renderCommandResults(commands: MentionItem[], totalMatches?: number) {
    els.mentionDropdown.innerHTML = ""
    if (commands.length === 0) {
      const empty = document.createElement("div")
      empty.className = "dropdown-empty"
      empty.textContent = "No matching commands"
      els.mentionDropdown.appendChild(empty)
      state.selectedIndex = -1
      return
    }
    state.selectedIndex = 0
    commands.forEach((item, i) => {
      const div = document.createElement("div")
      div.className = "dropdown-item command-item" + (i === 0 ? " selected" : "")
      div.id = `mention-cmd-opt-${i}` // C3: stable id for aria-activedescendant
      div.setAttribute("role", "option")
      div.setAttribute("aria-selected", String(i === 0))
      div.tabIndex = -1
      div.dataset.command = item.display || ""
      const icon = document.createElement("span")
      icon.className = "dropdown-icon"
      // Use innerHTML for SVG icon strings, textContent for emoji fallbacks
      const iconStr = item.icon || ""
      if (iconStr.includes("<svg")) {
        icon.innerHTML = iconStr
      } else {
        icon.textContent = iconStr || "\u2699"
      }
      div.appendChild(icon)
      const content = document.createElement("span")
      content.className = "dropdown-content"
      const label = document.createElement("span")
      label.className = "dropdown-label"
      label.textContent = `/${item.display || ""}`
      content.appendChild(label)
      if (item.description) {
        const desc = document.createElement("span")
        desc.className = "dropdown-desc"
        desc.textContent = item.description
        content.appendChild(desc)
      }
      div.appendChild(content)
      if (item.badge) {
        // Origin chip (Built-in / Server / MCP / Skill / Custom) so users can
        // tell a built-in command apart from a server/MCP/skill/custom one
        // without opening the palette. data-source drives the accent colour.
        const badge = document.createElement("span")
        badge.className = "command-badge"
        badge.dataset.source = item.badge.toLowerCase()
        badge.textContent = item.badge
        div.appendChild(badge)
      }
      div.addEventListener("click", () => insertCommand(item))
      els.mentionDropdown.appendChild(div)
    })
    // Non-interactive overflow hint. Kept off the `.dropdown-item` class so
    // handleKeydown's selection query never lands on it.
    if (typeof totalMatches === "number" && totalMatches > commands.length) {
      const more = document.createElement("div")
      more.className = "dropdown-more"
      more.textContent = `+${totalMatches - commands.length} more \u2014 keep typing to narrow`
      els.mentionDropdown.appendChild(more)
    }
  }

  function insertCommand(item: MentionItem) {
    const val = els.promptInput.value
    const slashIdx = val.lastIndexOf("/", els.promptInput.selectionStart)
    const cmd = `/${item.display || ""}`
    els.promptInput.value = val.slice(0, slashIdx) + cmd + val.slice(els.promptInput.selectionStart)
    const newCursor = slashIdx + cmd.length
    els.promptInput.setSelectionRange(newCursor, newCursor)
    hideDropdown()
    els.promptInput.focus()
    window.dispatchEvent(new CustomEvent("oc-input-changed"))
  }

  function updateServerCommands(
    commands: Array<{ name: string; description?: string; source?: string; isCustom?: boolean }>,
  ) {
    serverCommands = commands.map(c => {
      // Mirror the commands-palette badge taxonomy: custom prompts → "Custom",
      // and the server's `source` disambiguates MCP / skill / plain server.
      const source = (c.source || "").toLowerCase()
      const badge =
        c.isCustom        ? "Custom" :
        source === "mcp"   ? "MCP"   :
        source === "skill" ? "Skill" :
        "Server"
      const icon =
        badge === "MCP"    ? MCP_SVG :
        badge === "Skill"  ? BRAIN_SVG :
        badge === "Custom" ? COMMAND_SVG :
        GEAR_SVG
      return {
        prefix: "/",
        display: c.name,
        description: c.description || `${badge} command`,
        icon,
        badge,
      }
    })
  }

  function handleKeydown(e: KeyboardEvent) {
    const items = els.mentionDropdown.querySelectorAll<HTMLElement>(".dropdown-item:not(.dropdown-empty)")
    if (items.length === 0) {
      if (e.key === "Escape") {
        hideDropdown()
      }
      return
    }
    if (e.key === "ArrowDown") {
      e.preventDefault()
      items.forEach((i) => {
        i.classList.remove("selected")
        i.setAttribute("aria-selected", "false")
      })
      state.selectedIndex = (state.selectedIndex + 1) % items.length
      const selected = items[state.selectedIndex]
      if (selected) {
        selected.classList.add("selected")
        selected.setAttribute("aria-selected", "true")
        // C3: announce the highlighted option to screen readers. The
        // textarea retains DOM focus; aria-activedescendant tells the SR
        // which option is currently highlighted.
        els.promptInput.setAttribute("aria-activedescendant", selected.id)
      }
      if (selected) ensureVisible(selected, els.mentionDropdown)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      items.forEach((i) => {
        i.classList.remove("selected")
        i.setAttribute("aria-selected", "false")
      })
      state.selectedIndex = state.selectedIndex <= 0 ? items.length - 1 : state.selectedIndex - 1
      const selectedUp = items[state.selectedIndex]
      if (selectedUp) {
        selectedUp.classList.add("selected")
        selectedUp.setAttribute("aria-selected", "true")
        els.promptInput.setAttribute("aria-activedescendant", selectedUp.id)
      }
      if (selectedUp) ensureVisible(selectedUp, els.mentionDropdown)
    } else if (e.key === "Enter" && state.selectedIndex >= 0) {
      e.preventDefault()
      const selectedEnter = items[state.selectedIndex]
      if (selectedEnter) selectedEnter.click()
    } else if (e.key === "Escape") {
      hideDropdown()
    }
  }

  function ensureVisible(el: HTMLElement, parent: HTMLDivElement) {
    const elTop = el.offsetTop
    const elBottom = elTop + el.offsetHeight
    const scrollTop = parent.scrollTop
    const scrollBottom = scrollTop + parent.clientHeight
    if (elTop < scrollTop) parent.scrollTop = elTop - 4
    if (elBottom > scrollBottom) parent.scrollTop = elBottom - parent.clientHeight + 4
  }

  function renderResults(items?: MentionItem[]) {
    els.mentionDropdown.innerHTML = ""
    if (!items || items.length === 0) {
      const empty = document.createElement("div")
      empty.className = "dropdown-empty"
      empty.textContent = "No matches"
      els.mentionDropdown.appendChild(empty)
      state.selectedIndex = -1
      return
    }
    state.selectedIndex = 0
    items.forEach((item, i) => {
      const div = document.createElement("div")
      div.className = "dropdown-item" + (i === 0 ? " selected" : "")
      div.id = `mention-opt-${i}` // C3: stable id for aria-activedescendant
      div.setAttribute("role", "option")
      div.setAttribute("aria-selected", String(i === 0))
      div.tabIndex = -1
      const icon = document.createElement("span")
      icon.className = "dropdown-icon"
      const iconStr = item.icon || ""
      if (iconStr.includes("<svg")) {
        icon.innerHTML = iconStr
      } else {
        icon.textContent = iconStr || "\uD83D\uDCC4"
      }
      div.appendChild(icon)
      const content = document.createElement("span")
      content.className = "dropdown-content"
      const label = document.createElement("span")
      label.className = "dropdown-label"
      label.textContent = item.display || ""
      content.appendChild(label)
      if (item.description) {
        const desc = document.createElement("span")
        desc.className = "dropdown-desc"
        desc.textContent = item.description
        content.appendChild(desc)
      }
      div.appendChild(content)
      div.addEventListener("click", () => insertMention(item))
      els.mentionDropdown.appendChild(div)
    })
  }

  function insertMention(item: MentionItem) {
    const val = els.promptInput.value
    const cursor = els.promptInput.selectionStart
    const atIdx = val.lastIndexOf("@", cursor)
    // Prefer item.insertText when present — category items (e.g. {prefix:"@file:",
    // display:"file"}) used to concatenate prefix + display and insert
    // "@file:file" instead of the intended "@file:". The host-side
    // MessageRouter now supplies insertText: "@file:" (etc.) for category
    // rows so they insert the bare prefix and let the user keep typing.
    let text: string
    let trailing = " "
    if (item.insertText) {
      text = item.insertText
      // Category prefixes end with ":" — leave the cursor right after so the
      // user can type the file/url/etc. without an intervening space.
      if (text.endsWith(":")) trailing = ""
    } else {
      text = (item.prefix || "") + (item.display || "")
    }
    const before = val.slice(0, atIdx)
    const after = val.slice(cursor)
    els.promptInput.value = before + text + trailing + after
    const newCursor = atIdx + text.length + trailing.length
    els.promptInput.setSelectionRange(newCursor, newCursor)
    hideDropdown()
    els.promptInput.focus()
    window.dispatchEvent(new CustomEvent("oc-input-changed"))
  }

  els.mentionDropdown.addEventListener("mouseleave", () => {
    state.selectedIndex = -1
  })

  return { handleTrigger, handleKeydown, renderResults, updateServerCommands }
}
