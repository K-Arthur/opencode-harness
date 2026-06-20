/**
 * Pure, dependency-free turn grouping — extracted from renderer.ts.
 *
 * WHY THIS MODULE EXISTS:
 * The host (WebviewEventRouter) imports groupMessagesIntoTurns to build the
 * timeline. Previously it imported from renderer.ts, which transitively pulls
 * markdown-it, dompurify, entities, linkify-it, diff-match-patch, and the
 * markdown worker client into the extension host bundle — ~173kb of
 * webview-only deps that bloated extension.js to 860kb (limit: 660kb).
 *
 * This module imports ONLY the ChatMessage type. No rendering, no markdown,
 * no diffing. The host can import it without leaking webview deps.
 *
 * Audit: extension bundle size regression (§bundle-attribution).
 */
import type { ChatMessage } from "./types"

export interface TurnSummary {
  turnId: string
  userMessageId: string
  assistantMessageId: string
  snippet: string
  toolCount: number
  patchCount: number
  timestamp: number
  /** The model that produced this turn's assistant response (e.g.
   *  "anthropic/claude-sonnet-4-5"). Undefined when no assistant message
   *  exists for this turn or the message predates per-turn model stamping. */
  model?: string
}

export function groupMessagesIntoTurns(messages: ChatMessage[]): TurnSummary[] {
  const turns: TurnSummary[] = []
  let currentTurn: TurnSummary | null = null

  for (const msg of messages) {
    if (msg.role === "user") {
      if (currentTurn) turns.push(currentTurn)
      currentTurn = {
        turnId: `turn-${msg.id || crypto.randomUUID()}`,
        userMessageId: msg.id || "",
        assistantMessageId: "",
        snippet: extractSnippet(msg),
        toolCount: 0,
        patchCount: 0,
        timestamp: msg.timestamp || Date.now(),
      }
    } else if (msg.role === "assistant") {
      if (currentTurn) {
        currentTurn.assistantMessageId = msg.id || ""
        // Capture the model that generated this turn's assistant response.
        // Read from the message (stamped at stream start) so the timeline
        // reflects the actual producer even if the session's active model
        // changed later.
        if (!currentTurn.model && typeof msg.model === "string" && msg.model) {
          currentTurn.model = msg.model
        }
        // Count tool calls and diffs in this assistant message
        const blocks = msg.blocks || []
        currentTurn.toolCount += blocks.filter(b => b.type === "tool-call" || b.type === "tool_call" || b.type === "tool").length
        currentTurn.patchCount += blocks.filter(b => b.type === "diff" || b.type === "diff_block").length
        if (!currentTurn.snippet || currentTurn.snippet === "...") {
          currentTurn.snippet = extractSnippet(msg)
        }
      }
    }
  }

  if (currentTurn) turns.push(currentTurn)
  return turns
}

export function extractSnippet(msg: ChatMessage): string {
  const blocks = msg.blocks || []
  for (const b of blocks) {
    if (b.type === "text" && (b.text || b.content)) {
      const rawText = typeof b.text === "string" ? b.text : String(b.content ?? "")
      const text = rawText.trim().replace(/\n/g, " ")
      if (text.length > 0) return text.slice(0, 80) + (text.length > 80 ? "..." : "")
    }
    if (b.type === "tool-call" || b.type === "tool_call" || b.type === "tool") {
      const toolName = typeof b.tool === "string" ? b.tool : (b.name || b.toolName || "tool")
      return `Used ${toolName}`
    }
  }
  const loose = msg as unknown as {
    text?: unknown
    content?: unknown
    message?: unknown
    parts?: unknown[]
  }
  for (const value of [loose.text, loose.content, loose.message]) {
    if (typeof value === "string") {
      const text = value.trim().replace(/\n/g, " ")
      if (text.length > 0) return text.slice(0, 80) + (text.length > 80 ? "..." : "")
    }
  }
  if (Array.isArray(loose.parts)) {
    for (const part of loose.parts) {
      if (!part || typeof part !== "object") continue
      const p = part as { type?: unknown; text?: unknown; content?: unknown }
      if (p.type === "text" && (typeof p.text === "string" || typeof p.content === "string")) {
        const rawText = typeof p.text === "string" ? p.text : String(p.content ?? "")
        const text = rawText.trim().replace(/\n/g, " ")
        if (text.length > 0) return text.slice(0, 80) + (text.length > 80 ? "..." : "")
      }
    }
  }
  return msg.role === "user" ? "Sent a message" : "Response"
}
