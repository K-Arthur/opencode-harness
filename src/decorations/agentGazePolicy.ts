/**
 * Pure policy module for AgentGazeService.
 *
 * Captures tool_start { id → filePath } and resolves on tool_end { id }.
 * tool_end events carry no file path, so the path must be remembered from
 * tool_start via the stable tool-call id field.
 */

export const MAX_POLICY_MAP_SIZE = 200

function extractFilePath(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined
  const obj = input as Record<string, unknown>
  const p = obj["path"] ?? obj["file_path"] ?? obj["filePath"] ?? obj["filename"]
  return typeof p === "string" ? p : undefined
}

/**
 * Record a tool_start event into the id→filePath map.
 * No-ops when id is falsy or input carries no recognisable file path.
 * Evicts the oldest entry when the map exceeds MAX_POLICY_MAP_SIZE.
 */
export function recordToolStart(
  map: Map<string, string>,
  id: string,
  input: unknown,
): void {
  if (!id) return
  const filePath = extractFilePath(input)
  if (!filePath) return
  if (map.size >= MAX_POLICY_MAP_SIZE) {
    const oldest = map.keys().next().value
    if (oldest !== undefined) map.delete(oldest)
  }
  map.set(id, filePath)
}

/**
 * Resolve and consume the file path for a tool_end event.
 * Returns undefined when the id was never recorded (e.g. read tools, no path).
 * Consuming the entry prevents stale decorations from a second call.
 */
export function resolveToolEndTarget(
  map: Map<string, string>,
  id: string,
): string | undefined {
  const path = map.get(id)
  if (path !== undefined) map.delete(id)
  return path
}
