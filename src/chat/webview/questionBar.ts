import type { QuestionBlock, QuestionGroup } from "./types"

export interface QuestionBarItem {
  toolCallId: string
  requestID?: string
  sessionId: string
  messageId: string
  groups: QuestionGroup[]
  allowFreeText: boolean
  selections: Map<number, Set<string>>
  freeTextValue: string
  answered: boolean
  /** Snapshot of the value posted to the host — shown in the answered state so
   *  the user can confirm what was sent before the bar dismisses. */
  submittedValue?: string
  /** Timestamp at which the answer was posted — used to schedule the
   *  post-answer bar dismissal. */
  answeredAt?: number
}

interface QuestionBarState {
  items: Map<string, QuestionBarItem>
  postMessage: ((msg: Record<string, unknown>) => void) | null
}

interface QuestionBarElements {
  bar: HTMLElement
  items: HTMLDivElement
  count: HTMLSpanElement
  submitBtn: HTMLButtonElement
}

const state: QuestionBarState = {
  items: new Map(),
  postMessage: null,
}

let _activeSessionId = ""

let els: QuestionBarElements | null = null

export function initQuestionBar(postMessage: (msg: Record<string, unknown>) => void): void {
  const bar = document.getElementById("question-bar")
  const items = document.getElementById("question-bar-items")
  const count = document.getElementById("question-bar-count")
  const submitBtn = document.getElementById("question-bar-submit")
  if (!bar || !items || !count || !submitBtn) return

  els = { bar, items: items as HTMLDivElement, count: count as HTMLSpanElement, submitBtn: submitBtn as HTMLButtonElement }
  state.postMessage = postMessage
  state.items.clear()
  els.items.innerHTML = ""
  updateVisibility()
  updateSubmitState()

  submitBtn.addEventListener("click", () => submitAllAnswers())
}

export function addQuestion(block: QuestionBlock, messageId: string): void {
  if (!els) return
  const toolCallId = block.toolCallId || block.id
  if (state.items.has(toolCallId)) {
    updateQuestion(toolCallId, block)
    return
  }

  const item: QuestionBarItem = {
    toolCallId,
    requestID: block.requestID,
    sessionId: block.sessionId ?? "",
    messageId,
    groups: block.groups ?? [],
    allowFreeText: block.allowFreeText !== false,
    selections: new Map(),
    freeTextValue: "",
    answered: false,
  }

  for (let i = 0; i < item.groups.length; i++) {
    item.selections.set(i, new Set())
  }

  state.items.set(toolCallId, item)
  renderBarItem(item)
  updateVisibility()
  updateSubmitState()
}

export function updateQuestion(toolCallId: string, block: QuestionBlock): void {
  if (!els) return
  const item = state.items.get(toolCallId)
  if (!item) {
    addQuestion(block, "")
    return
  }

  const oldGroupCount = item.groups.length
  item.groups = block.groups ?? []
  item.requestID = block.requestID
  item.allowFreeText = block.allowFreeText !== false

  while (item.selections.size < item.groups.length) {
    item.selections.set(item.selections.size, new Set())
  }

  const existingEl = els.items.querySelector(`[data-question-id="${toolCallId}"]`)
  if (existingEl) existingEl.remove()

  if (oldGroupCount !== item.groups.length) {
    for (let i = 0; i < item.groups.length; i++) {
      if (!item.selections.has(i)) {
        item.selections.set(i, new Set())
      }
    }
  }

  renderBarItem(item)
  updateSubmitState()
}

export function removeQuestion(toolCallId: string): void {
  if (!els) return
  state.items.delete(toolCallId)
  const el = els.items.querySelector(`[data-question-id="${toolCallId}"]`)
  if (el) el.remove()
  updateVisibility()
  updateSubmitState()
}

export function markQuestionAnswered(toolCallId: string, submittedValue?: string): void {
  if (!els) return
  const item = state.items.get(toolCallId)
  if (item) {
    item.answered = true
    if (submittedValue !== undefined) {
      item.submittedValue = submittedValue
    }
    item.answeredAt = Date.now()
    const el = els.items.querySelector(`[data-question-id="${toolCallId}"]`)
    if (el) {
      el.classList.add("question-bar-item--answered")
      // Re-render so the answer text + dismiss button are shown in the
      // answered state instead of the still-interactive controls.
      el.replaceWith(renderAnsweredItem(item))
    }
  }
  updateSubmitState()
  // If every pending question is now answered, schedule the auto-dismiss.
  // Shorter than the previous 1500ms so the user gets feedback quickly.
  maybeScheduleDismiss()
}

function maybeScheduleDismiss(): void {
  if (!els) return
  // Don't dismiss while the user still has unanswered items in the bar.
  const stillPending = Array.from(state.items.values()).some((i) => !i.answered)
  if (stillPending) return
  // Tiny delay so the user can read the "Answered" state before it goes.
  setTimeout(() => {
    const allAnswered = Array.from(state.items.values()).every((i) => i.answered)
    if (allAnswered) clearAllQuestions()
  }, 600)
}

export function setActiveSession(sessionId: string): void {
  _activeSessionId = sessionId
  if (!els) return
  // Clear the current DOM
  els.items.innerHTML = ""
  // Re-render only items belonging to the active session. Answered items
  // are rendered as read-only cards (with the submitted value) so the user
  // can still see what they answered for the active tab.
  for (const item of state.items.values()) {
    if (item.sessionId === sessionId) {
      if (item.answered) {
        els.items.appendChild(renderAnsweredItem(item))
      } else {
        renderBarItem(item)
      }
    }
  }
  updateVisibility()
  updateSubmitState()
}

/**
 * Re-populate the question bar from a session's persisted message list.
 * Called on webview reload / init_state so pending questions survive page refresh.
 */
export function repopulateFromMessages(sessionId: string, messages: Array<{ id: string; blocks: Array<{ type: string; toolCallId?: string; id?: string; answered?: boolean; groups?: unknown[] }> }>): void {
  if (!els) return
  for (const msg of messages) {
    if (!msg.blocks) continue
    for (const block of msg.blocks) {
      if (block.type === "question" && !block.answered) {
        const toolCallId = block.toolCallId || block.id || ""
        if (!state.items.has(toolCallId)) {
          addQuestion(block as any, msg.id)
        }
      }
    }
  }
  setActiveSession(sessionId)
}

export function clearAllQuestions(): void {
  if (!els) return
  state.items.clear()
  els.items.innerHTML = ""
  updateVisibility()
  updateSubmitState()
}

export function hasActiveQuestions(): boolean {
  for (const item of state.items.values()) {
    if (!item.answered) return true
  }
  return false
}

export function getActiveQuestionCount(): number {
  let count = 0
  for (const item of state.items.values()) {
    if (!item.answered) count++
  }
  return count
}

function updateVisibility(): void {
  if (!els) return
  // Bar is visible only when there is at least one UNANSWERED question. If
  // every item is answered, the bar shows briefly (the answered card) and
  // is auto-dismissed; once it empties, the wrapper collapses entirely so
  // the user is not staring at a half-empty bar after submitting.
  const hasPending = getActiveQuestionCount() > 0
  const hasAnswered = Array.from(state.items.values()).some((i) => i.answered)
  els.bar.classList.toggle("hidden", !hasPending && !hasAnswered)
  const activeCount = getActiveQuestionCount()
  if (activeCount > 1) {
    els.count.textContent = `${activeCount} questions`
    els.count.classList.remove("hidden")
  } else {
    els.count.classList.add("hidden")
  }
}

function updateSubmitState(): void {
  if (!els) return
  const hasAnySelection = Array.from(state.items.values()).some((item) => {
    if (item.answered) return false
    const hasSelection = Array.from(item.selections.values()).some((s) => s.size > 0)
    return hasSelection || item.freeTextValue.trim().length > 0
  })
  els.submitBtn.disabled = !hasAnySelection
}

function renderBarItem(item: QuestionBarItem): void {
  if (!els) return
  const wrapper = document.createElement("div")
  wrapper.className = "question-bar-item"
  wrapper.setAttribute("data-question-id", item.toolCallId)
  if (item.answered) wrapper.classList.add("question-bar-item--answered")

  item.groups.forEach((group, gi) => {
    const section = document.createElement("div")
    section.className = "question-bar-section"

    if (group.header) {
      const hdr = document.createElement("div")
      hdr.className = "question-bar-section-header"
      hdr.textContent = group.header
      section.appendChild(hdr)
    }

    if (group.question) {
      const q = document.createElement("div")
      q.className = "question-bar-question"
      q.textContent = group.question
      section.appendChild(q)
    }

    if (group.options.length > 0) {
      const optionsRow = document.createElement("div")
      optionsRow.className = "question-bar-options"
      optionsRow.setAttribute("role", "group")
      optionsRow.setAttribute("aria-label", group.header ?? "Answer options")

      const sel = item.selections.get(gi) ?? new Set<string>()
      for (const opt of group.options) {
        const btn = document.createElement("button")
        btn.type = "button"
        btn.className = "question-bar-option"
        btn.textContent = opt
        btn.setAttribute("aria-pressed", sel.has(opt) ? "true" : "false")
        if (sel.has(opt)) btn.classList.add("selected")

        btn.addEventListener("click", (e) => {
          e.stopPropagation()
          if (item.answered) return
          const currentSel = item.selections.get(gi) ?? new Set<string>()
          if (group.multiSelect) {
            if (currentSel.has(opt)) {
              currentSel.delete(opt)
              btn.classList.remove("selected")
              btn.setAttribute("aria-pressed", "false")
            } else {
              currentSel.add(opt)
              btn.classList.add("selected")
              btn.setAttribute("aria-pressed", "true")
            }
          } else {
            currentSel.clear()
            currentSel.add(opt)
            for (const b of optionsRow.querySelectorAll(".question-bar-option")) {
              b.classList.remove("selected")
              b.setAttribute("aria-pressed", "false")
            }
            btn.classList.add("selected")
            btn.setAttribute("aria-pressed", "true")
          }
          item.selections.set(gi, currentSel)
          updateSubmitState()
        })

        optionsRow.appendChild(btn)
      }
      section.appendChild(optionsRow)
    }

    wrapper.appendChild(section)
  })

  if (item.allowFreeText) {
    const ta = document.createElement("textarea")
    ta.className = "question-bar-freetext"
    ta.rows = 2
    ta.maxLength = 10000
    ta.placeholder = "Type a custom answer\u2026"
    ta.setAttribute("aria-label", "Type a custom answer")
    ta.value = item.freeTextValue
    ta.addEventListener("input", () => {
      item.freeTextValue = ta.value
      updateSubmitState()
    })
    if (item.answered) ta.disabled = true
    wrapper.appendChild(ta)
  }

  if (item.answered) {
    const badge = document.createElement("div")
    badge.className = "question-bar-answered-badge"
    badge.textContent = "Answered"
    wrapper.appendChild(badge)
  }

  els.items.appendChild(wrapper)
}

/**
 * Render the answered state of a question item: a compact, read-only card
 * showing the submitted answer text plus a Dismiss button. This replaces
 * the interactive controls in the same DOM slot so the user can read what
 * they sent before the bar auto-dismisses.
 */
function renderAnsweredItem(item: QuestionBarItem): HTMLElement {
  const wrapper = document.createElement("div")
  wrapper.className = "question-bar-item question-bar-item--answered"
  wrapper.setAttribute("data-question-id", item.toolCallId)
  wrapper.setAttribute("aria-label", "Answered question")

  const header = document.createElement("div")
  header.className = "question-bar-answered-header"

  const status = document.createElement("span")
  status.className = "question-bar-answered-status"
  status.textContent = "\u2713 Answered"
  header.appendChild(status)

  const dismiss = document.createElement("button")
  dismiss.type = "button"
  dismiss.className = "question-bar-dismiss-btn"
  dismiss.setAttribute("aria-label", "Dismiss answered question")
  dismiss.title = "Dismiss"
  dismiss.textContent = "\u00D7"
  dismiss.addEventListener("click", (e) => {
    e.stopPropagation()
    removeQuestion(item.toolCallId)
  })
  header.appendChild(dismiss)
  wrapper.appendChild(header)

  if (item.submittedValue) {
    const answerBlock = document.createElement("div")
    answerBlock.className = "question-bar-answered-value"
    answerBlock.textContent = item.submittedValue
    answerBlock.title = item.submittedValue
    wrapper.appendChild(answerBlock)
  }

  return wrapper
}

function submitAllAnswers(): void {
  if (!state.postMessage) return

  for (const item of state.items.values()) {
    if (item.answered) continue

    const parts: string[] = []
    let hasSelection = false

    item.groups.forEach((group, gi) => {
      const chosen = Array.from(item.selections.get(gi) ?? [])
      if (chosen.length > 0) {
        hasSelection = true
        const heading = group.header || group.question || `Answer ${gi + 1}`
        parts.push(`${heading}: ${chosen.join(", ")}`)
      }
    })

    const free = item.freeTextValue.trim()
    if (free) parts.push(free)

    const value = parts.join("\n")
    if (!value) continue

    state.postMessage({
      type: "question_answer",
      sessionId: item.sessionId,
      toolCallId: item.toolCallId,
      requestID: item.requestID,
      messageId: item.messageId,
      value,
      source: hasSelection ? "option" : "freetext",
    })

    // markQuestionAnswered sets item.answered, swaps the DOM for the
    // answered state, and schedules the post-answer bar dismissal.
    markQuestionAnswered(item.toolCallId, value)
  }
}
