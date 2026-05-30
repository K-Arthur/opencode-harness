/**
 * Pure normalization for the `question` tool's input.
 *
 * opencode/the model can emit a model question in more than one shape. We have
 * observed (and defensively support) two:
 *
 *   1. Flat single question:
 *        { question | prompt | message | text, options | choices | select,
 *          allowFreeText? }
 *   2. Claude-style nested groups:
 *        { questions: [ { question, header?, options: (string | {label})[],
 *          multiSelect? } ] }
 *
 * Both collapse to a `QuestionGroup[]`. An empty array means the args carry no
 * usable question yet (e.g. a `stream_tool_start` before the tool input has
 * finished streaming) — callers should keep whatever they already rendered
 * rather than wiping it.
 *
 * This module is pure (no DOM, no side effects) so it can be property-tested.
 */

export interface QuestionGroup {
  question: string
  header?: string
  options: string[]
  multiSelect: boolean
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
}

function firstString(obj: Record<string, unknown>, keys: readonly string[]): string {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === "string" && v) return v
  }
  return ""
}

function firstArray(obj: Record<string, unknown>, keys: readonly string[]): unknown[] {
  for (const k of keys) {
    const v = obj[k]
    if (Array.isArray(v) && v.length > 0) return v
  }
  return []
}

/**
 * Map a raw options array to plain string labels. Each entry may be a bare
 * string or an object with a `label` (Claude's AskUserQuestion option shape:
 * `{ label, description }`). Empty labels are dropped.
 */
export function toOptionLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((o) => {
      if (typeof o === "string") return o
      if (o && typeof o === "object") {
        const rec = o as Record<string, unknown>
        if ("label" in rec) return String(rec.label ?? "")
        if ("value" in rec) return String(rec.value ?? "")
      }
      return String(o)
    })
    .filter((s) => s.length > 0)
}

const QUESTION_KEYS = ["question", "prompt", "message", "text"] as const
const OPTION_KEYS = ["options", "choices", "select"] as const
const HEADER_KEYS = ["header", "title", "label"] as const

function toGroup(entry: unknown): QuestionGroup | null {
  if (typeof entry === "string") {
    return entry ? { question: entry, options: [], multiSelect: false } : null
  }
  if (!entry || typeof entry !== "object") return null
  const o = entry as Record<string, unknown>
  const question = firstString(o, QUESTION_KEYS)
  const header = firstString(o, HEADER_KEYS) || undefined
  const options = toOptionLabels(firstArray(o, OPTION_KEYS))
  const multiSelect = o.multiSelect === true || o.multiselect === true || o.allowMultiple === true
  if (!question && options.length === 0 && !header) return null
  return { question, header, options, multiSelect }
}

/**
 * Normalize raw question-tool args into question groups. Returns `[]` when the
 * args carry nothing usable (partial/empty input).
 */
export function parseQuestionArgs(args: unknown): QuestionGroup[] {
  const a = asRecord(args)

  // Nested Claude-style: { questions: [ ... ] }
  if (Array.isArray(a.questions) && a.questions.length > 0) {
    const groups = a.questions
      .map(toGroup)
      .filter((g): g is QuestionGroup => g !== null)
    if (groups.length > 0) return groups
  }

  // Flat single question.
  const question = firstString(a, QUESTION_KEYS)
  const options = toOptionLabels(firstArray(a, OPTION_KEYS))
  if (question || options.length > 0) {
    const multiSelect = a.multiSelect === true || a.multiselect === true || a.allowMultiple === true
    return [{ question, options, multiSelect }]
  }

  return []
}

/** Whether free-text input is allowed; defaults to true unless explicitly false. */
export function parseAllowFreeText(args: unknown): boolean {
  return asRecord(args).allowFreeText !== false
}
