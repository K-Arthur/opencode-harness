/**
 * Commands / Tasks panel.
 *
 * Surfaces every shell command the agent ran (exec tool calls) as inspectable
 * task cards: command text, cwd, status, exit code, duration, collapsible
 * output, and per-task actions (copy command, copy output, open/​re-run in the
 * integrated terminal, cancel a running turn). Mirrors `activity-panel.ts`:
 * `setup*(els, deps)` → API, `*-panel hidden` region, Escape-to-close, filter
 * chips, empty state, keyboard navigation, signature-guarded rebuilds.
 *
 * Live incremental stdout is overlaid from the transient webview store when
 * available. Final persisted output still comes from the command read-model.
 */
import type { ElementRefs } from "./dom"
import type { ChatMessage } from "./types"
import { STATE_PENDING_SVG, PLAY_SVG, SUCCESS_SVG, ERROR_SVG, STATE_CANCELLED_SVG } from "./icons"
import type { LiveToolOutput } from "./toolPartialStore"
import {
  buildCommandTasks,
  filterCommandTasks,
  formatDuration,
  type CommandTask,
  type CommandFilter,
  type CommandStatus,
} from "./commandModel"

export type TasksPanelEls = Pick<ElementRefs, "tasksPanel" | "tasksList" | "tasksFilters" | "tasksCloseBtn"> & {
  tasksToggleBtn?: HTMLElement | null
}

export interface TasksPanelDeps {
  getMessages: (sessionId: string) => ChatMessage[] | undefined
  isStreaming: (sessionId: string) => boolean
  getActiveSessionId: () => string | undefined
  getFilter: (sessionId: string) => CommandFilter
  setFilter: (sessionId: string, filter: CommandFilter) => void
  getLiveToolOutput?: (sessionId: string, toolId: string) => LiveToolOutput | undefined
  onJump: (anchorMessageId: string) => void
  onCopy: (text: string) => void
  onOpenTerminal: (command: string, cwd: string | undefined, autorun: boolean) => void
  onCancel: (payload: { sessionId: string; toolId: string; stdout?: string; stderr?: string }) => void
  onPanelClose?: () => void
}

export interface TasksPanelApi {
  refresh: (sessionId?: string) => void
  open: () => void
  close: () => void
  toggle: () => void
  isOpen: () => boolean
  dispose: () => void
}

const FILTERS: readonly CommandFilter[] = ["all", "running", "failed", "succeeded"]
const FILTER_LABELS: Record<CommandFilter, string> = {
  all: "All",
  running: "Running",
  failed: "Failed",
  succeeded: "Succeeded",
}
const STATUS_ICON: Record<CommandStatus, string> = {
  pending: STATE_PENDING_SVG,
  running: PLAY_SVG,
  succeeded: SUCCESS_SVG,
  failed: ERROR_SVG,
  cancelled: STATE_CANCELLED_SVG,
  unknown: STATE_CANCELLED_SVG,
}

export function setupTasksPanel(els: TasksPanelEls, deps: TasksPanelDeps): TasksPanelApi | undefined {
  const panel = els.tasksPanel
  const list = els.tasksList
  const filters = els.tasksFilters
  const closeBtn = els.tasksCloseBtn
  const toggleBtn = els.tasksToggleBtn ?? null
  if (!panel || !list || !filters) {
    console.warn("Tasks panel elements not found")
    return undefined
  }

  let lastSignature = ""
  buildFilterChips()

  type RenderTask = CommandTask & { live?: LiveToolOutput }

  const onCloseClick = () => close()
  if (closeBtn) closeBtn.addEventListener("click", onCloseClick)

  const onEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape" && isOpen()) {
      close()
      toggleBtn?.focus()
    }
  }
  if (closeBtn) document.addEventListener("keydown", onEscape)

  const onListKeydown = (e: KeyboardEvent) => {
    const cards = Array.from(list.querySelectorAll<HTMLElement>(".task-card"))
    if (cards.length === 0) return
    const activeEl = document.activeElement as HTMLElement | null
    const idx = activeEl ? cards.findIndex((c) => c === activeEl || c.contains(activeEl)) : -1
    if (e.key === "ArrowDown") { e.preventDefault(); cards[Math.min(idx + 1, cards.length - 1)]?.focus() }
    else if (e.key === "ArrowUp") { e.preventDefault(); cards[Math.max(idx - 1, 0)]?.focus() }
    else if (e.key === "Home") { e.preventDefault(); cards[0]?.focus() }
    else if (e.key === "End") { e.preventDefault(); cards[cards.length - 1]?.focus() }
  }
  list.addEventListener("keydown", onListKeydown)

  function buildFilterChips(): void {
    filters.replaceChildren()
    filters.setAttribute("role", "toolbar")
    filters.setAttribute("aria-label", "Filter commands")
    for (const f of FILTERS) {
      const chip = document.createElement("button")
      chip.type = "button"
      chip.className = "tasks-filter-chip"
      chip.dataset.filter = f
      chip.textContent = FILTER_LABELS[f]
      chip.setAttribute("aria-pressed", "false")
      chip.addEventListener("click", () => {
        const sid = deps.getActiveSessionId()
        if (!sid) return
        deps.setFilter(sid, f)
        lastSignature = ""
        refresh(sid)
      })
      filters.appendChild(chip)
    }
  }

  function syncChips(active: CommandFilter): void {
    for (const chip of Array.from(filters.querySelectorAll<HTMLElement>(".tasks-filter-chip"))) {
      const on = chip.dataset.filter === active
      chip.classList.toggle("active", on)
      chip.setAttribute("aria-pressed", String(on))
    }
  }

  function signatureOf(tasks: RenderTask[], filter: CommandFilter): string {
    return `${filter}|${tasks.length}|${tasks.map((t) => `${t.id}:${t.status}:${t.exitCode ?? ""}:${t.live?.token ?? ""}:${t.output?.length ?? 0}`).join(",")}`
  }

  function actionButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button")
    b.type = "button"
    b.className = "task-action-btn"
    b.textContent = label
    b.title = title
    b.setAttribute("aria-label", title)
    b.addEventListener("click", (e) => { e.stopPropagation(); onClick() })
    return b
  }

  function renderCard(task: RenderTask, sessionId: string): HTMLElement {
    const card = document.createElement("div")
    card.className = `task-card task-card--${task.status}`
    card.dataset.toolId = task.id
    card.tabIndex = 0
    card.setAttribute("role", "group")
    card.setAttribute("aria-label", `${task.status} command: ${task.command}`)
    if (task.anchorMessageId) card.dataset.anchor = task.anchorMessageId

    const header = document.createElement("div")
    header.className = "task-card-header"

    const icon = document.createElement("span")
    icon.className = "task-card-icon"
    icon.setAttribute("aria-hidden", "true")
    icon.innerHTML = STATUS_ICON[task.status]
    header.appendChild(icon)

    const cmd = document.createElement("code")
    cmd.className = "task-card-command"
    cmd.textContent = task.command
    if (task.anchorMessageId) {
      cmd.addEventListener("click", () => deps.onJump(task.anchorMessageId!))
      cmd.style.cursor = "pointer"
    }
    header.appendChild(cmd)

    const badge = document.createElement("span")
    badge.className = `task-card-status task-card-status--${task.status}`
    badge.textContent = task.status
    header.appendChild(badge)
    card.appendChild(header)

    const metaParts: string[] = []
    if (task.cwd) metaParts.push(task.cwd)
    if (typeof task.exitCode === "number") metaParts.push(`exit ${task.exitCode}`)
    const dur = formatDuration(task.durationMs)
    if (dur) metaParts.push(dur)
    if (metaParts.length) {
      const meta = document.createElement("div")
      meta.className = "task-card-meta"
      meta.textContent = metaParts.join(" · ")
      card.appendChild(meta)
    }

    if (task.output && task.output.trim()) {
      const details = document.createElement("details")
      details.className = "task-card-output"
      const summary = document.createElement("summary")
      summary.textContent = "Output"
      details.appendChild(summary)
      const pre = document.createElement("pre")
      pre.textContent = task.output.length > 4000 ? task.output.slice(0, 4000) + "\n…(truncated)" : task.output
      details.appendChild(pre)
      card.appendChild(details)
    }

    const actions = document.createElement("div")
    actions.className = "task-card-actions"
    actions.appendChild(actionButton("Copy", "Copy command", () => deps.onCopy(task.command)))
    if (task.output && task.output.trim()) {
      actions.appendChild(actionButton("Copy output", "Copy command output", () => deps.onCopy(task.output!)))
    }
    actions.appendChild(actionButton("Terminal", "Stage command in the integrated terminal", () => deps.onOpenTerminal(task.command, task.cwd, false)))
    actions.appendChild(actionButton("Re-run", "Run the command in the integrated terminal", () => deps.onOpenTerminal(task.command, task.cwd, true)))
    if (task.status === "running") {
      actions.appendChild(actionButton("Cancel", "Cancel the running command", () => deps.onCancel({
        sessionId,
        toolId: task.id,
        stdout: task.live?.stdout,
        stderr: task.live?.stderr,
      })))
    }
    card.appendChild(actions)

    return card
  }

  function renderList(tasks: RenderTask[], opts: { filter: CommandFilter; total: number; sessionId: string }): void {
    list.replaceChildren()

    const summary = document.createElement("div")
    summary.className = "tasks-summary"
    summary.textContent = opts.total === 0 ? "No commands yet" : `${tasks.length} of ${opts.total} command${opts.total === 1 ? "" : "s"}`
    list.appendChild(summary)

    if (tasks.length === 0) {
      const empty = document.createElement("div")
      empty.className = "tasks-empty"
      empty.textContent = opts.total === 0
        ? "Shell commands the agent runs will appear here with their status, exit code, and output."
        : `No ${FILTER_LABELS[opts.filter].toLowerCase()} commands in this session.`
      list.appendChild(empty)
      return
    }

    const rows = document.createElement("div")
    rows.className = "task-rows"
    for (const task of tasks) rows.appendChild(renderCard(task, opts.sessionId))
    list.appendChild(rows)
  }

  function overlayLiveOutput(sessionId: string, tasks: CommandTask[]): RenderTask[] {
    return tasks.map((task) => {
      const live = deps.getLiveToolOutput?.(sessionId, task.id)
      if (!live) return task
      const output = `${live.stdout}${live.stderr}`
      return {
        ...task,
        status: task.status === "pending" ? "running" : task.status,
        output: output || task.output,
        live,
      }
    })
  }

  function refresh(sessionId?: string): void {
    if (!isOpen()) return
    const sid = sessionId || deps.getActiveSessionId()
    if (!sid || sid !== deps.getActiveSessionId()) return

    const messages = deps.getMessages(sid) || []
    const all = overlayLiveOutput(sid, buildCommandTasks(messages))
    const filter = deps.getFilter(sid)
    const tasks = filterCommandTasks(all, filter) as RenderTask[]
    syncChips(filter)

    const sig = signatureOf(all, filter)
    if (sig === lastSignature) return
    lastSignature = sig
    renderList(tasks, { filter, total: all.length, sessionId: sid })
  }

  function isOpen(): boolean { return !panel.classList.contains("hidden") }
  function open(): void {
    panel.classList.remove("hidden")
    toggleBtn?.setAttribute("aria-pressed", "true")
    lastSignature = ""
    refresh()
    filters.querySelector<HTMLElement>(".tasks-filter-chip.active")?.focus()
  }
  function close(): void {
    panel.classList.add("hidden")
    toggleBtn?.setAttribute("aria-pressed", "false")
    deps.onPanelClose?.()
  }
  function toggle(): void { if (isOpen()) close(); else open() }
  function dispose(): void {
    if (closeBtn) {
      document.removeEventListener("keydown", onEscape)
      closeBtn.removeEventListener("click", onCloseClick)
    }
    list.removeEventListener("keydown", onListKeydown)
  }

  return { refresh, open, close, toggle, isOpen, dispose }
}
