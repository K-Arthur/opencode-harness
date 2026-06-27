/**
 * Extract a human-readable error detail string from a v2 SDK response error.
 *
 * The v2 SDK returns `error` as an object on non-2xx responses. When the
 * server returns a bare empty object (`{}`) — common for 500s with no body —
 * `JSON.stringify({})` produces `"{}"`, which is useless to the user. This
 * helper falls back to the HTTP status code when the error object carries no
 * message or fields.
 *
 * @param error - The `resp.error` field from a v2 SDK response
 * @param status - The HTTP status code from `resp.response?.status`
 * @returns A string suitable for inclusion in a thrown Error message
 */
export function v2ErrorDetail(
  error: unknown,
  status?: number,
): string {
  if (!error) return ""
  const err = error as Record<string, unknown>
  if (typeof err.message === "string" && err.message.length > 0) return err.message
  const keys = Object.keys(err)
  if (keys.length > 0) return JSON.stringify(err)
  return `HTTP ${status ?? "unknown"}`
}
