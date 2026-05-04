import type { MentionItem } from "./types"
import type { ElementRefs } from "./dom"

export interface MentionState {
  query: string
  selectedIndex: number
}

export function setupMentions(els: ElementRefs, state: MentionState, postMessage: (msg: Record<string, unknown>) => void) {
  function handleTrigger() {
    const val = els.promptInput.value
    const cursorPos = els.promptInput.selectionStart
    const textBefore = val.slice(0, cursorPos)
    const match = textBefore.match(/@(\S*)$/)
    if (match) {
      state.query = match[1]
      els.mentionDropdown.classList.remove("hidden")
      postMessage({ type: "mention_search", query: state.query })
    } else {
      els.mentionDropdown.classList.add("hidden")
    }
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
      items[state.selectedIndex].classList.add("selected")
      ensureVisible(items[state.selectedIndex], els.mentionDropdown)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      items.forEach((i) => i.classList.remove("selected"))
      state.selectedIndex = state.selectedIndex <= 0 ? items.length - 1 : state.selectedIndex - 1
      items[state.selectedIndex].classList.add("selected")
      ensureVisible(items[state.selectedIndex], els.mentionDropdown)
    } else if (e.key === "Enter" && state.selectedIndex >= 0) {
      e.preventDefault()
      items[state.selectedIndex].click()
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
    // Notify caller to resize and update button
    window.dispatchEvent(new CustomEvent("oc-input-changed"))
  }

  els.mentionDropdown.addEventListener("mouseleave", () => {
    state.selectedIndex = -1
  })

  return { handleTrigger, handleKeydown, renderResults }
}
