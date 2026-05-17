import { timers } from "../timerRegistry"

let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
let searchCurrentIndex = -1
let searchTotalMatches = 0

export function setupSearch(getActivePanelRoot: () => Element | null): void {
  const searchBar = document.getElementById("chat-search-bar") as HTMLDivElement
  const searchInput = document.getElementById("chat-search-input") as HTMLInputElement
  const searchPrev = document.getElementById("chat-search-prev")
  const searchNext = document.getElementById("chat-search-next")
  const searchClose = document.getElementById("chat-search-close")
  const searchCount = document.getElementById("chat-search-count") as HTMLSpanElement

  if (!searchBar || !searchInput || !searchPrev || !searchNext || !searchClose || !searchCount) return

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "f") {
      e.preventDefault()
      searchBar.classList.remove("hidden")
      searchInput.focus()
      searchInput.select()
      return
    }

    if (searchBar.classList.contains("hidden")) return

    if (e.key === "Escape") {
      closeSearch(searchBar)
      return
    }

    if (e.key === "Enter" && document.activeElement === searchInput) {
      e.preventDefault()
      navigateSearch(e.shiftKey ? -1 : 1, searchCount)
      return
    }
  })

  searchInput.addEventListener("input", () => {
    if (searchDebounceTimer) timers.clearTimeout(searchDebounceTimer)
    searchDebounceTimer = timers.setTimeout(() => performSearch(searchInput.value, searchCount, getActivePanelRoot), 200)
  })

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation()
      closeSearch(searchBar)
    }
  })

  searchPrev.addEventListener("click", () => navigateSearch(-1, searchCount))
  searchNext.addEventListener("click", () => navigateSearch(1, searchCount))
  searchClose.addEventListener("click", () => closeSearch(searchBar))
}

function closeSearch(searchBar: HTMLDivElement) {
  searchBar.classList.add("hidden")
  clearSearchHighlights()
  searchCurrentIndex = -1
  searchTotalMatches = 0
}

function updateSearchCount(current: number, total: number, el?: HTMLSpanElement) {
  const span = el || document.getElementById("chat-search-count") as HTMLSpanElement
  if (span) {
    span.textContent = total > 0 ? `${current + 1} of ${total}` : ""
  }
}

function clearSearchHighlights() {
  document.querySelectorAll(".chat-search-highlight").forEach((mark) => {
    const parent = mark.parentNode
    if (parent) {
      parent.replaceChild(document.createTextNode(mark.textContent || ""), mark)
      parent.normalize()
    }
  })
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function highlightTextNodes(root: Element, regex: RegExp): number {
  let count = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const el = node.parentElement
      if (el && (el.tagName === "MARK" || el.tagName === "SCRIPT" || el.tagName === "STYLE")) {
        return NodeFilter.FILTER_REJECT
      }
      return regex.test(node.textContent || "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })

  const replacements: Array<{ node: Text; frag: DocumentFragment }> = []
  let textNode: Text | null
  while ((textNode = walker.nextNode() as Text | null)) {
    let text = textNode.textContent || ""
    regex.lastIndex = 0
    const frag = document.createDocumentFragment()
    let lastIdx = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIdx) {
        frag.appendChild(document.createTextNode(text.slice(lastIdx, match.index)))
      }
      const mark = document.createElement("mark")
      mark.className = "chat-search-highlight"
      mark.textContent = match[0]
      frag.appendChild(mark)
      count++
      lastIdx = regex.lastIndex
      if (match[0].length === 0) break
    }
    if (lastIdx < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIdx)))
    }
    if (frag.childNodes.length > 0) {
      replacements.push({ node: textNode, frag })
    }
  }

  replacements.forEach(({ node, frag }) => {
    node.parentNode?.replaceChild(frag, node)
  })
  return count
}

function performSearch(query: string, countEl?: HTMLSpanElement, getActivePanelRoot?: () => Element | null) {
  clearSearchHighlights()
  searchCurrentIndex = -1
  searchTotalMatches = 0

  if (!query.trim()) {
    updateSearchCount(0, 0, countEl)
    return
  }

  const activePanel = getActivePanelRoot?.() ?? document.querySelector(".tab-panel.active")
  if (!activePanel) {
    updateSearchCount(0, 0, countEl)
    return
  }

  const elements = activePanel.querySelectorAll(".message-bubble, .code-block-content, .msg-text")
  const regex = new RegExp(escapeRegExp(query), "gi")
  let total = 0
  elements.forEach((el) => {
    total += highlightTextNodes(el, regex)
  })

  searchTotalMatches = total
  if (total > 0) {
    navigateToMatch(0, countEl)
  } else {
    updateSearchCount(0, 0, countEl)
  }
}

function navigateSearch(direction: number, countEl?: HTMLSpanElement) {
  if (searchTotalMatches === 0) return
  const marks = document.querySelectorAll(".chat-search-highlight")
  if (marks.length === 0) return

  marks.forEach((m) => m.classList.remove("current"))

  if (searchCurrentIndex < 0) {
    searchCurrentIndex = direction > 0 ? 0 : marks.length - 1
  } else {
    searchCurrentIndex = (searchCurrentIndex + direction + marks.length) % marks.length
  }

  const currentMark = marks[searchCurrentIndex] as HTMLElement
  if (currentMark) {
    currentMark.classList.add("current")
    currentMark.scrollIntoView({ behavior: "smooth", block: "center" })
  }
  updateSearchCount(searchCurrentIndex, searchTotalMatches, countEl)
}

function navigateToMatch(index: number, countEl?: HTMLSpanElement) {
  const marks = document.querySelectorAll(".chat-search-highlight")
  if (marks.length === 0 || index >= marks.length) return

  marks.forEach((m) => m.classList.remove("current"))
  searchCurrentIndex = index
  const mark = marks[index] as HTMLElement
  if (mark) {
    mark.classList.add("current")
    mark.scrollIntoView({ behavior: "smooth", block: "center" })
  }
  updateSearchCount(index, searchTotalMatches, countEl)
}
