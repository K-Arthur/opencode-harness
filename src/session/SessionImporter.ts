/**
 * Session import (P3.3 — audit §11).
 *
 * Mirrors the export format from SessionExporter.json():
 *   { id, name, createdAt, lastActiveAt, model, cost, messages: [{ id, role, timestamp, blocks }] }
 *
 * The pure `parseSessionExport` function maps the export JSON to an
 * `OpenCodeSession` ready for `SessionStore`. Imports are local copies —
 * a fresh session id is minted so the imported session doesn't collide
 * with the original on the server.
 *
 * The `importFromFile` method is a thin VS Code file-dialog adapter that
 * reads the file and delegates to `parseSessionExport`.
 */
import type { OpenCodeSession } from "./SessionStore"
import type { ChatMessage, Block } from "../types"

/** Shape of the JSON written by SessionExporter.json(). */
export interface SessionExportJson {
  id: string
  name: string
  createdAt: number
  lastActiveAt: number
  model: string
  cost: number
  messages: Array<{
    id?: string
    role: string
    timestamp?: number
    blocks: Array<Record<string, unknown>>
  }>
}

/**
 * Parse a session export JSON object into an `OpenCodeSession`.
 *
 * Mints a fresh session id (imports are local copies, not server sessions).
 * Validates the structure, throwing on malformed input. Unknown block types
 * pass through — the export format is forward-compatible.
 */
export function parseSessionExport(data: SessionExportJson): OpenCodeSession {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid session export: expected a JSON object")
  }
  if (!Array.isArray(data.messages)) {
    throw new Error("Invalid session export: messages must be an array")
  }
  if (data.messages.length === 0) {
    throw new Error("Invalid session export: no messages to import")
  }

  const messages: ChatMessage[] = data.messages.map((msg, i) => {
    if (!msg.role || typeof msg.role !== "string") {
      throw new Error(`Invalid session export: message ${i} has no role`)
    }
    const blocks: Block[] = (msg.blocks || []).map(mapExportBlock)
    return {
      id: msg.id || `imported-msg-${i}`,
      role: msg.role as ChatMessage["role"],
      timestamp: msg.timestamp || Date.now(),
      blocks,
    }
  })

  return {
    id: `imported-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: data.name || "Imported Session",
    createdAt: data.createdAt || Date.now(),
    lastActiveAt: data.lastActiveAt || Date.now(),
    model: data.model || "",
    mode: "build",
    cost: data.cost || 0,
    messages,
    tokenUsage: { prompt: 0, completion: 0, total: 0 },
  }
}

/**
 * Map a single block from the export format to a renderable `Block`.
 *
 * The export writes { type: "text", text }, { type: "tool_call", toolName, args, result },
 * and { type: "diff", fileName, diffText }. Unknown block types pass through
 * unchanged (forward-compatible).
 */
function mapExportBlock(raw: Record<string, unknown>): Block {
  const type = typeof raw.type === "string" ? raw.type : "unknown"
  // The export uses "tool_call" / "diff"; the webview LegacyBlock uses the
  // same field names (toolName, args, result, fileName, diffText). Pass the
  // raw object through — LegacyBlock has `[key: string]: unknown` so all
  // fields are preserved.
  return { ...raw, type } as Block
}

/**
 * VS Code file-dialog adapter: prompt the user to select a JSON file,
 * read it, parse it, and return an `OpenCodeSession`.
 */
export async function importFromFile(): Promise<OpenCodeSession | undefined> {
  const vscode = await import("vscode")
  const uri = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { "JSON": ["json"], "All Files": ["*"] },
    title: "Import Session from JSON",
  })
  if (!uri || uri.length === 0) return undefined

  const bytes = await vscode.workspace.fs.readFile(uri[0]!)
  const text = new TextDecoder().decode(bytes)
  const data = JSON.parse(text) as SessionExportJson
  const session = parseSessionExport(data)

  vscode.window.showInformationMessage(`Imported session "${session.name}" with ${session.messages.length} messages`)
  return session
}
