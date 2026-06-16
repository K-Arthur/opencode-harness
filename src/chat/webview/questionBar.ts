import type { QuestionBlock, QuestionGroup } from "./types"

const log = typeof console !== "undefined" ? console : null
const diag = (msg: string) => log?.info(`[questionBar] ${msg}`)

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

// An item belongs to the active session when the ids match. Items or an
// active-session marker without a session id (legacy payloads, tests) are
// treated as active so single-session flows keep working.
function isActiveItem(item: QuestionBarItem): boolean {
  return !_activeSessionId || item.sessionId === _activeSessionId
}

export function initQuestionBar(postMessage: (msg: Record<string, unknown>) => void): void {
  const bar = document.getElementById("question-bar")
  const items = document.getElementById("question-bar-items")
  const count = document.getElementById("question-bar-count")
  const submitBtn = document.getElementById("question-bar-submit")
  if (!bar || !items || !count || !submitBtn) {
    diag("initQuestionBar: DOM elements not found — question system will be unavailable")
    return
  }

  els = { bar, items: items as HTMLDivElement, count: count as HTMLSpanElement, submitBtn: submitBtn as HTMLButtonElement }
  state.postMessage = postMessage
  state.items.clear()
  _activeSessionId = ""
  els.items.innerHTML = ""
  updateVisibility()
  updateSubmitState()

  submitBtn.addEventListener("click", () => submitAllAnswers())
  diag("initQuestionBar: initialized")
}

export function addQuestion(block: QuestionBlock, messageId: string, envelopeSessionId?: string): void {
  if (!els) {
    diag("addQuestion dropped: els is null (initQuestionBar failed or not called)")
    return
  }
  let toolCallId = block.toolCallId || block.id
  if (!toolCallId) {
    toolCallId = `q-${crypto.randomUUID()}`
    diag(`addQuestion: synthesized toolCallId=${toolCallId}`)
  }
  if (state.items.has(toolCallId)) {
    updateQuestion(toolCallId, block)
    return
  }

  const item: QuestionBarItem = {
    toolCallId,
    requestID: block.requestID,
    // Attribute to the question's real session: explicit block.sessionId, then
    // the dispatcher's envelope sid, and only as a last resort the viewed
    // session. The active fallback alone caused the wrong-tab bleed bug.
    sessionId: block.sessionId || envelopeSessionId || _activeSessionId,
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
  diag(`addQuestion: ${toolCallId} sessionId=${item.sessionId} groups=${item.groups.length}`)
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
  // A refreshed block copy may omit requestID (e.g. server echo without the
  // v2 field) — never wipe one we already hold, the reply path needs it.
  item.requestID = block.requestID ?? item.requestID
  item.allowFreeText = block.allowFreeText !== false
  // If the second-arrival block (e.g. from streaming path) carries a
  // sessionId, repair the first write's empty value. Fixes RC-3/RC-4.
  if (block.sessionId) item.sessionId = block.sessionId

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

export function removeQuestion(toolCallIdOrRequestId: string): void {
  if (!els) return
  let key = toolCallIdOrRequestId
  // Hosts may acknowledge by requestID only (v2 path); items are keyed by
  // toolCallId, so fall back to a requestID match before giving up.
  if (!state.items.has(key)) {
    for (const item of state.items.values()) {
      if (item.requestID && item.requestID === toolCallIdOrRequestId) {
        key = item.toolCallId
        break
      }
    }
  }
  state.items.delete(key)
  const el = els.items.querySelector(`[data-question-id="${key}"]`)
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
  maybeScheduleDismiss(item?.sessionId)
  diag(`markQuestionAnswered: ${toolCallId} value=${submittedValue?.slice(0, 50)}`)
}

/**
 * B9: revert a markQuestionAnswered when the host reports the SDK reply
 * failed (network blip, unknown requestID, server 4xx, missing v2 API).
 * Restores the interactive controls so the user can retry. The host
 * already undid its own optimistic state — this side just unwinds the
 * bar's optimistic UI so the two layers stay in sync.
 */
export function unmarkQuestionAnswered(toolCallId: string): void {
  if (!els) return
  const item = state.items.get(toolCallId)
  if (!item) return
  item.answered = false
  delete item.answeredAt
  delete item.submittedValue
  // The DOM was swapped to the answered variant on markQuestionAnswered;
  // re-render the interactive variant so the user can pick again. We build
  // the new element via buildBarItemElement (the same builder renderBarItem
  // uses) so the markup stays in sync.
  const old = els.items.querySelector(`[data-question-id="${toolCallId}"]`)
  if (old) {
    old.replaceWith(buildBarItemElement(item))
  } else {
    renderBarItem(item)
  }
  updateSubmitState()
  updateVisibility()
}

function maybeScheduleDismiss(sessionId?: string): void {
  if (!els) return
  // Dismissal is per session: another tab's unanswered question must neither
  // block this session's cleanup nor be wiped by it.
  const inScope = (i: QuestionBarItem) => !sessionId || i.sessionId === sessionId
  const stillPending = Array.from(state.items.values()).some((i) => inScope(i) && !i.answered)
  if (stillPending) return
  // Tiny delay so the user can read the "Answered" state before it goes.
  setTimeout(() => {
    for (const item of Array.from(state.items.values())) {
      if (inScope(item) && item.answered) removeQuestion(item.toolCallId)
    }
  }, 600)
}

export function setActiveSession(sessionId: string): void {
  _activeSessionId = sessionId
  if (!els) return
  // Clear the current DOM
  els.items.innerHTML = ""
  // Re-render only items belonging to the active session. Every item
  // now carries a non-empty sessionId set at addQuestion time.
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
  diag(`setActiveSession: ${sessionId} items=${state.items.size} activeCount=${getActiveQuestionCount()}`)
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
  diag("clearAllQuestions")
}

export function clearForSession(sessionId: string): void {
  if (!els) return
  const toRemove: string[] = []
  for (const [key, item] of state.items) {
    if (item.sessionId === sessionId || (item.sessionId === "" && _activeSessionId === sessionId)) {
      toRemove.push(key)
    }
  }
  for (const key of toRemove) {
    state.items.delete(key)
    const el = els.items.querySelector(`[data-question-id="${key}"]`)
    if (el) el.remove()
  }
  if (toRemove.length > 0) {
    updateVisibility()
    updateSubmitState()
    diag(`clearForSession: ${sessionId} removed=${toRemove.length}`)
  }
}

export function hasQuestionRenderedInBar(toolCallId: string): boolean {
  if (!els) return false
  return !!els.items.querySelector(`[data-question-id="${toolCallId}"]`)
}

export function getBarItem(toolCallId: string): QuestionBarItem | undefined {
  return state.items.get(toolCallId)
}

/** Check if a specific question has been registered in the bar's internal state
 *  (whether or not it's currently rendered in the DOM). Used by the inline
 *  renderer to decide whether the inline fallback should activate. */
export function hasQuestionInState(toolCallId: string): boolean {
  return state.items.has(toolCallId)
}

/**
 * Reconcile the question bar: remove stale items (answered for too long
 * without being cleaned up), items whose session no longer has open tabs,
 * and re-render any items that are in state but missing from the DOM.
 * Call this periodically or on session/tab lifecycle events.
 */
export function reconcileBar(sessionId: string): void {
  if (!els) return
  const staleTimeout = 30_000
  const now = Date.now()
  const toRemove: string[] = []
  for (const [key, item] of state.items) {
    // Remove answered items that are too old and never got acknowledged
    if (item.answered && item.answeredAt && (now - item.answeredAt) > staleTimeout) {
      toRemove.push(key)
      diag(`reconcileBar: removing stale answered item ${key}`)
      continue
    }
    // Re-render items that belong to this session but are missing from the DOM
    if (item.sessionId === sessionId && !els.items.querySelector(`[data-question-id="${key}"]`)) {
      if (item.answered) {
        els.items.appendChild(renderAnsweredItem(item))
      } else {
        renderBarItem(item)
      }
      diag(`reconcileBar: restored missing item ${key} to DOM`)
    }
  }
  for (const key of toRemove) {
    state.items.delete(key)
    const el = els.items.querySelector(`[data-question-id="${key}"]`)
    if (el) el.remove()
  }
  if (toRemove.length > 0) {
    updateVisibility()
    updateSubmitState()
  }
}

export function hasActiveQuestions(): boolean {
  for (const item of state.items.values()) {
    if (isActiveItem(item) && !item.answered) return true
  }
  return false
}

export function getActiveQuestionCount(): number {
  let count = 0
  for (const item of state.items.values()) {
    if (isActiveItem(item) && !item.answered) count++
  }
  return count
}

function updateVisibility(): void {
  if (!els) return
  // Bar is visible only when the ACTIVE session has at least one unanswered
  // question (or a just-answered card awaiting dismissal). Other sessions'
  // items stay in state but must not surface the bar for this tab.
  const hasPending = getActiveQuestionCount() > 0
  const hasAnswered = Array.from(state.items.values()).some((i) => isActiveItem(i) && i.answered)
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
    if (item.answered || !isActiveItem(item)) return false
    const hasSelection = Array.from(item.selections.values()).some((s) => s.size > 0)
    return hasSelection || item.freeTextValue.trim().length > 0
  })
  els.submitBtn.disabled = !hasAnySelection
}

function buildBarItemElement(item: QuestionBarItem): HTMLElement {
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

  // Skip button — appears above the answered badge when the question is
  // still pending. Lets the user skip/reject a question without answering.
  // Wire protocol: posts question_answer with source="skip".
  if (!item.answered) {
    const skipBtn = document.createElement("button")
    skipBtn.type = "button"
    skipBtn.className = "question-bar-skip-btn"
    skipBtn.textContent = "Skip"
    skipBtn.setAttribute("aria-label", "Skip this question")
    skipBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      if (item.answered || !state.postMessage) return
      item.answered = true
      state.postMessage({
        type: "question_answer",
        sessionId: item.sessionId,
        toolCallId: item.toolCallId,
        requestID: item.requestID,
        messageId: item.messageId,
        value: "Skipped",
        source: "skip",
      })
      markQuestionAnswered(item.toolCallId, "Skipped")
    })
    wrapper.appendChild(skipBtn)
  }

  return wrapper
}

function renderBarItem(item: QuestionBarItem): void {
  if (!els) return
  els.items.appendChild(buildBarItemElement(item))
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
    // Submit is a per-tab action: selections staged in another session's
    // bar must not be posted from this one.
    if (item.answered || !isActiveItem(item)) continue

    const parts: string[] = []
    const structuredAnswers: string[][] = []
    let hasSelection = false

    item.groups.forEach((group, gi) => {
      const chosen = Array.from(item.selections.get(gi) ?? [])
      if (chosen.length > 0) {
        hasSelection = true
        const heading = group.header || group.question || `Answer ${gi + 1}`
        parts.push(`${heading}: ${chosen.join(", ")}`)
        // Per-group selected labels — what the SDK v2 question.reply API
        // actually wants. Outer array index = group index; inner array =
        // selected labels for that group (one for single-select, N for
        // multi-select). B-edge-1: previously the wire payload was a single
        // flattened "Header1: A\nHeader2: B" string wrapped as [[value]],
        // which the server could not map back to individual groups.
        structuredAnswers.push(chosen)
      }
    })

    const free = item.freeTextValue.trim()
    if (free) {
      parts.push(free)
      // Free text is appended as its own implicit group so the wire shape
      // stays string[][] for every reply, regardless of which inputs were
      // used. The server treats it as a single-value group at the end.
      structuredAnswers.push([free])
    }

    const value = parts.join("\n")
    if (!value) continue

    state.postMessage({
      type: "question_answer",
      sessionId: item.sessionId,
      toolCallId: item.toolCallId,
      requestID: item.requestID,
      messageId: item.messageId,
      value,
      // Carry the structured per-group answers alongside the flat value.
      // The host prefers structuredAnswers when present (B-edge-1) but
      // tolerates an older webview that only sends `value` by falling back
      // to [[value]]. Both shapes stay in sync — flat for history/display,
      // structured for the SDK wire.
      structuredAnswers,
      source: hasSelection ? "option" : "freetext",
    })

    diag(`submitAllAnswers: posting question_answer for ${item.toolCallId} source=${hasSelection ? "option" : "freetext"} valueLen=${value.length}`)

    // markQuestionAnswered sets item.answered, swaps the DOM for the
    // answered state, and schedules the post-answer bar dismissal.
    markQuestionAnswered(item.toolCallId, value)
  }
}
