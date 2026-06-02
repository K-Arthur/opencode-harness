/**
 * Agent Activity model — pure read-model over a session's `ChatMessage[]`.
 *
 * The Activity Timeline (`activity-panel.ts`) turns the agent transcript into a
 * structured, filterable event feed: messages, plans, tool calls, file reads/
 * edits, commands, approvals, checkpoints, errors. This module owns the
 * *derivation* and *filtering* of those events and is intentionally:
 *
 *   - **pure** — no DOM, no I/O, no globals; same input → same output.
 *   - **tolerant** — handles both legacy block shapes (`tool-call`, `thinking`,
 *     `diff`) and canonical ones (`tool`, `reasoning`) so historical and live
 *     sessions both classify correctly (mirrors `state.ts` migration).
 *
 * No backend changes are involved — every event is derived from data the
 * webview already holds.
 */
import type { ChatMessage, Block } from "./types"

export type ActivityKind =
  | "message"
  | "thinking"
  | "plan"
  | "tool"
  | "command"
  | "file-read"
  | "file-edit"
  | "approval"
  | "checkpoint"
  | "error"
  | "completion"

export type ActivityStatus = "pending" | "running" | "success" | "error" | "info"

export interface ActivityEvent {
  /** Stable key for this event within the session (used for keyed rebuilds). */
  id: string
  kind: ActivityKind
  /** Short human label, e.g. "Ran npm test", "Edited src/foo.ts". */
  label: string
  /** Optional secondary detail (path, exit code, +/- counts). */
  detail?: string
  status: ActivityStatus
  /** Sort key; derived from message timestamp with a stable tiebreak. */
  timestamp: number
  /** Message this event belongs to — the panel scrolls here on click. */
  anchorMessageId?: string
  /** Stable ref into the source block (tool id, diff id) when available. */
  refId?: string
}

// Kept structurally identical to SessionState.activityFilter in types.ts.
// (Defined here independently to avoid a types.ts ⇄ activityModel import cycle.)
export type ActivityFilter =
  | "all"
  | "messages"
  | "plans"
  | "commands"
  | "files"
  | "errors"
  | "approvals"

export const ACTIVITY_FILTERS: readonly ActivityFilter[] = [
  "all",
  "messages",
  "plans",
  "commands",
  "files",
  "errors",
  "approvals",
] as const

/** Which event kinds each non-"all" filter admits. */
const FILTER_KINDS: Record<Exclude<ActivityFilter, "all">, readonly ActivityKind[]> = {
  messages: ["message", "thinking", "completion"],
  plans: ["plan"],
  commands: ["command", "tool"],
  files: ["file-read", "file-edit", "checkpoint"],
  errors: ["error"],
  approvals: ["approval"],
}

export interface BuildActivityOptions {
  /** When true, the most recent assistant message is still streaming. */
  isStreaming?: boolean
}

// ── block-type folding (legacy ⇄ canonical) ────────────────────────────────

const TOOL_TYPES = new Set(["tool-call", "tool_call", "tool"])
const THINKING_TYPES = new Set(["thinking", "reasoning"])
const DIFF_TYPES = new Set(["diff", "diff_block"])
const STEP_FINISH_TYPES = new Set(["step-finish", "step_finish"])

function readArg(block: Block, keys: readonly string[]): string {
  const args = (block.args ?? block) as Record<string, unknown>
  if (args && typeof args === "object") {
    for (const k of keys) {
      const v = args[k]
      if (typeof v === "string" && v.length > 0) return v
    }
  }
  // Some blocks carry the field at the top level rather than under `args`.
  for (const k of keys) {
    const v = (block as Record<string, unknown>)[k]
    if (typeof v === "string" && v.length > 0) return v
  }
  return ""
}

function toolName(block: Block): string {
  const raw = block.tool ?? block.name ?? block.toolName
  return typeof raw === "string" && raw ? raw : "tool"
}

/** Infer a ToolCallClass for blocks that predate the `class` field. */
function inferToolClass(block: Block): string {
  const explicit = block.class
  if (typeof explicit === "string" && explicit) return explicit
  const n = toolName(block).toLowerCase()
  if (/(bash|shell|^run$|exec|command|terminal)/.test(n)) return "exec"
  if (/(write|edit|apply|patch|create)/.test(n)) return "write"
  if (/(read|cat|grep|glob|list|^ls$|search|find)/.test(n)) return "read"
  return "meta"
}

function toolStatus(block: Block): ActivityStatus {
  switch (block.state) {
    case "pending":
      return "pending"
    case "running":
      return "running"
    case "result":
    case "completed":
      return "success"
    case "error":
      return "error"
    case "stale":
    case "unresolved":
      return "info"
    default:
      return block.error ? "error" : "info"
  }
}

function truncate(s: string, max = 80): string {
  const t = s.trim().replace(/\s+/g, " ")
  return t.length > max ? t.slice(0, max) + "…" : t
}

function basename(path: string): string {
  const clean = path.replace(/[/\\]+$/, "")
  const idx = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"))
  return idx >= 0 ? clean.slice(idx + 1) : clean
}

/**
 * Lightweight, robust plan detection for the activity feed: a write to a
 * markdown file whose frontmatter declares a `todos:` block. Self-contained so
 * the feed does not depend on the heavier (and currently fragile) frontmatter
 * parser in planDetector.ts — the feed only needs the name and step counts.
 */
function detectPlanLite(block: Block, path: string): { name: string; total: number; done: number } | null {
  if (!/\.(plan\.)?md$/i.test(path)) return null
  const content = readArg(block, ["content", "text", "diff"])
  const fm = content.match(/^---\s*\n([\s\S]*?)\n---/)
  const frontmatter = fm?.[1]
  if (!frontmatter || !/(^|\n)\s*todos:/.test(frontmatter)) return null
  const name = (frontmatter.match(/(^|\n)\s*name:\s*(.+)/)?.[2] ?? basename(path)).trim()
  const total = (frontmatter.match(/(^|\n)\s*-\s+id:/g) ?? []).length
  const done = (frontmatter.match(/status:\s*completed/g) ?? []).length
  return { name, total, done }
}

function firstTextSnippet(blocks: Block[]): string {
  for (const b of blocks) {
    if (b.type !== "text") continue
    const raw = typeof b.text === "string" ? b.text : typeof b.content === "string" ? b.content : ""
    const text = raw.trim()
    if (text) return text
  }
  return ""
}

// ── per-block event derivation ─────────────────────────────────────────────

interface BlockCtx {
  key: string
  anchorMessageId?: string
  timestamp: number
  role: ChatMessage["role"]
}

/** Returns an event for a non-prose block, or null when the block is feed-irrelevant. */
function blockToEvent(block: Block, ctx: BlockCtx): ActivityEvent | null {
  const base = {
    timestamp: ctx.timestamp,
    anchorMessageId: ctx.anchorMessageId,
    refId: typeof block.id === "string" ? block.id : undefined,
  }
  const type = typeof block.type === "string" ? block.type : ""

  if (THINKING_TYPES.has(type)) {
    const content = (typeof block.content === "string" && block.content) || (typeof block.text === "string" && block.text) || ""
    if (!content.trim() && !block.streaming) return null
    return { ...base, id: `${ctx.key}`, kind: "thinking", label: "Reasoning", detail: truncate(content, 64) || undefined, status: block.streaming ? "running" : "info" }
  }

  if (TOOL_TYPES.has(type)) {
    const cls = inferToolClass(block)
    const status = toolStatus(block)
    const name = toolName(block)

    if (cls === "exec") {
      const cmd = readArg(block, ["command", "cmd", "text", "script"]) || name
      const exit = (block as Record<string, unknown>).exitCode
      const detail = typeof exit === "number" ? `exit ${exit}` : undefined
      return { ...base, id: ctx.key, kind: "command", label: truncate(cmd), detail, status }
    }

    if (cls === "write") {
      const path = readArg(block, ["path", "file", "filePath", "filename"])
      // A write of a plan markdown file is a Plan, not a generic edit.
      const plan = detectPlanLite(block, path)
      if (plan) {
        return { ...base, id: ctx.key, kind: "plan", label: `Plan: ${plan.name}`, detail: `${plan.done}/${plan.total} steps`, status }
      }
      return { ...base, id: ctx.key, kind: "file-edit", label: path ? `Wrote ${basename(path)}` : `Used ${name}`, detail: path || undefined, status }
    }

    if (cls === "read") {
      const path = readArg(block, ["path", "file", "filePath", "pattern", "query"])
      return { ...base, id: ctx.key, kind: "file-read", label: path ? `Read ${basename(path)}` : `Used ${name}`, detail: path || undefined, status }
    }

    return { ...base, id: ctx.key, kind: "tool", label: `Used ${name}`, status }
  }

  if (DIFF_TYPES.has(type)) {
    const path = typeof block.path === "string" ? block.path : ""
    const added = typeof block.linesAdded === "number" ? block.linesAdded : 0
    const removed = typeof block.linesRemoved === "number" ? block.linesRemoved : 0
    const state = block.state
    const status: ActivityStatus = state === "accepted" ? "success" : state === "rejected" || state === "discarded" ? "info" : "pending"
    return {
      ...base,
      id: ctx.key,
      kind: "file-edit",
      label: path ? `Edited ${basename(path)}` : "Proposed edit",
      detail: `+${added} −${removed}`,
      status,
      refId: typeof block.diffId === "string" ? block.diffId : base.refId,
    }
  }

  if (type === "error") {
    const msg = (typeof block.message === "string" && block.message) || (typeof block.text === "string" && block.text) || "Error"
    return { ...base, id: ctx.key, kind: "error", label: truncate(msg), detail: typeof block.code === "string" ? block.code : undefined, status: "error" }
  }

  if (type === "question") {
    const q = (typeof block.text === "string" && block.text) || "Question"
    return { ...base, id: ctx.key, kind: "approval", label: truncate(q), status: "pending" }
  }

  if (type === "snapshot") {
    return { ...base, id: ctx.key, kind: "checkpoint", label: "Checkpoint", status: "info" }
  }

  if (STEP_FINISH_TYPES.has(type)) {
    return { ...base, id: ctx.key, kind: "completion", label: "Step complete", status: "success" }
  }

  // text / step-start / unknown → no standalone event (prose is covered by the
  // message-level event so the feed stays one-row-per-meaningful-action).
  return null
}

// ── public API ─────────────────────────────────────────────────────────────

/**
 * Derive the ordered activity feed for a session. One message-level event per
 * message that carries prose (or any user message), plus one event per
 * meaningful non-prose block. Pure and deterministic.
 */
export function buildActivityEvents(messages: ChatMessage[], opts: BuildActivityOptions = {}): ActivityEvent[] {
  const events: ActivityEvent[] = []
  const lastIndex = messages.length - 1

  messages.forEach((msg, mi) => {
    const blocks = Array.isArray(msg.blocks) ? msg.blocks : []
    const messageKey = msg.id || `m${mi}`
    // Stable, monotonic ordering even when timestamps are missing/equal.
    const ts = (typeof msg.timestamp === "number" ? msg.timestamp : 0) + mi * 1e-3
    const ctxBase = { anchorMessageId: msg.id, timestamp: ts, role: msg.role }

    const snippet = firstTextSnippet(blocks)
    const streamingNow = Boolean(opts.isStreaming) && mi === lastIndex && msg.role === "assistant"
    if (msg.role === "user" || snippet) {
      const label = msg.role === "user" ? (snippet ? truncate(snippet) : "Sent a message") : snippet ? truncate(snippet) : "Response"
      events.push({
        id: `${messageKey}:msg`,
        kind: "message",
        label,
        status: msg.role === "user" ? "info" : streamingNow ? "running" : "success",
        timestamp: ts,
        anchorMessageId: msg.id,
      })
    }

    blocks.forEach((block, bi) => {
      const ev = blockToEvent(block, { ...ctxBase, key: `${messageKey}:${bi}` })
      if (ev) events.push(ev)
    })
  })

  return events.sort((a, b) => a.timestamp - b.timestamp)
}

/** Filter a derived feed by the active filter chip. Pure. */
export function filterActivityEvents(events: readonly ActivityEvent[], filter: ActivityFilter): ActivityEvent[] {
  if (filter === "all") return events.slice()
  const kinds = FILTER_KINDS[filter]
  return events.filter((e) => kinds.includes(e.kind))
}

/** Per-kind count map (for filter-chip badges / empty-state messaging). Pure. */
export function summarizeActivity(events: readonly ActivityEvent[]): Record<ActivityKind, number> {
  const out = {
    message: 0,
    thinking: 0,
    plan: 0,
    tool: 0,
    command: 0,
    "file-read": 0,
    "file-edit": 0,
    approval: 0,
    checkpoint: 0,
    error: 0,
    completion: 0,
  } as Record<ActivityKind, number>
  for (const e of events) out[e.kind]++
  return out
}
