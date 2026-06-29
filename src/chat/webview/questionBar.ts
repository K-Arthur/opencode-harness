import type { QuestionBlock, QuestionGroup } from "./types"
import { REMOVE_SVG, CHECK_SVG, WARNING_SVG } from "./icons"

const log = typeof console !== "undefined" ? console : null
const diag = (msg: string) => log?.info(`[questionBar] ${msg}`)

export interface QuestionBarItem {
  toolCallId: string
  requestID?: string
  sessionId: string
  messageId: string
  groups: QuestionGroup[]
  /** The question text to display when the parsed groups are empty or lack a header. */
  questionText: string
  allowFreeText: boolean
  selections: Map<number, Set<string>>
  /** Per-group custom/free-text answers, keyed by group index. The server's
   *  `question.reply` contract is one answer array per question group, so a
   *  group's custom text must land in THAT group's slot — not appended as a
   *  phantom extra group (which inflates answers.length past questions.length
   *  and makes the server drop/degrade the reply). A single-group/zero-group
   *  question keeps its text at key 0. */
  freeTextValues: Map<number, string>
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

/** Guard against duplicate submitAllAnswers calls — if the submit button
 *  has multiple listeners (re-init) or the user double-clicks, only the
 *  first call iterates; subsequent calls are no-ops. Reset when all items
 *  are answered or removed. */
let _submitting = false

/** Guard against duplicate initQuestionBar — prevents accumulating click
 *  listeners on the submit button across webview re-inits. */
let _initialized = false

/** B10: Staleness threshold — questions older than this are auto-flagged. */
const STALE_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes

let _activeSessionId = ""

/**
 * IDs (toolCallId / id / requestID) of questions the user has already dealt
 * with (answered or dismissed). A late re-emit — server replay, a resume
 * stream backfilling its blocks, or the dual tool_start/question.asked feed
 * arriving out of order — must NOT resurrect a fresh interactive card for a
 * question that is already retired. Without this guard, every recovery resend
 * could re-stack the same question, which is exactly the "duplicates piling
 * up" failure mode. Bounded so it can't grow without limit in a long session.
 */
const _retiredIds = new Set<string>()
const RETIRED_CAP = 200

function retire(...ids: Array<string | undefined>): void {
  for (const id of ids) {
    if (typeof id === "string" && id.length > 0) _retiredIds.add(id)
  }
  if (_retiredIds.size > RETIRED_CAP) {
    const excess = _retiredIds.size - RETIRED_CAP
    let i = 0
    for (const id of _retiredIds) {
      if (i++ >= excess) break
      _retiredIds.delete(id)
    }
  }
}

function unretire(...ids: Array<string | undefined>): void {
  for (const id of ids) {
    if (typeof id === "string" && id.length > 0) _retiredIds.delete(id)
  }
}

function blockIds(block: QuestionBlock): string[] {
  return [block.toolCallId, block.id, block.requestID].filter(
    (x): x is string => typeof x === "string" && x.length > 0,
  )
}

function isRetiredBlock(block: QuestionBlock): boolean {
  return blockIds(block).some((id) => _retiredIds.has(id))
}

/**
 * Resolve the existing bar item a freshly-arrived question block belongs to,
 * if any. Two independent feeds describe the SAME question with DIFFERENT ids:
 * the live-stream `tool_start` (part-scoped id, no requestID) and the
 * `question.asked` SSE event (call id + requestID). Keying only on toolCallId
 * (the old behaviour) stacked a duplicate card whenever the two ids differed.
 * This resolver merges by any shared id in either direction, and — when one
 * side still lacks a requestID — adopts the single pending card for the
 * session so the two feeds collapse into one regardless of arrival order.
 */
function findMergeTarget(block: QuestionBlock, envelopeSessionId?: string): QuestionBarItem | undefined {
  const ids = blockIds(block)
  const sid = block.sessionId || envelopeSessionId || _activeSessionId
  // Merges are always within one session — a server requestID/callID is unique
  // per session, and two distinct tabs must never collapse into one card. An
  // empty item.sessionId is treated as a wildcard (legacy/streaming items that
  // get their session repaired by a later block).
  const inSession = (i: QuestionBarItem) => !sid || i.sessionId === sid || i.sessionId === ""
  for (const item of state.items.values()) {
    if (!inSession(item)) continue
    if (ids.includes(item.toolCallId)) return item
    if (item.requestID && ids.includes(item.requestID)) return item
  }
  // Dual-feed collision: collapse into the single pending card for this
  // session when either side is missing the requestID (i.e. the streaming
  // placeholder ↔ SSE event pairing). Two genuinely-distinct questions each
  // carry their own requestID, so neither condition fires and both survive.
  const pending = Array.from(state.items.values()).filter((i) => !i.answered && inSession(i))
  if (pending.length === 1) {
    const cand = pending[0]!
    if (!block.requestID || !cand.requestID) return cand
  }
  return undefined
}

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
  _retiredIds.clear()
  _activeSessionId = ""
  _submitting = false
  els.items.innerHTML = ""
  updateVisibility()
  updateSubmitState()

  // Guard against duplicate listeners on re-init: replace the submit button
  // with a clone to drop all old listeners, then attach the fresh one.
  if (_initialized) {
    const freshBtn = submitBtn.cloneNode(true) as HTMLButtonElement
    submitBtn.replaceWith(freshBtn)
    els.submitBtn = freshBtn
  }
  _initialized = true
  els.submitBtn.addEventListener("click", () => submitAllAnswers())
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
  // A late re-emit of a question the user already answered/dismissed must not
  // spawn OR mutate a card — checked BEFORE the merge resolver so a retired
  // replay can't be adopted into an unrelated pending card. Answered blocks
  // (transcript records) pass through so reload/repopulate can still render the
  // answered state.
  if (isRetiredBlock(block) && block.answered !== true) {
    diag(`addQuestion: skipped retired question ${toolCallId}`)
    return
  }
  // Merge into the existing card this block belongs to (handles the
  // tool_start ↔ question.asked id mismatch) instead of stacking a duplicate.
  const mergeTarget = findMergeTarget(block, envelopeSessionId)
  if (mergeTarget) {
    updateQuestion(mergeTarget.toolCallId, block)
    return
  }

  // Do not create an empty question bar item. Empty tool-start payloads are
  // common (the server sends the question tool before its args), and without
  // this guard the bar would render a blank "Question from model" card that
  // the user cannot answer and that never dismisses.
  const hasContent = (block.groups ?? []).length > 0
    || (block as Record<string, unknown>).text as string
    || (block as Record<string, unknown>).question as string
    || (block as Record<string, unknown>).options as string[]
  if (!hasContent) {
    diag(`addQuestion: skipped empty question ${toolCallId}; waiting for content update`)
    return
  }

  const item: QuestionBarItem = {
    toolCallId,
    requestID: block.requestID,
    sessionId: block.sessionId || envelopeSessionId || _activeSessionId,
    messageId,
    groups: block.groups ?? [],
    questionText: (block as Record<string, unknown>).text as string
      || (block as Record<string, unknown>).question as string
      || "",
    allowFreeText: block.allowFreeText !== false,
    selections: new Map(),
    freeTextValues: new Map(),
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
  refreshQuestionVisibility()
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
  const incomingGroups = block.groups ?? []
  // Never let a partial/empty refresh wipe content we already hold. The
  // streaming `tool_start` feed and the `question.asked` SSE feed describe one
  // question; whichever lands second may carry empty groups (the placeholder
  // before its args finished streaming). Merging that in must not blank a
  // fuller card — mirrors StreamCoordinator.applyQuestionArgs' same guard.
  if (incomingGroups.length > 0) item.groups = incomingGroups
  item.questionText = (block as Record<string, unknown>).text as string
    || (block as Record<string, unknown>).question as string
    || item.questionText
  // A refreshed block copy may omit requestID (e.g. server echo without the
  // v2 field) — never wipe one we already hold, the reply path needs it.
  item.requestID = block.requestID ?? item.requestID
  // Only let an incoming block flip allowFreeText when it actually carries
  // question content; a bare placeholder must not toggle it off the default.
  if (incomingGroups.length > 0) item.allowFreeText = block.allowFreeText !== false
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
  const removed = state.items.get(key)
  state.items.delete(key)
  if (removed) retire(removed.toolCallId, removed.requestID)
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
    // Retire the question so a late re-emit can't resurrect an interactive
    // card after the user has answered it (the "won't dismiss" / "piles up"
    // failure mode). Cleared again only by an explicit unmark (retry).
    retire(item.toolCallId, item.requestID)
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
  refreshQuestionVisibility()
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
  // The optimistic answer was rolled back (transient reply failure → user may
  // retry), so the question is live again: un-retire it.
  unretire(item.toolCallId, item.requestID)
  delete item.answeredAt
  delete item.submittedValue
  const old = els.items.querySelector(`[data-question-id="${resolvedId}"]`)
  if (old) {
    old.replaceWith(buildBarItemElement(item))
  } else {
    renderBarItem(item)
  }
  refreshQuestionVisibility()
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
  refreshQuestionVisibility()
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
export function repopulateFromMessages(sessionId: string, messages: Array<{ id?: string; timestamp?: number; blocks: Array<{ type: string; toolCallId?: string; id?: string; requestID?: string; answered?: boolean; answer?: string; answerSource?: string; groups?: unknown[]; text?: string; allowFreeText?: boolean }> }>): void {
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
          addQuestion(block as unknown as QuestionBlock, msg.id || "", sessionId)
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
  // Zero-emoji policy (CONVENTIONS.md): SVG icon, not the \u26A0\uFE0F emoji.
  icon.innerHTML = WARNING_SVG
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
    const hasFreeText = Array.from(item.freeTextValues.values()).some((v) => v.trim().length > 0)
    return hasSelection || hasFreeText
  })
  els.submitBtn.disabled = !hasAnySelection
}

function buildBarItemElement(item: QuestionBarItem): HTMLElement {
  const wrapper = document.createElement("div")
  wrapper.className = "question-bar-item"
  wrapper.setAttribute("data-question-id", item.toolCallId)
  if (item.answered) wrapper.classList.add("question-bar-item--answered")

  // When groups are empty but the block carries question text, render it as
  // the card header so the user knows what they are answering.
  if (item.questionText && item.groups.length === 0) {
    const questionText = document.createElement("div")
    questionText.className = "question-bar-question"
    questionText.textContent = item.questionText
    wrapper.appendChild(questionText)
  }

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
    progress.textContent = `Question ${item._carouselIdx + 1} of ${total} | ${answered}/${total} answered`
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
  const group = item.groups[gi] ?? { question: "", options: [], multiSelect: false }
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
    ta.value = item.freeTextValues.get(gi) ?? ""
    ta.addEventListener("input", () => {
      item.freeTextValues.set(gi, ta.value)
      updateSubmitState()
    })
    if (item.answered || isReady) ta.disabled = true
    card.appendChild(ta)
  }

  if (isReady) {
    const badge = document.createElement("span")
    badge.className = "qbar-card-ready-badge"
    badge.innerHTML = CHECK_SVG
    badge.appendChild(document.createTextNode(" Ready"))
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
  els.items.appendChild(item.answered ? renderAnsweredItem(item) : buildBarItemElement(item))
}

/**
 * Show only the first active unanswered question at a time. Answered items
 * remain visible during their auto-dismiss window. Remaining unanswered items
 * are queued; they surface automatically once the current question is answered.
 */
function refreshQuestionVisibility(): void {
  if (!els) return
  const activeUnanswered = Array.from(els.items.querySelectorAll(".question-bar-item:not(.question-bar-item--answered)"))
  activeUnanswered.forEach((el, idx) => {
    el.classList.toggle("question-bar-item--queued", idx > 0)
  })
  const first = activeUnanswered[0]
  if (first) {
    first.classList.remove("question-bar-item--queued")
  }
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
  status.innerHTML = CHECK_SVG
  status.appendChild(document.createTextNode(" Answered"))
  header.appendChild(status)

  const dismiss = document.createElement("button")
  dismiss.type = "button"
  dismiss.className = "question-bar-dismiss-btn"
  dismiss.setAttribute("aria-label", "Dismiss answered question")
  dismiss.title = "Dismiss"
  dismiss.innerHTML = REMOVE_SVG
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
  if (_submitting) return
  _submitting = true
  try {
    for (const item of state.items.values()) {
      if (item.answered || !isActiveItem(item)) continue

      const parts: string[] = []
      const structuredAnswers: string[][] = []
      let hasSelection = false

      // When per-card Ready was used, only submit groups the user explicitly
      // marked as ready. Otherwise submit all groups with selections/text.
      const useReady = item.cardReady.size > 0

      if (item.groups.length === 0) {
        // Free-text-only question (no option groups): the single implicit
        // group's answer IS the typed text. Keyed at index 0 by the renderer.
        const free = (item.freeTextValues.get(0) ?? "").trim()
        if (free) {
          parts.push(free)
          structuredAnswers.push([free])
        }
      } else {
        item.groups.forEach((group, gi) => {
          if (useReady && !item.cardReady.has(gi)) {
            structuredAnswers.push([])
            return
          }
          const chosen = Array.from(item.selections.get(gi) ?? [])
          const free = (item.freeTextValues.get(gi) ?? "").trim()
          // Merge selected labels AND this group's custom text into ONE slot,
          // so structuredAnswers[gi] maps 1:1 to questions[gi] — the server's
          // `answers` contract. Appending free text as a phantom extra group
          // (the old behaviour) made answers.length exceed questions.length,
          // which the server could not map back → custom answers were dropped.
          const slot = free ? [...chosen, free] : [...chosen]
          if (chosen.length > 0) {
            hasSelection = true
            const heading = group.header || group.question || `Answer ${gi + 1}`
            parts.push(`${heading}: ${chosen.join(", ")}${free ? ` — ${free}` : ""}`)
          } else if (free) {
            parts.push(free)
          }
          structuredAnswers.push(slot)
        })
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
  } finally {
    _submitting = false
  }
}
