import type { WebviewState } from "./types"
import { createPromptQueue, type PromptQueue, type QueueItem } from "./queue"
import { REMOVE_SVG } from "./icons"

export interface QueueRendererDeps {
  els: {
    inputArea: HTMLDivElement
    inputWrapper: HTMLDivElement
  }
  vscode: {
    getState: <T>() => T | undefined
    setState: (state: WebviewState) => void
    postMessage: (msg: Record<string, unknown>) => void
  }
  stateManager: {
    getActiveSession: () => { id: string; isStreaming?: boolean; isServerStreaming?: boolean } | null
  }
  promptQueues: Map<string, PromptQueue>
}

export function createWebviewId(prefix: string): string {
  const randomUUID = (globalThis.crypto as { randomUUID?: () => string } | undefined)?.randomUUID
  const id = randomUUID
    ? randomUUID.call(globalThis.crypto)
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}-${id}`
}

export const SEND_NOW_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>'

export const REORDER_HANDLE_SVG = '<svg viewBox="0 0 24 24" width="12" height="16" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>'

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`
  return String(n)
}

export interface QueueRendererAPI {
  renderQueue: (tabId: string) => void
  wireChipReorderHandlers: (chip: HTMLElement, itemId: string, tabId: string, queue: PromptQueue) => void
  updateQueueSendButton: () => void
  persistQueues: () => void
  restoreQueues: () => void
}

let activeDescendantId = ""

export function createQueueRenderer(deps: QueueRendererDeps): QueueRendererAPI {
  const { els, vscode, stateManager, promptQueues } = deps

  function postQueueAction(type: string, sessionId: string, extra: Record<string, unknown> = {}): void {
    vscode.postMessage({ type, sessionId, ...extra })
  }

  function persistQueues() {
    const state = vscode.getState<WebviewState>()
    if (!state) return
    const snapshot: Record<string, QueueItem[]> = {}
    for (const [sid, q] of promptQueues.entries()) {
      const items = q.persist().map((i: QueueItem) => {
        if (i.state === "sending") return { ...i, state: "queued" as const }
        return i
      }).filter((i: QueueItem) => i.state === "queued" || i.state === "failed")
      if (items.length > 0) snapshot[sid] = items
    }
    vscode.setState({ ...state, queues: snapshot } as WebviewState)
  }

  function restoreQueues() {
    const state = vscode.getState() as { queues?: Record<string, QueueItem[]> } | null | undefined
    const snapshot = state?.queues
    if (!snapshot) return
    for (const [sid, items] of Object.entries(snapshot)) {
      if (!Array.isArray(items) || items.length === 0) continue
      const q = createPromptQueue()
      q.restore(items)
      promptQueues.set(sid, q)
    }
  }

  function findNextFocusable(items: QueueItem[], currentIdx: number, direction: 1 | -1): number {
    let idx = currentIdx + direction
    while (idx >= 0 && idx < items.length) {
      if (items[idx] && (items[idx]!.state === "queued" || items[idx]!.state === "failed")) return idx
      idx += direction
    }
    return -1
  }

  function getActiveSessionId(): string | null {
    const active = stateManager.getActiveSession()
    return active ? active.id : null
  }

  function setupContainerKeyboardNav(container: HTMLElement, tabId: string, queue: PromptQueue): void {
    container.addEventListener("keydown", (e) => {
      const items = queue.getItems()
      let currentIdx = -1
      if (activeDescendantId) {
        currentIdx = items.findIndex(i => i.id === activeDescendantId)
      }
      if (currentIdx === -1) {
        currentIdx = items.findIndex(i => i.state === "queued" || i.state === "failed")
      }

      if (e.key === "ArrowDown") {
        e.preventDefault()
        const next = findNextFocusable(items, currentIdx, 1)
        if (next >= 0) {
          const chip = container.querySelector<HTMLElement>(`.queue-chip[data-queue-id="${items[next]!.id}"]`)
          if (chip) {
            activeDescendantId = items[next]!.id
            container.setAttribute("aria-activedescendant", activeDescendantId)
            chip.scrollIntoView({ block: "nearest" })
          }
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        const prev = findNextFocusable(items, currentIdx, -1)
        if (prev >= 0) {
          const chip = container.querySelector<HTMLElement>(`.queue-chip[data-queue-id="${items[prev]!.id}"]`)
          if (chip) {
            activeDescendantId = items[prev]!.id
            container.setAttribute("aria-activedescendant", activeDescendantId)
            chip.scrollIntoView({ block: "nearest" })
          }
        }
      } else if (e.key === "Home") {
        e.preventDefault()
        const first = findNextFocusable(items, -1, 1)
        if (first >= 0) {
          const chip = container.querySelector<HTMLElement>(`.queue-chip[data-queue-id="${items[first]!.id}"]`)
          if (chip) {
            activeDescendantId = items[first]!.id
            container.setAttribute("aria-activedescendant", activeDescendantId)
            chip.scrollIntoView({ block: "nearest" })
          }
        }
      } else if (e.key === "End") {
        e.preventDefault()
        const last = findNextFocusable(items, items.length, -1)
        if (last >= 0) {
          const chip = container.querySelector<HTMLElement>(`.queue-chip[data-queue-id="${items[last]!.id}"]`)
          if (chip) {
            activeDescendantId = items[last]!.id
            container.setAttribute("aria-activedescendant", activeDescendantId)
            chip.scrollIntoView({ block: "nearest" })
          }
        }
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (currentIdx >= 0) {
          e.preventDefault()
          postQueueAction("remove_from_queue", tabId, { itemId: items[currentIdx]!.id })
          queue.remove(items[currentIdx]!.id)
          persistQueues()
          renderQueue(tabId)
        }
      } else if (e.key === "F2") {
        if (currentIdx >= 0) {
          const item = items[currentIdx]
          if (item && item.state === "queued") {
            e.preventDefault()
            const chip = container.querySelector<HTMLElement>(`.queue-chip[data-queue-id="${item.id}"]`)
            if (chip) {
              const textSpan = chip.querySelector<HTMLElement>(".queue-chip-text")
              if (textSpan) textSpan.click()
            }
          }
        }
      } else if (e.key === "Enter") {
        e.preventDefault()
        if (currentIdx >= 0) {
          const item = items[currentIdx]
          if (item && item.state === "queued") {
            const sendBtn = container.querySelector<HTMLButtonElement>(`.queue-chip[data-queue-id="${item.id}"] .queue-chip-send`)
            if (sendBtn) sendBtn.click()
          }
        }
      }
    })

    container.addEventListener("focus", () => {
      if (!activeDescendantId) {
        const items = queue.getItems()
        const first = items.findIndex(i => i.state === "queued" || i.state === "failed")
        if (first >= 0) {
          activeDescendantId = items[first]!.id
          container.setAttribute("aria-activedescendant", activeDescendantId)
        }
      }
    })
  }

  function renderQueue(tabId: string) {
    const queue = promptQueues.get(tabId)
    const container = els.inputArea.querySelector(".prompt-queue") as HTMLElement | null
    if (!queue || queue.getItems().length === 0) {
      if (container) container.remove()
      updateQueueSendButton()
      return
    }
    let queueContainer = container
    if (!queueContainer) {
      queueContainer = document.createElement("div")
      queueContainer.className = "prompt-queue"
      queueContainer.setAttribute("role", "listbox")
      queueContainer.setAttribute("aria-label", "Queued prompts. Arrow keys to navigate, Delete to remove, F2 to edit, Alt+Arrow to reorder, Enter to send now.")
      queueContainer.tabIndex = 0
      els.inputArea.insertBefore(queueContainer, els.inputWrapper)
      setupContainerKeyboardNav(queueContainer, tabId, queue)
    }
    queueContainer.replaceChildren()
    const items = queue.getItems()
    const queuedCount = items.filter((i: QueueItem) => i.state === "queued").length
    const totalTokens = queue.getTotalEstimatedTokens()

    const headerRow = document.createElement("div")
    headerRow.className = "queue-header"
    const countLabel = document.createElement("span")
    countLabel.className = "queue-count"
    countLabel.textContent = `${items.length} queued`
    headerRow.appendChild(countLabel)
    if (totalTokens > 0) {
      const tokenLabel = document.createElement("span")
      tokenLabel.className = "queue-tokens"
      tokenLabel.textContent = `\u223c${formatTokenCount(totalTokens)} tokens`
      tokenLabel.title = `Estimated total token cost for all queued prompts (~${totalTokens})`
      headerRow.appendChild(tokenLabel)
    }
    if (queuedCount > 1) {
      const clearAllBtn = document.createElement("button")
      clearAllBtn.className = "queue-clear-all"
      clearAllBtn.textContent = "Clear all"
      clearAllBtn.setAttribute("aria-label", `Clear ${queuedCount} queued prompts`)
      clearAllBtn.addEventListener("click", () => {
        for (const item of items) {
          if (item.state === "queued") {
            postQueueAction("remove_from_queue", tabId, { itemId: item.id })
            queue.remove(item.id)
          }
        }
        persistQueues()
        renderQueue(tabId)
      })
      headerRow.appendChild(clearAllBtn)
    }
    queueContainer.appendChild(headerRow)

    let isActiveSet = false
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!
      const chip = document.createElement("div")
      chip.className = `queue-chip queue-chip--${item.state}${item.isSteerPrompt ? " queue-chip--steer" : ""}`
      chip.dataset.queueId = item.id
      chip.setAttribute("role", "option")
      chip.setAttribute("aria-selected", "false")
      chip.id = `queue-chip-${item.id}`

      const isMovable = item.state === "queued" || item.state === "failed"
      if (isMovable) {
        chip.draggable = true
        chip.setAttribute("aria-grabbed", "false")
        chip.setAttribute("aria-label",
          `Queued prompt ${i + 1} of ${items.length}: ${item.text.slice(0, 60)}`)

        const handle = document.createElement("span")
        handle.className = "queue-chip-handle"
        handle.setAttribute("aria-hidden", "true")
        handle.innerHTML = REORDER_HANDLE_SVG
        chip.appendChild(handle)
      }

      const text = document.createElement("span")
      text.className = "queue-chip-text"
      text.textContent = item.text.length > 60 ? item.text.slice(0, 60) + "\u2026" : item.text
      text.title = item.text
      chip.appendChild(text)

      if (item.attachments && item.attachments.length > 0) {
        const attBadge = document.createElement("span")
        attBadge.className = "queue-chip-att"
        attBadge.textContent = `+${item.attachments.length}`
        attBadge.title = `${item.attachments.length} image attachment(s)`
        chip.appendChild(attBadge)
      }

      if ((item.estimatedTokens ?? 0) > 0 && item.state === "queued") {
        const tokBadge = document.createElement("span")
        tokBadge.className = "queue-chip-tokens"
        tokBadge.textContent = `\u223c${formatTokenCount(item.estimatedTokens!)}`
        tokBadge.title = `~${item.estimatedTokens} estimated tokens`
        chip.appendChild(tokBadge)
      }

      const badge = document.createElement("span")
      badge.className = "queue-chip-state"
      const stateLabels: Record<string, string> = { queued: "Q", sending: "Sending", streaming: "Active", completed: "Done", failed: "Error" }
      badge.textContent = stateLabels[item.state] || item.state
      chip.appendChild(badge)

      if (item.state === "queued") {
        // Send Now button — bypasses queue ordering, sends immediately
        const sendBtn = document.createElement("button")
        sendBtn.className = "queue-chip-send icon-btn"
        sendBtn.setAttribute("aria-label", `Send "${item.text.slice(0, 40)}" now`)
        sendBtn.innerHTML = SEND_NOW_SVG
        sendBtn.addEventListener("click", (e) => {
          e.stopPropagation()
          // Host-authoritative: do NOT remove locally. The host may defer
          // (busy tab → item moved to front, sends at stream end) and always
          // answers with a queue_state that reconciles this view. An
          // optimistic removal here made the chip vanish while the prompt
          // stayed queued host-side — it then ghost-sent on the next drain.
          postQueueAction("send_queue_item", tabId, { itemId: item.id })
        })
        chip.appendChild(sendBtn)

        text.addEventListener("click", () => {
          const input = document.createElement("input")
          input.className = "queue-chip-input"
          input.type = "text"
          input.value = item.text
          input.setAttribute("aria-label", "Edit queued prompt")
          chip.replaceChild(input, text)
          input.focus()
          input.select()
          const save = () => {
            const newText = input.value.trim()
            if (newText) {
              queue.edit(item.id, newText)
              postQueueAction("edit_queue_item", tabId, { itemId: item.id, text: newText })
              persistQueues()
              renderQueue(tabId)
            }
          }
          input.addEventListener("blur", save)
          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); input.blur() }
            if (e.key === "Escape") { e.preventDefault(); renderQueue(tabId) }
          })
        })

        const removeBtn = document.createElement("button")
        removeBtn.className = "queue-chip-remove icon-btn"
        removeBtn.setAttribute("aria-label", `Remove queued prompt: ${item.text.slice(0, 40)}`)
        removeBtn.innerHTML = REMOVE_SVG
        removeBtn.addEventListener("click", (e) => {
          e.stopPropagation()
          postQueueAction("remove_from_queue", tabId, { itemId: item.id })
          queue.remove(item.id)
          persistQueues()
          renderQueue(tabId)
        })
        chip.appendChild(removeBtn)
      }

      if (item.state === "failed") {
        const retryBtn = document.createElement("button")
        retryBtn.className = "queue-chip-retry icon-btn"
        retryBtn.setAttribute("aria-label", "Retry failed prompt")
        retryBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>'
        retryBtn.addEventListener("click", (e) => {
          e.stopPropagation()
          item.state = "queued"
          postQueueAction("retry_queue_item", tabId, { itemId: item.id })
          persistQueues()
          renderQueue(tabId)
        })
        chip.appendChild(retryBtn)

        const removeBtn2 = document.createElement("button")
        removeBtn2.className = "queue-chip-remove icon-btn"
        removeBtn2.setAttribute("aria-label", `Remove failed prompt: ${item.text.slice(0, 40)}`)
        removeBtn2.innerHTML = REMOVE_SVG
        removeBtn2.addEventListener("click", (e) => {
          e.stopPropagation()
          postQueueAction("remove_from_queue", tabId, { itemId: item.id })
          queue.remove(item.id)
          persistQueues()
          renderQueue(tabId)
        })
        chip.appendChild(removeBtn2)
      }

      if (isMovable) {
        wireChipReorderHandlers(chip, item.id, tabId, queue)
      }
      queueContainer.appendChild(chip)

      if (!isActiveSet) {
        isActiveSet = true
        if (!activeDescendantId || !items.find(i => i.id === activeDescendantId)) {
          activeDescendantId = item.id
          queueContainer.setAttribute("aria-activedescendant", activeDescendantId)
        }
      }
    }
    updateQueueSendButton()
  }

  function wireChipReorderHandlers(
    chip: HTMLElement,
    itemId: string,
    tabId: string,
    queue: PromptQueue,
  ) {
    function indexOf(id: string): number {
      return queue.getItems().findIndex((i: QueueItem) => i.id === id)
    }

    function clearAllDropMarkers() {
      const container = chip.parentElement
      if (!container) return
      for (const el of Array.from(container.querySelectorAll(".queue-chip"))) {
        el.classList.remove("queue-chip--drop-before", "queue-chip--drop-after")
      }
    }

    chip.addEventListener("dragstart", (e) => {
      const dt = e.dataTransfer
      if (!dt) return
      dt.effectAllowed = "move"
      dt.setData("application/x-queue-item", itemId)
      dt.setData("text/plain", itemId)
      chip.classList.add("queue-chip--dragging")
      chip.setAttribute("aria-grabbed", "true")
    })

    chip.addEventListener("dragend", () => {
      chip.classList.remove("queue-chip--dragging")
      chip.setAttribute("aria-grabbed", "false")
      clearAllDropMarkers()
    })

    chip.addEventListener("dragover", (e) => {
      const dt = e.dataTransfer
      if (!dt) return
      if (!Array.from(dt.types).includes("application/x-queue-item")) return
      e.preventDefault()
      dt.dropEffect = "move"
      clearAllDropMarkers()
      const rect = chip.getBoundingClientRect()
      const before = e.clientY < rect.top + rect.height / 2
      chip.classList.add(before ? "queue-chip--drop-before" : "queue-chip--drop-after")
    })

    chip.addEventListener("dragleave", () => {
      chip.classList.remove("queue-chip--drop-before", "queue-chip--drop-after")
    })

    chip.addEventListener("drop", (e) => {
      const dt = e.dataTransfer
      if (!dt) return
      const sourceId = dt.getData("application/x-queue-item")
      if (!sourceId || sourceId === itemId) { clearAllDropMarkers(); return }
      e.preventDefault()
      const fromIdx = indexOf(sourceId)
      let toIdx = indexOf(itemId)
      if (fromIdx === -1 || toIdx === -1) { clearAllDropMarkers(); return }
      const rect = chip.getBoundingClientRect()
      const before = e.clientY < rect.top + rect.height / 2
      let finalTo = toIdx
      if (fromIdx < toIdx && before) finalTo = toIdx - 1
      if (fromIdx > toIdx && !before) finalTo = toIdx + 1
      const ok = queue.reorder(fromIdx, finalTo)
      clearAllDropMarkers()
      if (ok) {
        postQueueAction("reorder_queue", tabId, { fromIndex: fromIdx, toIndex: finalTo })
        persistQueues()
        renderQueue(tabId)
        requestAnimationFrame(() => {
          const newChip = document.querySelector(`.queue-chip[data-queue-id="${sourceId}"]`) as HTMLElement | null
          newChip?.focus()
        })
      }
    })

    chip.addEventListener("keydown", (e) => {
      if (!e.altKey) return
      // Capture the index BEFORE the local move — the old code computed both
      // fromIndex and toIndex AFTER moving, so they were always equal and the
      // host treated every keyboard reorder as a no-op (the user's reorder
      // then silently reverted on the next queue_state sync).
      const fromIdx = indexOf(itemId)
      let moved = false
      if (e.key === "ArrowUp") {
        moved = fromIdx > 0 && queue.reorder(fromIdx, fromIdx - 1)
      } else if (e.key === "ArrowDown") {
        moved = fromIdx >= 0 && queue.reorder(fromIdx, fromIdx + 1)
      } else if (e.key === "Home") {
        moved = queue.moveToFront(itemId)
      } else if (e.key === "End") {
        moved = queue.moveToBack(itemId)
      } else {
        return
      }
      e.preventDefault()
      if (moved) {
        postQueueAction("reorder_queue", tabId, {
          fromIndex: fromIdx,
          toIndex: indexOf(itemId),
        })
        persistQueues()
        renderQueue(tabId)
        requestAnimationFrame(() => {
          const newChip = document.querySelector(`.queue-chip[data-queue-id="${itemId}"]`) as HTMLElement | null
          newChip?.focus()
        })
      }
    })
  }

  function updateQueueSendButton() {
    const active = stateManager.getActiveSession()
    if (!active) return
    const queue = promptQueues.get(active.id)
    const qCount = queue ? queue.getItems().filter((i: QueueItem) => i.state === "queued").length : 0
    const hint = els.inputArea.querySelector(".queue-hint") as HTMLElement | null
    if (qCount > 0) {
      if (!hint) {
        const div = document.createElement("div")
        div.className = "queue-hint"
        els.inputArea.insertBefore(div, els.inputWrapper)
      }
      const hintEl = els.inputArea.querySelector(".queue-hint")! as HTMLElement
      // The queue only drains at stream end. When the session is idle
      // (post-abort with drainAfterAbort=false, or restored after a reload)
      // NOTHING will ever drain it \u2014 claiming "auto-sends" was a lie that
      // left users staring at a stuck queue. Offer an explicit resume.
      const isBusy = Boolean(active.isStreaming || active.isServerStreaming)
      hintEl.replaceChildren()
      const label = document.createElement("span")
      label.textContent = isBusy
        ? `${qCount} queued \u2014 auto-sends when current response completes`
        : `${qCount} queued \u2014 paused`
      hintEl.appendChild(label)
      if (!isBusy) {
        const resumeBtn = document.createElement("button")
        resumeBtn.className = "queue-resume-btn"
        resumeBtn.textContent = "Send next"
        resumeBtn.setAttribute("aria-label", `Send next of ${qCount} queued prompts`)
        resumeBtn.addEventListener("click", () => {
          postQueueAction("resume_queue", active.id)
        })
        hintEl.appendChild(resumeBtn)
      }
    } else {
      if (hint) hint.remove()
    }
    const badge = document.getElementById("send-queue-count")
    if (badge) {
      if (qCount > 0) {
        badge.textContent = String(qCount)
        badge.classList.remove("hidden")
      } else {
        badge.classList.add("hidden")
      }
    }
  }

  return {
    renderQueue,
    wireChipReorderHandlers,
    updateQueueSendButton,
    persistQueues,
    restoreQueues,
  }
}


