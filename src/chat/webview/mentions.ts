import type { MentionItem } from "./types"
import type { ElementRefs } from "./dom"

const LOCAL_COMMANDS: MentionItem[] = [
  { prefix: "/", display: "clear", description: "Clear conversation", icon: "\uD83E\uDDF9" },
  { prefix: "/", display: "model", description: "Switch model", icon: "\uD83E\uDDE0" },
  { prefix: "/", display: "cost", description: "Show session cost", icon: "\uD83D\uDCB0" },
  { prefix: "/", display: "new", description: "New session", icon: "\u2795" },
  { prefix: "/", display: "export", description: "Export conversation", icon: "\uD83D\uDCE4" },
  { prefix: "/", display: "compact", description: "Compact session context", icon: "\uD83D\uDD04" },
  { prefix: "/", display: "continue", description: "Resend last prompt", icon: "\u23ED" },
  { prefix: "/", display: "commands", description: "List server commands", icon: "\uD83D\uDCCB" },
  { prefix: "/", display: "help", description: "Show help", icon: "\u2753" },
]

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

    const slashMatch = textBefore.match(/^\/(\w*)$/)
    if (slashMatch) {
      state.mode = "command"
      state.query = slashMatch[1]!
      els.mentionDropdown.classList.remove("hidden")
      const allCommands = [...LOCAL_COMMANDS, ...serverCommands]
      const filtered = allCommands.filter(c =>
        c.display!.toLowerCase().startsWith(state.query.toLowerCase())
      )
      renderCommandResults(filtered)
      return
    }

    const atMatch = textBefore.match(/@(\S*)$/)
    if (atMatch) {
      state.mode = "mention"
      state.query = atMatch[1]!
      els.mentionDropdown.classList.remove("hidden")
      postMessage({ type: "mention_search", query: state.query })
    } else {
      els.mentionDropdown.classList.add("hidden")
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
      div.className = "dropdown-item" + (i === 0 ? " selected" : "")
      const icon = document.createElement("span")
      icon.className = "dropdown-icon"
      icon.textContent = item.icon || "\u2699"
      div.appendChild(icon)
      const label = document.createElement("span")
      label.className = "dropdown-label"
      label.textContent = `/${item.display || ""}`
      div.appendChild(label)
      if (item.description) {
        const desc = document.createElement("span")
        desc.className = "dropdown-desc"
        desc.textContent = "\u2014 " + item.description
        div.appendChild(desc)
      }
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
      icon: "\u2699",
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
      items.forEach((i) => i.classList.remove("selected"))
      state.selectedIndex = (state.selectedIndex + 1) % items.length
      const selected = items[state.selectedIndex]
      if (selected) selected.classList.add("selected")
      if (selected) ensureVisible(selected, els.mentionDropdown)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      items.forEach((i) => i.classList.remove("selected"))
      state.selectedIndex = state.selectedIndex <= 0 ? items.length - 1 : state.selectedIndex - 1
      const selectedUp = items[state.selectedIndex]
      if (selectedUp) selectedUp.classList.add("selected")
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
      const icon = document.createElement("span")
      icon.className = "dropdown-icon"
      icon.textContent = item.icon || "\uD83D\uDCC4"
      div.appendChild(icon)
      const label = document.createElement("span")
      label.className = "dropdown-label"
      label.textContent = item.display || ""
      div.appendChild(label)
      if (item.description) {
        const desc = document.createElement("span")
        desc.className = "dropdown-desc"
        desc.textContent = "\u2014 " + item.description
        div.appendChild(desc)
      }
      div.addEventListener("click", () => insertMention(item))
      els.mentionDropdown.appendChild(div)
    })
  }

  function insertMention(item: MentionItem) {
    const val = els.promptInput.value
    const cursor = els.promptInput.selectionStart
    const atIdx = val.lastIndexOf("@", cursor)
    const text = (item.prefix || "") + (item.display || "")
    const before = val.slice(0, atIdx)
    const after = val.slice(cursor)
    els.promptInput.value = before + text + " " + after
    const newCursor = atIdx + text.length + 1
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
