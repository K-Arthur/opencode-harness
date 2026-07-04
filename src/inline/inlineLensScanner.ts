/**
 * Pure symbol scanner for InlineActionProvider CodeLens.
 * Extracted so the regex scan can be tested without VS Code mocks and so the
 * provider can cache results by document version.
 */

export interface LensTarget {
  startOffset: number
  endOffset: number
}

const FUNC_REGEX =
  /(?:export\s+)?(?:async\s+)?function\s+(?:\w+)|(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?\(/g
const CLASS_REGEX = /(?:export\s+)?class\s+\w+/g

function findBodyEnd(text: string, searchFrom: number): number {
  const bodyStart = text.indexOf("{", searchFrom)
  if (bodyStart === -1) return searchFrom
  let depth = 0
  for (let i = bodyStart; i < text.length; i++) {
    const ch = text[i]
    if (ch === "{") depth++
    else if (ch === "}") {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return text.length
}

/**
 * Scan `text` and return start/end offsets for every function and class
 * declaration that should receive a CodeLens row.
 */
export function scanLensTargets(text: string): LensTarget[] {
  const targets: LensTarget[] = []

  const funcRegex = new RegExp(FUNC_REGEX.source, "g")
  let match
  while ((match = funcRegex.exec(text)) !== null) {
    const startOffset = match.index
    const endOffset = findBodyEnd(text, funcRegex.lastIndex)
    targets.push({ startOffset, endOffset })
  }

  const classRegex = new RegExp(CLASS_REGEX.source, "g")
  while ((match = classRegex.exec(text)) !== null) {
    const startOffset = match.index
    const endOffset = findBodyEnd(text, classRegex.lastIndex)
    targets.push({ startOffset, endOffset })
  }

  return targets
}
