import type { Block, ChatMessage } from "./types"
import {
  isToolCallBlock,
  groupConsecutiveToolCalls,
  renderBlock,
  renderToolGroup,
  formatRelativeTime,
  RenderOptions,
} from "./renderer"
import { estimateMessageTokens } from "../../utils/tokenCounter"

export function renderMessage(msg: ChatMessage, opts?: RenderOptions, isConsecutive?: boolean): HTMLDivElement {
  const div = document.createElement("div")
  const role: string = msg.role || "assistant"
  div.className = `message ${role}`
  if (msg.id) div.dataset.messageId = msg.id
  if (role) div.dataset.role = role

  const contentWrapper = document.createElement("div")
  contentWrapper.className = "message-content"

  if (role !== "system" && !isConsecutive) {
    const header = document.createElement("div")
    header.className = "message-header"
    const roleSpan = document.createElement("span")
    roleSpan.className = "message-role"
    roleSpan.textContent = role === "user" ? "You" : "OpenCode"
    header.appendChild(roleSpan)

    const messageTokens = msg.tokenCount ?? estimateMessageTokens(msg)
    if (messageTokens > 0) {
      const tokenBadge = document.createElement("span")
      tokenBadge.className = "message-token-badge"
      tokenBadge.textContent = `${messageTokens.toLocaleString()} tok`
      tokenBadge.title = msg.tokenCount ? `SDK-reported tokens for this message` : "Estimated tokens for this message"
      header.appendChild(tokenBadge)
    }

    if (msg.timestamp) {
      const ts = document.createElement("span")
      ts.className = "message-timestamp"
      ts.textContent = formatRelativeTime(msg.timestamp)
      header.appendChild(ts)
    }
    if (role === "user" && msg.id) {
      const editBtn = document.createElement("button")
      editBtn.className = "message-edit-btn"
      editBtn.setAttribute("aria-label", "Edit message")
      editBtn.title = "Edit message"
      editBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>'
      editBtn.addEventListener("click", () => {
        const textBlocks = (msg.blocks || []).filter((b) => b.type === "text")
        const text = textBlocks.map((b) => b.text || "").join("\n")
        const pm = opts?.postMessage
        if (pm) {
          pm({ type: "edit_message", messageId: msg.id, text, sessionId: msg.sessionId })
        }
      })
      header.appendChild(editBtn)
    }
    if (role === "assistant" && msg.id) {
      const revertBtn = document.createElement("button")
      revertBtn.className = "message-revert-btn"
      revertBtn.setAttribute("aria-label", "Revert message changes")
      revertBtn.title = "Revert code changes from this message"
      revertBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>'
      revertBtn.addEventListener("click", () => {
        const pm = opts?.postMessage
        if (pm) {
          pm({ type: "revert_message", messageId: msg.id, sessionId: msg.sessionId })
        }
      })
      header.appendChild(revertBtn)
    }
    contentWrapper.appendChild(header)
  }

  const bubble = document.createElement("div")
  bubble.className = role === "system" ? "system-bubble" : "message-bubble"

  if (msg.blocks && Array.isArray(msg.blocks)) {
    const groups = groupConsecutiveToolCalls(msg.blocks)
    for (const group of groups) {
      const firstBlock = group[0]
      if (!firstBlock) continue
      if (group.length === 1 || !isToolCallBlock(firstBlock)) {
        const el = renderBlock(firstBlock, { messageId: msg.id, mode: opts?.mode, postMessage: opts?.postMessage })
        if (el) bubble.appendChild(el)
      } else {
        const groupEl = renderToolGroup(group, { messageId: msg.id, mode: opts?.mode, postMessage: opts?.postMessage })
        if (groupEl) bubble.appendChild(groupEl)
      }
    }
  }

  contentWrapper.appendChild(bubble)
  div.appendChild(contentWrapper)

  return div
}
