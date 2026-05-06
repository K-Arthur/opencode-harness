/**
 * Reject CSS values containing injection vectors.
 * Blocks: url(), expression(), @import, javascript:, behavior:, binding:,
 * and delimiter characters (; { }) that break out of declarations.
 * Allows: rgb(), hsl(), var(), calc(), hex colors, named colors, etc.
 */
export function sanitizeCssValue(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  // Block declaration-breaking sequences
  if (/;/.test(trimmed) || /\{/.test(trimmed) || /\}/.test(trimmed)) {
    return null
  }
  // Block CSS URL and function injection vectors
  // Does NOT block rgb(), hsl(), var(), calc() used for legitimate color values
  if (/(?:url|expression|javascript|@import|behavior|binding)\s*[\(\/\\:]/i.test(trimmed)) {
    return null
  }
  return trimmed
}
