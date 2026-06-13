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
// surfaces can never drift out of sync again.
const LOCAL_COMMANDS: MentionItem[] = toMentionItems(SLASH_COMMAND_ICONS)

export interface MentionState {
  query: string
  selectedIndex: number
  mode: "mention" | "command"
}

export function setupMentions(els: ElementRefs, state: MentionState, postMessage: (msg: Record<string, unknown>) => void) {
  let serverCommands: MentionItem[] = []

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
      els.mentionDropdown.classList.remove("hidden")
      els.promptInput.setAttribute("aria-expanded", "true")
      const uniqueServer = dedupServerCommands(serverCommands, (c) => c.display)
      const allCommands = [...LOCAL_COMMANDS, ...uniqueServer]
      // Fuzzy subsequence match (not startsWith): typing "/review" must
      // surface a custom "/code-review" command, and "/cr" should too. The
      // old startsWith filter hid every command whose name didn't begin with
      // the typed characters, which made custom/MCP commands look missing.
      const filtered = rankByFuzzy(
        allCommands,
        state.query,
        (c) => c.display ?? "",
        (c) => c.description ?? "",
      )
      renderCommandResults(filtered)
      return
    }

    const atMatch = textBefore.match(/@(\S*)$/)
    if (atMatch) {
      state.mode = "mention"
      state.query = atMatch[1]!
      els.mentionDropdown.classList.add("mention-mode")
      els.mentionDropdown.classList.remove("command-mode")
      els.mentionDropdown.classList.remove("hidden")
      els.promptInput.setAttribute("aria-expanded", "true")
      postMessage({ type: "mention_search", query: state.query })
    } else {
      els.mentionDropdown.classList.remove("command-mode", "mention-mode")
      els.mentionDropdown.classList.add("hidden")
      els.promptInput.setAttribute("aria-expanded", "false")
      els.promptInput.removeAttribute("aria-activedescendant")
    }
  }

  function renderCommandResults(commands: MentionItem[]) {
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
      div.addEventListener("click", () => insertCommand(item))
      els.mentionDropdown.appendChild(div)
    })
  }

  function insertCommand(item: MentionItem) {
    const val = els.promptInput.value
    const slashIdx = val.lastIndexOf("/", els.promptInput.selectionStart)
    const cmd = `/${item.display || ""}`
    els.promptInput.value = val.slice(0, slashIdx) + cmd + val.slice(els.promptInput.selectionStart)
    const newCursor = slashIdx + cmd.length
    els.promptInput.setSelectionRange(newCursor, newCursor)
    els.mentionDropdown.classList.add("hidden")
    els.promptInput.focus()
    window.dispatchEvent(new CustomEvent("oc-input-changed"))
  }

  function updateServerCommands(commands: Array<{ name: string; description?: string }>) {
    serverCommands = commands.map(c => ({
      prefix: "/",
      display: c.name,
      description: c.description || "Server command",
      icon: GEAR_SVG,
    }))
  }

  function handleKeydown(e: KeyboardEvent) {
    const items = els.mentionDropdown.querySelectorAll<HTMLElement>(".dropdown-item:not(.dropdown-empty)")
    if (items.length === 0) {
      if (e.key === "Escape") {
        els.mentionDropdown.classList.add("hidden")
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
      }
      if (selectedUp) ensureVisible(selectedUp, els.mentionDropdown)
    } else if (e.key === "Enter" && state.selectedIndex >= 0) {
      e.preventDefault()
      const selectedEnter = items[state.selectedIndex]
      if (selectedEnter) selectedEnter.click()
    } else if (e.key === "Escape") {
      els.mentionDropdown.classList.add("hidden")
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
    els.mentionDropdown.classList.add("hidden")
    els.promptInput.focus()
    window.dispatchEvent(new CustomEvent("oc-input-changed"))
  }

  els.mentionDropdown.addEventListener("mouseleave", () => {
    state.selectedIndex = -1
  })

  return { handleTrigger, handleKeydown, renderResults, updateServerCommands }
}
