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
  /** Per-card ready-tracking: group indices whose "Ready" button was clicked.
   *  A ready card's selections are included when Submit All runs. */
  cardReady: Set<number>
  /** Current carousel index for card-by-card navigation. */
  _carouselIdx: number
  /** Timestamp when this question was first added to the bar. Used for
   *  staleness detection (B10). */
  createdAt: number
  /** Original server session ID that created this question. For subagent
   *  (child session) questions, this is the child session ID — the reply
   *  must route to this session, not the parent tab's session. */
  originSessionId?: string
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

/** Per-question staleness timers. Cleared on answer/remove. */
const staleTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** B10: Staleness threshold — questions older than this are auto-flagged. */
const STALE_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes

let _activeSessionId = ""

let els: QuestionBarElements | null = null

// An item belongs to the active session when the ids match. Items or an
// active-session marker without a session id (legacy payloads, tests) are
// treated as active so single-session flows keep working.
function isActiveItem(item: QuestionBarItem): boolean {
  return !_activeSessionId || item.sessionId === _activeSessionId
}

/** B10: Arm a staleness timer for a question. When it fires, markStale is called. */
function armStalenessTimer(toolCallId: string): void {
  clearStalenessTimer(toolCallId)
  const timer = setTimeout(() => {
    staleTimers.delete(toolCallId)
    markStale(toolCallId)
  }, STALE_THRESHOLD_MS)
  // Don't hold the process open if this is the only timer
  if (typeof timer === "object" && "unref" in timer) timer.unref()
  staleTimers.set(toolCallId, timer)
}

/** B10: Clear a staleness timer (called on answer/remove). */
function clearStalenessTimer(toolCallId: string): void {
  const timer = staleTimers.get(toolCallId)
  if (timer) {
    clearTimeout(timer)
    staleTimers.delete(toolCallId)
  }
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
    sessionId: block.sessionId || envelopeSessionId || _activeSessionId,
    messageId,
    groups: block.groups ?? [],
    allowFreeText: block.allowFreeText !== false,
    selections: new Map(),
    freeTextValue: "",
    answered: block.answered === true,
    submittedValue: block.answered === true ? (block as Record<string, unknown>).answer as string | undefined : undefined,
    cardReady: new Set(),
    _carouselIdx: 0,
    createdAt: Date.now(),
    originSessionId: (block as Record<string, unknown>).originSessionId as string | undefined,
  }

  for (let i = 0; i < item.groups.length; i++) {
    item.selections.set(i, new Set())
  }

  state.items.set(toolCallId, item)
  renderBarItem(item)
  updateVisibility()
  updateSubmitState()

  // B10: Arm staleness timer — after STALE_THRESHOLD_MS, show warning UI
  armStalenessTimer(toolCallId)

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
  clearStalenessTimer(key)
  const el = els.items.querySelector(`[data-question-id="${key}"]`)
  if (el) el.remove()
  updateVisibility()
  updateSubmitState()
}

export function markQuestionAnswered(toolCallId: string, submittedValue?: string): void {
  if (!els) return
  // Resolve ID: tool_start uses prt_*, question.asked uses call_*, requestID is que_*
  // Items are keyed by toolCallId (call_*) but callers may pass any of the three.
  let resolvedId = toolCallId
  if (!state.items.has(resolvedId)) {
    for (const item of state.items.values()) {
      if (item.requestID === toolCallId) {
        resolvedId = item.toolCallId
        break
      }
    }
  }
  clearStalenessTimer(resolvedId)
  const item = state.items.get(resolvedId)
  if (item) {
    item.answered = true
    if (submittedValue !== undefined) {
      item.submittedValue = submittedValue
    }
    item.answeredAt = Date.now()
    const el = els.items.querySelector(`[data-question-id="${resolvedId}"]`)
    if (el) {
      el.classList.add("question-bar-item--answered")
      el.replaceWith(renderAnsweredItem(item))
    }
  }
  updateSubmitState()
  maybeScheduleDismiss(item?.sessionId)
  diag(`markQuestionAnswered: ${resolvedId} value=${submittedValue?.slice(0, 50)}`)
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
  // Resolve ID: callers may pass prt_*, call_*, or que_* — items are keyed by call_*
  let resolvedId = toolCallId
  if (!state.items.has(resolvedId)) {
    for (const item of state.items.values()) {
      if (item.requestID === toolCallId) {
        resolvedId = item.toolCallId
        break
      }
    }
  }
  const item = state.items.get(resolvedId)
  if (!item) return
  item.answered = false
  delete item.answeredAt
  delete item.submittedValue
  const old = els.items.querySelector(`[data-question-id="${resolvedId}"]`)
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
 * Only answered questions are restored (they're part of the transcript).
 *
 * Unanswered questions are intentionally skipped. The server's question
 * registry is ephemeral (in-memory, workspace-scoped). On reconnect the
 * server does not have pending questions — so the extension should not
 * show them either. This prevents the "question exists in UI but server
 * returns NotFoundError" mismatch.
 */
export function repopulateFromMessages(sessionId: string, messages: Array<{ id: string; timestamp?: number; blocks: Array<{ type: string; toolCallId?: string; id?: string; requestID?: string; answered?: boolean; answer?: string; answerSource?: string; groups?: unknown[] }> }>): void {
  if (!els) return
  for (const msg of messages) {
    if (!msg.blocks) continue
    for (const block of msg.blocks) {
      // Only repopulate answered questions (transcript record).
      // Unanswered questions are ephemeral — the server won't have them
      // after reconnect, so showing them would be broken UX.
      if (block.type === "question" && block.answered) {
        const toolCallId = block.toolCallId || block.id || ""
        if (!state.items.has(toolCallId)) {
          addQuestion(block as any, msg.id, sessionId)
        }
      }
    }
  }
  setActiveSession(sessionId)
}

export function clearAllQuestions(): void {
  if (!els) return
  for (const key of state.items.keys()) clearStalenessTimer(key)
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
    clearStalenessTimer(key)
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

/** Alias for getBarItem — used by tests to access item state. */
export function getQuestionItem(toolCallId: string): QuestionBarItem | undefined {
  return state.items.get(toolCallId)
}

/**
 * B10: Mark a question as stale (likely expired on the server). Shows a
 * warning banner on the question card with a "Continue without answering"
 * button that lets the user dismiss the question and let the model proceed.
 *
 * No-op for answered questions or unknown toolCallIds.
 */
export function markStale(toolCallId: string): void {
  if (!els) return
  const item = state.items.get(toolCallId)
  if (!item || item.answered) return

  const el = els.items.querySelector(`[data-question-id="${toolCallId}"]`)
  if (!el) return

  // Don't double-add the warning
  if (el.querySelector(".question-bar-stale-warning")) return

  const warning = document.createElement("div")
  warning.className = "question-bar-stale-warning"
  warning.setAttribute("role", "alert")

  const icon = document.createElement("span")
  icon.className = "question-bar-stale-icon"
  icon.textContent = "\u26A0\uFE0F "
  warning.appendChild(icon)

  const text = document.createElement("span")
  text.textContent = "This question may have expired on the server."
  warning.appendChild(text)

  const continueBtn = document.createElement("button")
  continueBtn.type = "button"
  continueBtn.className = "question-bar-continue-btn"
  continueBtn.textContent = "Continue without answering"
  continueBtn.setAttribute("aria-label", "Continue without answering this question")
  continueBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    if (item.answered || !state.postMessage) return
    // Post the skip answer to the host first, then mark locally.
    // markQuestionAnswered is the single source of truth for answered state.
    state.postMessage({
      type: "question_answer",
      sessionId: item.sessionId,
      toolCallId: item.toolCallId,
      requestID: item.requestID,
      originSessionId: item.originSessionId,
      messageId: item.messageId,
      value: "Continue without answering",
      source: "skip",
    })
    markQuestionAnswered(item.toolCallId, "Continue without answering")
  })
  warning.appendChild(continueBtn)

  el.appendChild(warning)
  diag(`markStale: ${toolCallId} — showed staleness warning`)
}

/** Check if a specific question has been registered in the bar's internal state
 *  (whether or not it's currently rendered in the DOM). Used by the inline
 *  renderer to decide whether the inline fallback should activate.
 *  Resolves all ID variants (part ID, call ID, request ID). */
export function hasQuestionInState(toolCallId: string): boolean {
  if (state.items.has(toolCallId)) return true
  for (const item of state.items.values()) {
    if (item.requestID === toolCallId) return true
  }
  return false
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
    if (item.cardReady.size > 0) return true
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

  const totalCards = item.groups.length
  const showCarousel = totalCards > 1

  if (showCarousel) {
    renderCarousel(wrapper, item)
  } else {
    renderSingleCard(wrapper, item, 0)
  }

  if (item.answered) {
    const badge = document.createElement("div")
    badge.className = "question-bar-answered-badge"
    badge.textContent = "Answered"
    wrapper.appendChild(badge)
  }

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
        originSessionId: item.originSessionId,
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

function renderCarousel(wrapper: HTMLElement, item: QuestionBarItem): void {
  const total = item.groups.length

  const carousel = document.createElement("div")
  carousel.className = "qbar-carousel"

  const nav = document.createElement("div")
  nav.className = "qbar-carousel-nav"

  const prevBtn = document.createElement("button")
  prevBtn.type = "button"
  prevBtn.className = "qbar-carousel-arrow qbar-carousel-prev"
  prevBtn.textContent = "\u2039"
  prevBtn.setAttribute("aria-label", "Previous question")
  prevBtn.disabled = item._carouselIdx <= 0

  const nextBtn = document.createElement("button")
  nextBtn.type = "button"
  nextBtn.className = "qbar-carousel-arrow qbar-carousel-next"
  nextBtn.textContent = "\u203A"
  nextBtn.setAttribute("aria-label", "Next question")
  nextBtn.disabled = item._carouselIdx >= total - 1

  const progress = document.createElement("span")
  progress.className = "qbar-carousel-progress"

  const answeredCount = () => {
    let count = 0
    for (let i = 0; i < total; i++) {
      const sel = item.selections.get(i)
      if (sel && sel.size > 0) count++
      else if (item.cardReady.has(i)) count++
    }
    return count
  }

  const updateProgress = () => {
    const answered = answeredCount()
    progress.textContent = `Question ${item._carouselIdx + 1} of ${total} \u2022 ${answered}/${total} answered`
    prevBtn.disabled = item._carouselIdx <= 0
    nextBtn.disabled = item._carouselIdx >= total - 1
  }
  updateProgress()

  nav.appendChild(prevBtn)
  nav.appendChild(progress)
  nav.appendChild(nextBtn)
  carousel.appendChild(nav)

  const cardContainer = document.createElement("div")
  cardContainer.className = "qbar-carousel-cards"

  const changeCard = (newIdx: number) => {
    item._carouselIdx = newIdx
    const oldCard = cardContainer.querySelector(".qbar-carousel-card")
    if (oldCard) oldCard.remove()
    const card = buildCardElement(item, newIdx, () => {
      // Auto-advance to next card after selection
      if (item._carouselIdx < total - 1) {
        changeCard(item._carouselIdx + 1)
      }
    })
    cardContainer.appendChild(card)
    updateProgress()
  }

  prevBtn.addEventListener("click", () => {
    if (item._carouselIdx > 0) changeCard(item._carouselIdx - 1)
  })
  nextBtn.addEventListener("click", () => {
    if (item._carouselIdx < total - 1) changeCard(item._carouselIdx + 1)
  })

  changeCard(item._carouselIdx)
  carousel.appendChild(cardContainer)

  wrapper.appendChild(carousel)
}

function renderSingleCard(wrapper: HTMLElement, item: QuestionBarItem, gi: number): void {
  const card = buildCardElement(item, gi)
  wrapper.appendChild(card)
}

function buildCardElement(item: QuestionBarItem, gi: number, onAdvance?: () => void): HTMLElement {
  const group = item.groups[gi]!
  const isReady = item.cardReady.has(gi)

  const card = document.createElement("div")
  card.className = "qbar-carousel-card"
  card.dataset.groupIndex = String(gi)
  if (isReady) card.classList.add("qbar-card--ready")

  if (group.header) {
    const hdr = document.createElement("div")
    hdr.className = "question-bar-section-header"
    hdr.textContent = group.header
    card.appendChild(hdr)
  }

  if (group.question) {
    const q = document.createElement("div")
    q.className = "question-bar-question"
    q.textContent = group.question
    card.appendChild(q)
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
          // Auto-advance to next card after single-select
          if (onAdvance) {
            setTimeout(onAdvance, 150)
          }
        }
        item.selections.set(gi, currentSel)
        updateSubmitState()
      })

      optionsRow.appendChild(btn)
    }
    card.appendChild(optionsRow)
  }

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
    if (item.answered || isReady) ta.disabled = true
    card.appendChild(ta)
  }

  if (isReady) {
    const badge = document.createElement("span")
    badge.className = "qbar-card-ready-badge"
    badge.textContent = "\u2713 Ready"
    card.appendChild(badge)
  } else if (!item.answered) {
    const readyBtn = document.createElement("button")
    readyBtn.type = "button"
    readyBtn.className = "qbar-card-ready-btn"
    readyBtn.textContent = "Ready"
    readyBtn.setAttribute("aria-label", "Mark this question as ready")
    readyBtn.addEventListener("click", () => {
      if (item.answered) return
      item.cardReady.add(gi)
      updateSubmitState()
      // Auto-advance to next card after clicking Ready
      if (onAdvance) {
        setTimeout(onAdvance, 150)
      } else {
        // Re-render just this card within the carousel (for non-carousel mode)
        const container = card.closest(".qbar-carousel-cards")
        if (container) {
          const oldCard = container.querySelector(".qbar-carousel-card")
          if (oldCard) {
            const freshCard = buildCardElement(item, gi)
            oldCard.replaceWith(freshCard)
          }
        }
      }
    })
    card.appendChild(readyBtn)
  }

  return card
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
    if (item.answered || !isActiveItem(item)) continue

    const parts: string[] = []
    const structuredAnswers: string[][] = []
    let hasSelection = false

    // When per-card Ready was used, only submit groups the user explicitly
    // marked as ready. Otherwise submit all groups with selections.
    const useReady = item.cardReady.size > 0

    item.groups.forEach((group, gi) => {
      if (useReady && !item.cardReady.has(gi)) {
        structuredAnswers.push([])
        return
      }
      const chosen = Array.from(item.selections.get(gi) ?? [])
      if (chosen.length > 0) {
        hasSelection = true
        const heading = group.header || group.question || `Answer ${gi + 1}`
        parts.push(`${heading}: ${chosen.join(", ")}`)
        structuredAnswers.push(chosen)
      } else {
        structuredAnswers.push([])
      }
    })

    if (useReady && item.cardReady.size > 0) {
      // When card-ready is used, free-text is per-card and included in
      // structuredAnswers per group. Don't append an extra free-text group.
    } else {
      const free = item.freeTextValue.trim()
      if (free) {
        parts.push(free)
        structuredAnswers.push([free])
      }
    }

    const value = parts.join("\n")
    if (!value) continue

    state.postMessage({
      type: "question_answer",
      sessionId: item.sessionId,
      toolCallId: item.toolCallId,
      requestID: item.requestID,
      originSessionId: item.originSessionId,
      messageId: item.messageId,
      value,
      structuredAnswers,
      source: hasSelection ? "option" : "freetext",
    })

    diag(`submitAllAnswers: posting question_answer for ${item.toolCallId} source=${hasSelection ? "option" : "freetext"} valueLen=${value.length}`)
    markQuestionAnswered(item.toolCallId, value)
  }
}
