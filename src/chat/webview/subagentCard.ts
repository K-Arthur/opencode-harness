/**
 * Inline Subagent Task card.
 *
 * When the main opencode agent delegates work it calls a tool literally named
 * `task` whose args are `{ subagent_type, description, prompt }`. Rendered as a
 * generic tool, that prompt leaks into the transcript as raw JSON. This module
 * recognises the task tool and renders it as a first-class subagent entity:
 * agent name + one-line purpose + status + duration, with the result summarised,
 * errors made readable, and the full prompt tucked behind a debug expander.
 *
 * This is the SINGLE string-match site for detecting a subagent invocation on
 * the webview side (mirrors `classifyTool` on the backend). Keep the accepted
 * tool names here in sync with the backend bridge in StreamCoordinator.
 */
import type { Block, ToolCallBlock } from "./types"
import { isSubagentToolName, parseSubagentInvocation, type SubagentInvocation } from "../handlers/toolClassifier"

/** Status the card derives from the underlying tool-call state. */
export type SubagentCardStatus = "queued" | "running" | "completed" | "failed" | "stale"

/** Re-exported from the shared (backend+webview) detector in toolClassifier.ts. */
export type TaskInvocation = SubagentInvocation

/** Minimal options surface — kept independent of toolCallRenderer to avoid a cycle. */
export interface SubagentCardOptions {
  postMessage?: (msg: Record<string, unknown>) => void
}

const STATUS_LABEL: Record<SubagentCardStatus, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Done",
  failed: "Failed",
  stale: "Unconfirmed",
}

// Person/agent glyph for the subagent card.
const SUBAGENT_ICON_SVG = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="8" width="14" height="11" rx="2"/><path d="M12 8V5"/><circle cx="12" cy="4" r="1.4"/><path d="M9 13h.01"/><path d="M15 13h.01"/><path d="M2 14v2"/><path d="M22 14v2"/></svg>`

// Strip ANSI escapes and C0 control chars (except \n/\t) that appear in raw
// subagent stdout. Mirrors the helper in subagent-panel.ts.
const ANSI_AND_CONTROL_RE = /\x1b\[[0-9;]*[a-zA-Z]|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g
function sanitizeOutput(s: string): string {
  return s.replace(ANSI_AND_CONTROL_RE, "")
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

/** True when this block is the subagent-spawning `task` tool. */
export function isTaskTool(block: Block | ToolCallBlock): boolean {
  const name =
    asString((block as Block).tool) ||
    asString(block.name) ||
    asString((block as Block).toolName)
  return isSubagentToolName(name)
}

/**
 * Extract `{ agentName, purpose, prompt }` from the task tool's args. Delegates
 * to the shared parser so the backend bridge and this card stay in lockstep.
 */
export function parseTaskInvocation(rawArgs: unknown): TaskInvocation {
  return parseSubagentInvocation(rawArgs)
}

/** Map the tool-call state machine onto a subagent-facing status. */
export function subagentStatusFromBlock(block: ToolCallBlock): SubagentCardStatus {
  const state = block.state || "running"
  if (block.error || state === "error") return "failed"
  if (state === "pending") return "queued"
  if (state === "running") return "running"
  if (state === "stale" || state === "unresolved") return "stale"
  return "completed"
}

function formatDuration(ms: number): string {
  if (ms >= 60000) {
    const total = Math.round(ms / 1000)
    return `${Math.floor(total / 60)}m ${total % 60}s`
  }
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${ms}ms`
}

function buildTiming(block: ToolCallBlock, status: SubagentCardStatus): HTMLElement | null {
  const isTerminal = status === "completed" || status === "failed" || status === "stale"
  if (isTerminal) {
    if (typeof block.durationMs !== "number" || block.durationMs < 0) return null
    const el = document.createElement("span")
    el.className = "subagent-card-duration"
    el.textContent = formatDuration(block.durationMs)
    return el
  }
  // Running / queued — reuse the shared `.tool-elapsed` live ticker (keyed by
  // block id, registered by the tool-start path) so the card counts up too.
  const el = document.createElement("span")
  el.className = "subagent-card-duration tool-elapsed"
  el.dataset.blockId = block.id
  el.textContent = "0s"
  return el
}

function buildSummary(inv: TaskInvocation, status: SubagentCardStatus, block: ToolCallBlock): HTMLElement {
  const summary = document.createElement("summary")
  summary.className = "subagent-card-header"
  summary.setAttribute("tabindex", "0")
  summary.setAttribute("role", "button")

  const icon = document.createElement("span")
  icon.className = "subagent-card-icon"
  icon.setAttribute("aria-hidden", "true")
  icon.innerHTML = SUBAGENT_ICON_SVG
  summary.appendChild(icon)

  const titleWrap = document.createElement("div")
  titleWrap.className = "subagent-card-titlewrap"

  const title = document.createElement("span")
  title.className = "subagent-card-title"
  title.textContent = `Subagent: ${inv.agentName}`
  titleWrap.appendChild(title)

  if (inv.purpose) {
    const purpose = document.createElement("span")
    purpose.className = "subagent-card-purpose"
    purpose.textContent = inv.purpose
    purpose.title = inv.purpose
    titleWrap.appendChild(purpose)
  }
  summary.appendChild(titleWrap)

  const badge = document.createElement("span")
  badge.className = `subagent-card-status subagent-card-status--${status}`
  badge.textContent = STATUS_LABEL[status]
  summary.appendChild(badge)

  const timing = buildTiming(block, status)
  if (timing) summary.appendChild(timing)

  return summary
}

function buildSection(labelText: string, bodyText: string, opts: { error?: boolean } = {}): HTMLElement {
  const wrap = document.createElement("div")
  wrap.className = opts.error ? "subagent-card-section subagent-card-section--error" : "subagent-card-section"
  if (opts.error) wrap.setAttribute("role", "alert")

  const label = document.createElement("div")
  label.className = "subagent-card-section-label"
  label.textContent = labelText
  wrap.appendChild(label)

  const body = document.createElement("div")
  body.className = "subagent-card-section-body"
  const clean = sanitizeOutput(bodyText)
  const truncated = clean.length > 1200
  body.textContent = truncated ? clean.slice(0, 1200) : clean
  wrap.appendChild(body)

  if (truncated) {
    const more = document.createElement("button")
    more.className = "subagent-card-show-more"
    more.textContent = "Show full"
    more.addEventListener("click", () => {
      body.textContent = clean
      more.remove()
    })
    wrap.appendChild(more)
  }
  return wrap
}

function buildActivityLink(block: ToolCallBlock, inv: TaskInvocation): HTMLElement {
  const link = document.createElement("button")
  link.className = "subagent-card-activity-link"
  link.textContent = "View activity →"
  link.setAttribute("aria-label", `View activity for ${inv.agentName}`)
  // Opening the side panel is an intra-webview action — dispatch a DOM event the
  // host webview (main.ts) listens for, rather than round-tripping to the host.
  link.addEventListener("click", (e) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      window.dispatchEvent(
        new CustomEvent("oc:open-subagent-panel", { detail: { subagentId: block.id, agentName: inv.agentName } }),
      )
    } catch {
      // No-op outside a DOM environment.
    }
  })
  return link
}

function buildPromptDebug(prompt: string): HTMLElement {
  const details = document.createElement("details")
  details.className = "subagent-card-debug"

  const summary = document.createElement("summary")
  summary.className = "subagent-card-debug-summary"
  summary.textContent = "Show task prompt (debug)"
  details.appendChild(summary)

  const pre = document.createElement("pre")
  pre.className = "subagent-card-debug-body"
  pre.textContent = prompt
  details.appendChild(pre)

  return details
}

/**
 * Render the `task` tool call as a first-class subagent card. Safe for replayed
 * sessions: a block with only args (no run-state link) still renders cleanly,
 * with the prompt behind the debug expander.
 */
export function renderSubagentTaskCard(block: ToolCallBlock, _opts: SubagentCardOptions = {}): HTMLElement {
  const invocation = parseTaskInvocation(block.args)
  const status = subagentStatusFromBlock(block)

  const card = document.createElement("details")
  card.className = `subagent-card subagent-card--${status}`
  card.dataset.blockId = block.id
  card.setAttribute("aria-label", `Subagent ${invocation.agentName}, ${STATUS_LABEL[status]}`)
  // Running and failed subagents expand by default so progress/errors are
  // visible; completed ones collapse to keep the transcript scannable.
  card.open = status === "running" || status === "failed"
  card.setAttribute("aria-expanded", card.open ? "true" : "false")
  card.addEventListener("toggle", () => {
    card.setAttribute("aria-expanded", card.open ? "true" : "false")
  })

  card.appendChild(buildSummary(invocation, status, block))

  const body = document.createElement("div")
  body.className = "subagent-card-body"

  if (status === "completed" && typeof block.result === "string" && block.result.trim()) {
    body.appendChild(buildSection("Result", block.result))
  }
  if (status === "failed") {
    const errText = (typeof block.error === "string" && block.error) || block.result || "Subagent failed before producing output."
    body.appendChild(buildSection("Error", String(errText), { error: true }))
  }
  body.appendChild(buildActivityLink(block, invocation))
  if (invocation.prompt) {
    body.appendChild(buildPromptDebug(invocation.prompt))
  }

  card.appendChild(body)
  return card
}

// ---------------------------------------------------------------------------
// Live streaming updates
// ---------------------------------------------------------------------------
// The streaming path patches tool DOM in place rather than re-rendering. A
// subagent card has its own structure (not `.tool-call`), so it needs its own
// in-place updater. streamHandlers detects `.subagent-card` and calls this.

export interface SubagentCardUpdate {
  state?: string
  result?: string
  error?: string
  durationMs?: number
  stale?: boolean
}

const STATUS_CLASS_RE = /subagent-card--(?:queued|running|completed|failed|stale)/g
const STATUS_BADGE_CLASS_RE = /subagent-card-status--(?:queued|running|completed|failed|stale)/g

function currentStatusOf(cardEl: HTMLElement): SubagentCardStatus {
  const m = cardEl.className.match(/subagent-card--(queued|running|completed|failed|stale)/)
  return (m?.[1] as SubagentCardStatus | undefined) || "running"
}

function statusFromUpdate(u: SubagentCardUpdate, current: SubagentCardStatus): SubagentCardStatus {
  if (u.stale) return "stale"
  if (u.error || u.state === "error") return "failed"
  if (u.state === "completed" || u.state === "result") return "completed"
  if (u.state === "pending") return "queued"
  if (u.state === "running") return "running"
  return current
}

export function applySubagentCardUpdate(cardEl: HTMLElement, update: SubagentCardUpdate): void {
  const status = statusFromUpdate(update, currentStatusOf(cardEl))

  cardEl.className = cardEl.className.replace(STATUS_CLASS_RE, `subagent-card--${status}`)
  const badge = cardEl.querySelector<HTMLElement>(".subagent-card-status")
  if (badge) {
    badge.className = badge.className.replace(STATUS_BADGE_CLASS_RE, `subagent-card-status--${status}`)
    badge.textContent = STATUS_LABEL[status]
  }
  const prevAria = cardEl.getAttribute("aria-label") || "Subagent"
  cardEl.setAttribute("aria-label", `${prevAria.replace(/,[^,]*$/, "")}, ${STATUS_LABEL[status]}`)

  const isTerminal = status === "completed" || status === "failed" || status === "stale"

  // Freeze the elapsed counter with a final duration and drop the shared
  // `.tool-elapsed` hook so the live ticker stops touching it.
  if (isTerminal && typeof update.durationMs === "number" && update.durationMs >= 0) {
    const dur = cardEl.querySelector<HTMLElement>(".subagent-card-duration")
    if (dur) {
      dur.classList.remove("tool-elapsed")
      dur.textContent = formatDuration(update.durationMs)
    }
  }

  const body = cardEl.querySelector<HTMLElement>(".subagent-card-body")
  if (!body) return

  if (status === "completed") {
    const resultText = typeof update.result === "string" ? update.result : ""
    if (resultText.trim() && !body.querySelector(".subagent-card-section:not(.subagent-card-section--error)")) {
      body.insertBefore(buildSection("Result", resultText), body.firstChild)
    }
  }

  if (status === "failed") {
    if (!body.querySelector(".subagent-card-section--error")) {
      const errText = update.error || update.result || "Subagent failed before producing output."
      body.insertBefore(buildSection("Error", String(errText), { error: true }), body.firstChild)
    }
    if (cardEl instanceof HTMLDetailsElement) cardEl.open = true
    cardEl.setAttribute("aria-expanded", "true")
  }
}
