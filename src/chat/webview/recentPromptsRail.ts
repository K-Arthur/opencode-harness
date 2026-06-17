/**
 * Recent / pinned prompts rail (brief Phase 5 "Pinned Prompts").
 *
 * Wires the pure `buildPromptRail` core into a webview surface: derives prompt
 * entries from a session's user messages, renders pinned-first chips at the top
 * of the session, and exposes pin-toggle + click-to-reuse. Pinned ids are
 * persisted per session in the webview state (state.toggleSessionPinnedPrompt).
 */
import { buildPromptRail, type PromptEntry } from "../../prompts/recentPrompts"
import type { ChatMessage } from "./types"

export interface RecentPromptsRailOptions {
  messages: readonly ChatMessage[]
  pinnedIds: Iterable<string>
  onPin: (promptId: string) => void
  onPick: (text: string) => void
  maxRecent?: number
}

function promptText(msg: ChatMessage): string {
  const blocks = (msg as { blocks?: Array<{ type?: string; text?: string }> }).blocks
  if (Array.isArray(blocks)) {
    const t = blocks.find((b) => b?.type === "text" && typeof b.text === "string")
    if (t?.text) return t.text
  }
  const direct = (msg as { text?: unknown }).text
  return typeof direct === "string" ? direct : ""
}

function truncate(s: string, n: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim()
  return oneLine.length > n ? `${oneLine.slice(0, n - 1)}…` : oneLine
}

export function renderRecentPromptsRail(container: HTMLElement, opts: RecentPromptsRailOptions): void {
  const entries: PromptEntry[] = []
  for (const m of opts.messages) {
    if ((m as { role?: string }).role !== "user") continue
    const text = promptText(m).trim()
    if (!text || !m.id) continue
    entries.push({ id: m.id, text, time: (m as { timestamp?: number }).timestamp ?? 0 })
  }

  const rail = buildPromptRail(entries, opts.pinnedIds, opts.maxRecent !== undefined ? { maxRecent: opts.maxRecent } : {})
  container.replaceChildren()
  if (rail.length === 0) {
    container.classList.add("hidden")
    return
  }
  container.classList.remove("hidden")

  // The first item is the most recent/pinned prompt, shown in a large card
  const firstItem = rail[0]!
  const card = document.createElement("div")
  card.className = `rp-featured-card${firstItem.pinned ? " rp-featured-card--pinned" : ""}`
  card.setAttribute("data-prompt-id", firstItem.id)

  const cardHeader = document.createElement("div")
  cardHeader.className = "rp-card-header"

  const cardTitle = document.createElement("span")
  cardTitle.className = "rp-card-title"
  cardTitle.textContent = firstItem.pinned ? "★ Pinned Prompt" : "☆ Recent Prompt"

  const pinBtn = document.createElement("button")
  pinBtn.className = "rp-card-pin-btn"
  pinBtn.type = "button"
  pinBtn.setAttribute("aria-pressed", String(firstItem.pinned))
  pinBtn.title = firstItem.pinned ? "Unpin prompt" : "Pin prompt"
  pinBtn.textContent = firstItem.pinned ? "★" : "☆"
  pinBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    opts.onPin(firstItem.id)
  })

  cardHeader.appendChild(cardTitle)
  cardHeader.appendChild(pinBtn)

  const cardBody = document.createElement("button")
  cardBody.className = "rp-card-body"
  cardBody.type = "button"
  cardBody.title = firstItem.text

  const cardText = document.createElement("span")
  cardText.className = "rp-card-text"
  cardText.textContent = firstItem.text

  cardBody.addEventListener("click", (e) => {
    e.stopPropagation()
    opts.onPick(firstItem.text)
  })

  cardBody.appendChild(cardText)
  card.appendChild(cardHeader)
  card.appendChild(cardBody)
  container.appendChild(card)

  // Remaining prompts are shown as smaller compact chips
  if (rail.length > 1) {
    const remainingContainer = document.createElement("div")
    remainingContainer.className = "rp-remaining-container"

    for (let i = 1; i < rail.length; i++) {
      const item = rail[i]!
      const chip = document.createElement("div")
      chip.className = `rp-chip${item.pinned ? " rp-chip--pinned" : ""}`
      chip.setAttribute("data-prompt-id", item.id)

      const pin = document.createElement("button")
      pin.className = "rp-chip-pin"
      pin.type = "button"
      pin.setAttribute("aria-pressed", String(item.pinned))
      pin.title = item.pinned ? "Unpin prompt" : "Pin prompt"
      pin.textContent = item.pinned ? "★" : "☆"
      pin.addEventListener("click", (e) => {
        e.stopPropagation()
        opts.onPin(item.id)
      })

      const text = document.createElement("button")
      text.className = "rp-chip-text"
      text.type = "button"
      text.title = item.text
      text.textContent = truncate(item.text, 60)
      text.addEventListener("click", (e) => {
        e.stopPropagation()
        opts.onPick(item.text)
      })

      chip.appendChild(pin)
      chip.appendChild(text)
      remainingContainer.appendChild(chip)
    }
    container.appendChild(remainingContainer)
  }
}
