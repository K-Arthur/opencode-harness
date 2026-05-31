import type { QuestionBlock, QuestionGroup } from "./types"

export interface QuestionBarItem {
  toolCallId: string
  sessionId: string
  messageId: string
  groups: QuestionGroup[]
  allowFreeText: boolean
  selections: Map<number, Set<string>>
  freeTextValue: string
  answered: boolean
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

let els: QuestionBarElements | null = null

export function initQuestionBar(postMessage: (msg: Record<string, unknown>) => void): void {
  const bar = document.getElementById("question-bar")
  const items = document.getElementById("question-bar-items")
  const count = document.getElementById("question-bar-count")
  const submitBtn = document.getElementById("question-bar-submit")
  if (!bar || !items || !count || !submitBtn) return

  els = { bar, items: items as HTMLDivElement, count: count as HTMLSpanElement, submitBtn: submitBtn as HTMLButtonElement }
  state.postMessage = postMessage

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

export function markQuestionAnswered(toolCallId: string): void {
  if (!els) return
  const item = state.items.get(toolCallId)
  if (item) {
    item.answered = true
    const el = els.items.querySelector(`[data-question-id="${toolCallId}"]`)
    if (el) {
      el.classList.add("question-bar-item--answered")
      const answerBadge = document.createElement("div")
      answerBadge.className = "question-bar-answered-badge"
      answerBadge.textContent = "Answered"
      el.appendChild(answerBadge)
    }
  }
  updateSubmitState()
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
  const hasItems = state.items.size > 0
  els.bar.classList.toggle("hidden", !hasItems)
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
    ta.setAttribute("aria-label", "Custom answer")
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

    item.answered = true
    state.postMessage({
      type: "question_answer",
      sessionId: item.sessionId,
      toolCallId: item.toolCallId,
      messageId: item.messageId,
      value,
      source: hasSelection ? "option" : "freetext",
    })

    markQuestionAnswered(item.toolCallId)
  }

  updateSubmitState()

  setTimeout(() => {
    const allAnswered = Array.from(state.items.values()).every((i) => i.answered)
    if (allAnswered) clearAllQuestions()
  }, 1500)
}
