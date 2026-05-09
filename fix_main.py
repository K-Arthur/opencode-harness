import sys

file_path = 'src/chat/webview/main.ts'
with open(file_path, 'r') as f:
    content = f.read()

# 1. Add groupMessagesIntoTurns
content = content.replace(
    'import { renderMessage } from "./renderer"',
    'import { renderMessage, groupMessagesIntoTurns } from "./renderer"'
)

# 2. Add onToggleFavorite
content = content.replace(
    '''      if (sessionId) {
        vscode.postMessage({ type: "connect_provider", sessionId })
      }
    },
  })''',
    '''      if (sessionId) {
        vscode.postMessage({ type: "connect_provider", sessionId })
      }
    },
    onToggleFavorite: (modelId) => {
      vscode.postMessage({ type: "toggle_favorite_model", modelId })
    },
  })'''
)

# 3. Add timeline functions
timeline_code = '''
  /* ─── TURN NAVIGATION ─── */

  function scrollToTurn(messageId: string, turnIndex: number) {
    const msgList = getActiveMessageList(els)
    if (!msgList) return
    let target = msgList.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`) as HTMLElement | null
    if (!target) {
      const userMessages = Array.from(msgList.querySelectorAll('.message[data-role="user"]'))
      if (userMessages[turnIndex]) {
        target = userMessages[turnIndex] as HTMLElement
      }
    }
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" })
      target.setAttribute("tabindex", "-1")
      target.focus()
    }
  }

  /* ─── CONVERSATION TIMELINE ─── */

  function setupTimelineToggle() {
    els.timelineToggleBtn.setAttribute("aria-pressed", String(stateManager.isTimelineVisible()))
    els.timelineToggleBtn.addEventListener("click", () => {
      const visible = !stateManager.isTimelineVisible()
      stateManager.setTimelineVisible(visible)
      applyTimelineVisibility()
    })
    applyTimelineVisibility()
  }

  function applyTimelineVisibility(sessionId?: string) {
    const targetId = sessionId || stateManager.getState().activeSessionId
    const visible = stateManager.isTimelineVisible()
    els.timelineToggleBtn.classList.toggle("active", visible)
    els.timelineToggleBtn.setAttribute("aria-pressed", String(visible))

    document.querySelectorAll(".message-list.timeline-visible").forEach((el) => el.classList.remove("timeline-visible"))
    document.querySelectorAll(".conversation-timeline.visible").forEach((el) => el.classList.remove("visible"))

    if (!visible || !targetId) return
    refreshConversationTimeline(targetId)
  }

  function refreshConversationTimeline(sessionId?: string) {
    const targetId = sessionId || stateManager.getState().activeSessionId
    if (!targetId || !stateManager.isTimelineVisible()) return

    const session = stateManager.getSession(targetId)
    const msgList = getMessageList(targetId)
    const timeline = ensureTimeline(targetId)
    if (!session || !msgList || !timeline) return

    const turns = groupMessagesIntoTurns(session.messages)
    timeline.replaceChildren()
    msgList.classList.toggle("timeline-visible", turns.length > 0)
    timeline.classList.toggle("visible", turns.length > 0)
    if (turns.length === 0) return

    const progress = document.createElement("div")
    progress.className = "timeline-progress"
    timeline.appendChild(progress)

    const header = document.createElement("div")
    header.className = "timeline-header"
    header.textContent = "CONVERSATION TIMELINE"
    timeline.appendChild(header)

    turns.forEach((turn, index) => {
      const item = document.createElement("button")
      item.type = "button"
      item.className = "timeline-item"
      item.dataset.messageId = turn.userMessageId
      item.setAttribute("aria-label", `Jump to turn ${index + 1}: ${turn.snippet}`)

      const role = document.createElement("span")
      role.className = "timeline-item-role"
      const dot = document.createElement("span")
      dot.className = "role-dot user"
      role.appendChild(dot)
      const label = document.createElement("span")
      label.textContent = `Turn ${index + 1}`
      role.appendChild(label)
      item.appendChild(role)

      const preview = document.createElement("span")
      preview.className = "timeline-item-preview" + (turn.toolCount > 0 ? " has-tool" : "")
      preview.textContent = turn.toolCount > 0 ? `${turn.snippet} (${turn.toolCount} tools)` : turn.snippet
      item.appendChild(preview)

      item.addEventListener("click", () => {
        scrollToTurn(turn.userMessageId, index)
        updateTimelineProgress(targetId)
      })
      timeline.appendChild(item)
    })

    if (!timeline.dataset.keyListener) {
      timeline.dataset.keyListener = "true"
      timeline.addEventListener("keydown", (e) => {
        const items = Array.from(timeline!.querySelectorAll<HTMLElement>(".timeline-item"))
        if (items.length === 0) return
        const focused = timeline!.querySelector<HTMLElement>(".timeline-item:focus")
        const idx = focused ? items.indexOf(focused) : -1
        if (e.key === "ArrowDown") {
          e.preventDefault()
          items[Math.min(idx + 1, items.length - 1)]?.focus()
        } else if (e.key === "ArrowUp") {
          e.preventDefault()
          items[Math.max(idx - 1, 0)]?.focus()
        } else if (e.key === "Home") {
          e.preventDefault()
          items[0]?.focus()
        } else if (e.key === "End") {
          e.preventDefault()
          items[items.length - 1]?.focus()
        }
      })
    }

    if (!msgList.dataset.timelineListener) {
      msgList.dataset.timelineListener = "true"
      msgList.addEventListener("scroll", () => updateTimelineProgress(targetId), { passive: true })
    }
    updateTimelineProgress(targetId)
  }

  function ensureTimeline(sessionId: string): HTMLElement | null {
    const view = els.tabPanels.querySelector<HTMLElement>(`.tab-panel[data-tab-id="${CSS.escape(sessionId)}"]`)
    if (!view) return null
    let timeline = view.querySelector<HTMLElement>(".conversation-timeline")
    if (!timeline) {
      timeline = document.createElement("aside")
      timeline.className = "conversation-timeline"
      timeline.setAttribute("role", "navigation")
      timeline.setAttribute("aria-label", "Conversation turns")
      view.appendChild(timeline)
    }
    return timeline
  }

  function updateTimelineProgress(sessionId: string) {
    const msgList = getMessageList(sessionId)
    const timeline = ensureTimeline(sessionId)
    if (!msgList || !timeline) return
    const progress = timeline.querySelector<HTMLElement>(".timeline-progress")
    const total = Math.max(1, msgList.scrollHeight - msgList.clientHeight)
    const ratio = Math.min(1, Math.max(0, msgList.scrollTop / total))
    if (progress) progress.style.height = `${Math.round(ratio * 100)}%`

    const items = Array.from(timeline.querySelectorAll<HTMLElement>(".timeline-item"))
    let active: HTMLElement | null = null
    for (const item of items) {
      const id = item.dataset.messageId
      if (!id) continue
      const target = msgList.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(id)}"]`)
      if (target && target.offsetTop <= msgList.scrollTop + 48) active = item
    }
    items.forEach((item) => item.classList.toggle("active", item === active))
  }

  /* ─── START ─── */
'''
content = content.replace('  /* ─── START ─── */\n', timeline_code)

with open(file_path, 'w') as f:
    f.write(content)

print("done")
