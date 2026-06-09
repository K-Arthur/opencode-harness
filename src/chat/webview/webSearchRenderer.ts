/**
 * Renders web search / web fetch tool results as rich result cards instead of
 * raw text. Handles structured JSON arrays (common in OpenCode search tools)
 * and gracefully falls back to linkified plain text for unrecognized formats.
 */

import type { ToolCallBlock } from "./types"

export interface WebSearchResult {
  title?: string
  url?: string
  snippet?: string
  description?: string
  content?: string
}

const WEB_TOOL_NAMES = new Set([
  "websearch", "web_search", "search_web",
  "webfetch", "web_fetch", "fetch", "browse",
  "tavily_search", "serper_search", "brave_search",
])

export function isWebSearchTool(toolBlock: ToolCallBlock): boolean {
  const name = (toolBlock.name ?? "").toLowerCase().replace(/[^a-z_]/g, "_")
  return WEB_TOOL_NAMES.has(name) || name.includes("search") || name.includes("fetch")
}

function tryParseResults(raw: string): WebSearchResult[] | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      const results = parsed.filter((item): item is WebSearchResult =>
        typeof item === "object" && item !== null &&
        (typeof (item as Record<string, unknown>).url === "string" || typeof (item as Record<string, unknown>).title === "string")
      )
      return results.length > 0 ? results : null
    }
    // Some tools return { results: [...] } or { organic: [...] }
    if (typeof parsed === "object" && parsed !== null) {
      const obj = parsed as Record<string, unknown>
      for (const key of ["results", "organic", "items", "data", "hits"]) {
        const val = obj[key]
        if (Array.isArray(val) && val.length > 0) {
          const results = val.filter((item): item is WebSearchResult =>
            typeof item === "object" && item !== null
          )
          if (results.length > 0) return results
        }
      }
    }
  } catch { /* fall through */ }
  return null
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url.slice(0, 30)
  }
}

function renderResultCard(result: WebSearchResult, index: number): HTMLElement {
  const card = document.createElement("div")
  card.className = "ws-result-card"
  card.setAttribute("aria-label", `Result ${index + 1}`)

  const title = result.title || result.url || `Result ${index + 1}`
  const url = result.url
  const snippet = result.snippet || result.description || result.content || ""

  const titleRow = document.createElement("div")
  titleRow.className = "ws-result-title-row"

  if (url) {
    const domain = document.createElement("span")
    domain.className = "ws-result-domain"
    domain.textContent = extractDomain(url)
    titleRow.appendChild(domain)
  }

  const titleEl = document.createElement("div")
  titleEl.className = "ws-result-title"
  titleEl.textContent = title
  titleRow.appendChild(titleEl)

  card.appendChild(titleRow)

  if (snippet) {
    const snippetEl = document.createElement("div")
    snippetEl.className = "ws-result-snippet"
    snippetEl.textContent = snippet.length > 200 ? snippet.slice(0, 200) + "…" : snippet
    card.appendChild(snippetEl)
  }

  return card
}

function linkifyText(text: string): HTMLElement {
  const pre = document.createElement("pre")
  pre.className = "ws-plain-text"
  pre.textContent = text.length > 2000 ? text.slice(0, 2000) + "\n…" : text
  return pre
}

/**
 * Render a web search/fetch tool result as a rich card list.
 * Returns null if the tool is not a web search tool.
 */
export function renderWebSearchResult(toolBlock: ToolCallBlock): HTMLElement | null {
  if (!isWebSearchTool(toolBlock)) return null

  const raw = typeof toolBlock.result === "string" ? toolBlock.result : undefined
  if (!raw) return null

  const container = document.createElement("div")
  container.className = "ws-result-container"

  const results = tryParseResults(raw)

  if (results && results.length > 0) {
    const header = document.createElement("div")
    header.className = "ws-result-header"
    header.textContent = `${results.length} result${results.length === 1 ? "" : "s"}`
    container.appendChild(header)

    results.forEach((result, i) => {
      container.appendChild(renderResultCard(result, i))
    })
  } else {
    container.appendChild(linkifyText(raw))
  }

  return container
}
