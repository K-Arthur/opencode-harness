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

export function parseQuestionArgs(args: unknown): QuestionGroup[] {
  const a = asRecord(args)

  if (Array.isArray(a.questions) && a.questions.length > 0) {
    const groups = a.questions
      .map(toGroup)
      .filter((g): g is QuestionGroup => g !== null)
    if (groups.length > 0) return groups
  }

  const question = firstString(a, QUESTION_KEYS)
  const options = toOptionLabels(firstArray(a, OPTION_KEYS))
  if (question || options.length > 0) {
    const multiSelect = a.multiSelect === true || a.multiselect === true || a.allowMultiple === true
    return [{ question, options, multiSelect }]
  }

  return []
}

export function parseAllowFreeText(args: unknown): boolean {
  return asRecord(args).allowFreeText !== false
}
