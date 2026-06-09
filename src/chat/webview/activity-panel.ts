/**
 * Agent Activity Timeline panel.
 *
 * A structured, filterable, keyboard-navigable feed of what the agent is doing
 * and has done. Renders the pure `ActivityEvent[]` from `activityModel.ts` as a
 * list of rows with filter chips (All / Messages / Plans / Commands / Files /
 * Errors / Approvals). Clicking a row scrolls the transcript to the originating
 * message.
 *
 * Frontend-only: no new backend messages. The feed is a read-model over data
 * the webview already holds, rebuilt (debounced, and only when content actually
 * changes) as messages stream in.
 *
 * Mirrors the structure of `subagent-panel.ts` / `todos-panel.ts`: a
 * `setup*(els, deps)` factory returning an API, a `*-panel hidden` region, an
 * Escape-to-close handler, and an explicit empty state.
 */
import type { ElementRefs } from "./dom"
import type { ChatMessage } from "./types"
import {
  buildActivityEvents,
  filterActivityEvents,
  summarizeActivity,
  ACTIVITY_FILTERS,
  type ActivityEvent,
  type ActivityFilter,
  type ActivityKind,
} from "./activityModel"

export type ActivityPanelEls = Pick<ElementRefs, "activityPanel" | "activityList" | "activityFilters" | "activityClose"> & {
  activityToggleBtn?: HTMLElement | null
}

export interface ActivityPanelDeps {
  getMessages: (sessionId: string) => ChatMessage[] | undefined
  isStreaming: (sessionId: string) => boolean
  getActiveSessionId: () => string | undefined
  getFilter: (sessionId: string) => ActivityFilter
  setFilter: (sessionId: string, filter: ActivityFilter) => void
  /** Scroll the transcript to the message that produced an event. */
  onJump: (anchorMessageId: string) => void
}

export interface ActivityPanelApi {
  /** Re-render for the given session (defaults to active). No-op when closed. */
  refresh: (sessionId?: string) => void
  open: () => void
  close: () => void
  toggle: () => void
  isOpen: () => boolean
  dispose: () => void
}

const FILTER_LABELS: Record<ActivityFilter, string> = {
  all: "All",
  messages: "Messages",
  plans: "Plans",
  commands: "Commands",
  files: "Files",
  errors: "Errors",
  approvals: "Approvals",
}

const KIND_ICON: Record<ActivityKind, string> = {
  message: "💬",
  thinking: "💭",
  plan: "📋",
  tool: "🔧",
  command: "⌘",
  "file-read": "📖",
  "file-edit": "✎",
  approval: "❓",
  checkpoint: "🏁",
  error: "⚠",
  completion: "✓",
}

const KIND_LABEL: Record<ActivityKind, string> = {
  message: "Message",
  thinking: "Reasoning",
  plan: "Plan",
  tool: "Tool",
  command: "Command",
  "file-read": "File read",
  "file-edit": "File edit",
  approval: "Approval",
  checkpoint: "Checkpoint",
  error: "Error",
  completion: "Completed",
}

export function setupActivityPanel(els: ActivityPanelEls, deps: ActivityPanelDeps): ActivityPanelApi | undefined {
  const panel = els.activityPanel
  const list = els.activityList
  const filters = els.activityFilters
  const closeBtn = els.activityClose
  const toggleBtn = els.activityToggleBtn ?? null

  if (!panel || !list || !filters || !closeBtn) {
    console.warn("Activity panel elements not found")
    return undefined
  }

  // Last rendered signature — skip DOM rebuilds when nothing visible changed so
  // streaming does not thrash focus or scroll position.
  let lastSignature = ""

  buildFilterChips()

  const onCloseClick = () => close()
  closeBtn.addEventListener("click", onCloseClick)

  const onEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape" && isOpen()) {
      close()
      toggleBtn?.focus()
    }
  }
  document.addEventListener("keydown", onEscape)

  const onListKeydown = (e: KeyboardEvent) => {
    const items = Array.from(list.querySelectorAll<HTMLElement>(".activity-item"))
    if (items.length === 0) return
    const activeEl = document.activeElement as HTMLElement | null
    const idx = activeEl ? items.indexOf(activeEl) : -1
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
  }
  list.addEventListener("keydown", onListKeydown)

  function buildFilterChips(): void {
    filters.replaceChildren()
    filters.setAttribute("role", "toolbar")
    filters.setAttribute("aria-label", "Filter activity")
    for (const filter of ACTIVITY_FILTERS) {
      const chip = document.createElement("button")
      chip.type = "button"
      chip.className = "activity-filter-chip"
      chip.dataset.filter = filter
      chip.textContent = FILTER_LABELS[filter]
      chip.setAttribute("aria-pressed", "false")
      chip.addEventListener("click", () => {
        const sid = deps.getActiveSessionId()
        if (!sid) return
        deps.setFilter(sid, filter)
        lastSignature = "" // force rebuild on explicit filter change
        refresh(sid)
      })
      filters.appendChild(chip)
    }
  }

  function syncChips(active: ActivityFilter): void {
    for (const chip of Array.from(filters.querySelectorAll<HTMLElement>(".activity-filter-chip"))) {
      const on = chip.dataset.filter === active
      chip.classList.toggle("active", on)
      chip.setAttribute("aria-pressed", String(on))
    }
  }

  function signatureOf(events: ActivityEvent[], filter: ActivityFilter, streaming: boolean): string {
    // Bound the work: the tail dominates what the user perceives as "changed".
    const tail = events.slice(-200)
    return `${filter}|${streaming ? 1 : 0}|${events.length}|${tail.map((e) => `${e.id}:${e.status}`).join(",")}`
  }

  function renderList(filtered: ActivityEvent[], opts: { filter: ActivityFilter; total: number; streaming: boolean }): void {
    list.replaceChildren()

    const summary = document.createElement("div")
    summary.className = "activity-summary"
    const count = document.createElement("span")
    count.className = "activity-summary-count"
    count.textContent = opts.total === 0 ? "No activity yet" : `${filtered.length} of ${opts.total} event${opts.total === 1 ? "" : "s"}`
    summary.appendChild(count)
    if (opts.streaming) {
      const live = document.createElement("span")
      live.className = "activity-live"
      live.textContent = "Live"
      live.setAttribute("aria-label", "Agent is active")
      summary.appendChild(live)
    }
    list.appendChild(summary)

    if (filtered.length === 0) {
      const empty = document.createElement("div")
      empty.className = "activity-empty"
      empty.textContent =
        opts.total === 0
          ? "Activity from the agent — messages, tools, file edits, commands, and errors — will appear here."
          : `No ${FILTER_LABELS[opts.filter].toLowerCase()} activity in this session.`
      list.appendChild(empty)
      return
    }

    const rows = document.createElement("div")
    rows.className = "activity-rows"
    rows.setAttribute("role", "list")

    for (const ev of filtered) {
      const item = document.createElement("button")
      item.type = "button"
      item.className = `activity-item activity-item--${ev.kind} activity-item--status-${ev.status}`
      item.dataset.kind = ev.kind
      if (ev.anchorMessageId) item.dataset.anchor = ev.anchorMessageId
      item.setAttribute("role", "listitem")
      const aria = `${KIND_LABEL[ev.kind]}: ${ev.label}${ev.detail ? ` — ${ev.detail}` : ""} (${ev.status})`
      item.setAttribute("aria-label", aria)
      if (!ev.anchorMessageId) item.setAttribute("aria-disabled", "true")

      const icon = document.createElement("span")
      icon.className = "activity-item-icon"
      icon.setAttribute("aria-hidden", "true")
      icon.textContent = KIND_ICON[ev.kind]
      item.appendChild(icon)

      const body = document.createElement("span")
      body.className = "activity-item-body"

      const label = document.createElement("span")
      label.className = "activity-item-label"
      label.textContent = ev.label
      body.appendChild(label)

      if (ev.detail) {
        const detail = document.createElement("span")
        detail.className = "activity-item-detail"
        detail.textContent = ev.detail
        body.appendChild(detail)
      }
      item.appendChild(body)

      const badge = document.createElement("span")
      badge.className = `activity-item-status activity-item-status--${ev.status}`
      badge.textContent = ev.status
      item.appendChild(badge)

      item.addEventListener("click", () => {
        if (ev.anchorMessageId) deps.onJump(ev.anchorMessageId)
      })

      rows.appendChild(item)
    }

    list.appendChild(rows)
  }

  function refresh(sessionId?: string): void {
    if (!isOpen()) return
    const sid = sessionId || deps.getActiveSessionId()
    if (!sid) return
    // Only the active session is visible in the panel.
    if (sid !== deps.getActiveSessionId()) return

    const messages = deps.getMessages(sid) || []
    const streaming = deps.isStreaming(sid)
    const events = buildActivityEvents(messages, { isStreaming: streaming })
    const filter = deps.getFilter(sid)
    const filtered = filterActivityEvents(events, filter)

    syncChips(filter)

    const sig = signatureOf(events, filter, streaming)
    if (sig === lastSignature) return
    lastSignature = sig

    renderList(filtered, { filter, total: events.length, streaming })
  }

  function isOpen(): boolean {
    return !panel.classList.contains("hidden")
  }

  function open(): void {
    panel.classList.remove("hidden")
    toggleBtn?.setAttribute("aria-pressed", "true")
    lastSignature = "" // force a fresh render on open
    refresh()
    // Move focus to the active filter chip for keyboard users.
    filters.querySelector<HTMLElement>(".activity-filter-chip.active")?.focus()
  }

  function close(): void {
    panel.classList.add("hidden")
    toggleBtn?.setAttribute("aria-pressed", "false")
  }

  function toggle(): void {
    if (isOpen()) close()
    else open()
  }

  function dispose(): void {
    document.removeEventListener("keydown", onEscape)
    closeBtn.removeEventListener("click", onCloseClick)
    list.removeEventListener("keydown", onListKeydown)
  }

  return { refresh, open, close, toggle, isOpen, dispose }
}

// Re-export for callers/tests that want the summary without importing the model.
export { summarizeActivity }
