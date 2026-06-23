import * as jsonc from "jsonc-parser"

export interface JsoncParseResult {
  config: unknown
  errors: JsoncParseError[]
}

export interface JsoncParseError {
  offset: number
  length: number
  message: string
}

/**
 * Safely parse a JSONC (JSON with Comments) string into a config object.
 *
 * Handles `//` line comments, `/* *\/` block comments, trailing commas, and
 * BOM prefixes. Returns `{ config: {}, errors: [] }` for empty/whitespace/
 * comments-only input. Collects parse errors instead of throwing, so callers
 * can log them and fall back gracefully.
 *
 * @param content - JSONC string to parse (null/undefined → empty config)
 * @returns Parsed config object and any parse errors
 */
export function parseJsonc(content: string): JsoncParseResult {
  if (content === null || content === undefined) {
    return { config: {}, errors: [] }
  }

  const trimmed = content.trim()
  if (trimmed.length === 0) {
    return { config: {}, errors: [] }
  }

  const errors: jsonc.ParseError[] = []
  const parsed = jsonc.parse(trimmed, errors, { allowTrailingComma: true, disallowComments: false })

  if (parsed === null || parsed === undefined) {
    if (errors.length > 0) {
      return {
        config: {},
        errors: errors.map((e) => ({
          offset: e.offset,
          length: e.length,
          message: jsonc.printParseErrorCode(e.error),
        })),
      }
    }
    return { config: {}, errors: [] }
  }

  if (errors.length > 0) {
    return {
      config: {},
      errors: errors.map((e) => ({
        offset: e.offset,
        length: e.length,
        message: jsonc.printParseErrorCode(e.error),
      })),
    }
  }

  return { config: parsed, errors: [] }
}
