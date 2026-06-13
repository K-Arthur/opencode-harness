import type { Block, ChatMessage, ToolCollapseConfig } from "./types"
import {
  isToolCallBlock,
  renderBlock,
  renderToolGroup,
  groupConsecutiveToolCalls,
  formatRelativeTime,
  RenderOptions,
} from "./renderer"
import { isSwitchEventType } from "./switchEvent"
import {
  createToolCollapseControls,
} from "./toolCallRenderer"
import { estimateMessageTokens } from "../../utils/tokenCounter"

export function renderMessage(msg: ChatMessage, opts?: RenderOptions, isConsecutive?: boolean): HTMLDivElement {
  const div = document.createElement("div")
  const role: string = msg.role || "assistant"
  // Mark assistant turns produced in plan mode so the bubble can paint an
  // amber accent — gives the user a clear "this was planning, not applied
  // work" cue, even when the agent only wrote prose.
  const planClass = opts?.mode === "plan" && role === "assistant" ? " message--plan-mode" : ""
  div.className = `message ${role}${planClass}`
  if (msg.id) div.dataset.messageId = msg.id
  if (role) div.dataset.role = role

  const contentWrapper = document.createElement("div")
  contentWrapper.className = "message-content"

  // Only show header if not consecutive AND not a re-render (opts?.skipHeader indicates re-render)
  // Detect switch notification to apply compact styling
  const isSwitchMsg = role === "system" && msg.blocks?.some(b => b.type === "activity" && isSwitchEventType(b.eventType))
  if (isSwitchMsg) div.classList.add("message--compact-system")

  if (role !== "system" && !isConsecutive && !opts?.skipHeader) {
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
    // Per-turn mode badge for session history (like Copilot Session Insights)
    if (msg.mode) {
      const modeBadge = document.createElement("span")
      modeBadge.className = `message-mode-badge message-mode-badge--${msg.mode}`
      modeBadge.textContent = msg.mode === "plan" ? "Plan" : msg.mode === "auto" ? "Auto" : "Build"
      modeBadge.title = `This message was produced in ${msg.mode} mode`
      header.appendChild(modeBadge)
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
    if (msg.id && opts?.turnIndex !== undefined) {
      const forkBtn = document.createElement("button")
      forkBtn.className = "message-fork-btn"
      forkBtn.setAttribute("aria-label", "Fork conversation from here")
      forkBtn.title = `Fork conversation from turn ${opts.turnIndex + 1}`
      forkBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>'
      forkBtn.addEventListener("click", () => {
        const pm = opts?.postMessage
        if (pm) {
          pm({ type: "fork_session", sessionId: opts.sessionId ?? msg.sessionId, turnIndex: opts.turnIndex })
        }
      })
      header.appendChild(forkBtn)
    }
    contentWrapper.appendChild(header)
  }

  const bubble = document.createElement("div")
  bubble.className = role === "system" ? "system-bubble" : "message-bubble"

  // Add collapse controls if there are tool calls
  const config = opts?.collapseConfig || {
    groupBy: 'consecutive',
    defaultCollapsed: true,
    collapseThreshold: 1,
    showTypeBreakdown: true,
    compactMode: false
  }
  
  const toolBlocks = (msg.blocks || []).filter(isToolCallBlock)
  const hasToolCalls = toolBlocks.length > 0
  if (hasToolCalls && role === "assistant" && !isConsecutive) {
    const toolControlsContainer = document.createElement("div")
    toolControlsContainer.className = "message-tool-controls"
    createToolCollapseControls(
      toolControlsContainer,
      () => {
        // Collapse all tool calls in this message
        bubble.querySelectorAll<HTMLDetailsElement>("details.tool-call, details.tool-group").forEach(el => {
          el.open = false
        })
      },
      () => {
        // Expand all tool calls in this message
        bubble.querySelectorAll<HTMLDetailsElement>("details.tool-call, details.tool-group").forEach(el => {
          el.open = true
        })
      },
      () => {
        // Toggle compact mode
        config.compactMode = !config.compactMode
        const newConfig = { ...config, compactMode: config.compactMode }
        if (opts?.postMessage) {
          opts.postMessage({ type: "update_collapse_config", config: newConfig })
        }
        // Re-render message with new config
        bubble.querySelectorAll<HTMLElement>(".tool-group").forEach(el => {
          el.classList.toggle("tool-group--compact", config.compactMode)
        })
      },
      config.compactMode
    )
    contentWrapper.appendChild(toolControlsContainer)
  }

  if (msg.blocks && Array.isArray(msg.blocks)) {
    const renderOpts = {
      messageId: msg.id,
      mode: opts?.mode,
      role,
      postMessage: opts?.postMessage,
      collapseConfig: config,
    }

    for (const group of groupConsecutiveToolCalls(msg.blocks, config.groupBy)) {
      const firstBlock = group[0]
      if (!firstBlock) continue

      const isAssistantToolRun = role === "assistant" && group.every(isToolCallBlock)
      if (isAssistantToolRun && group.length > 1) {
        const groupEl = renderToolGroup(group, renderOpts)
        if (groupEl) bubble.appendChild(groupEl)
        continue
      }

      for (const block of group) {
        const el = renderBlock(block, renderOpts)
        if (el) bubble.appendChild(el)
      }
    }
  }

  contentWrapper.appendChild(bubble)
  div.appendChild(contentWrapper)

  // A system message whose blocks all render to nothing leaves an empty card.
  // This happens for "Edited N files" banners persisted in older session state,
  // which are now intentionally suppressed (see renderTaskBanner). System rows
  // have no header, so an empty bubble has zero content — collapse the row so no
  // ghost card remains. (Non-system rows always carry a header, so we leave them.)
  if (role === "system" && bubble.childElementCount === 0) {
    div.style.display = "none"
    div.dataset.empty = "true"
  }

  return div
}
