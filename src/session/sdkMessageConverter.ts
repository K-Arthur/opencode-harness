import type { Message, Part } from "@opencode-ai/sdk"
import type { ChatMessage, Block } from "../types"

/**
 * SDK → CanonicalBlock converter. Single source of truth for projecting the
 * `@opencode-ai/sdk` `Part` union onto the extension's internal `Block`
 * model. Spec: docs/specs/2026-05-16-message-pipeline-alignment.md.
 *
 * Acceptance criterion A2: this is the ONLY file in `src/` that branches
 * on `part.type`. A meta-test enforces it.
 */

export function sdkMessageToChatMessage(
  info: Message,
  parts: readonly Part[],
  opts: { streaming?: boolean } = {},
): ChatMessage | null {
  const role = info.role === "user" || info.role === "assistant" ? info.role : null
  if (!role) return null

  const blocks = partsToBlocks(parts, opts)
  if (blocks.length === 0) return null

  const timestamp =
    "completed" in info.time && info.time.completed
      ? info.time.completed
      : info.time.created

  return {
    role,
    id: info.id,
    blocks,
    timestamp,
    sessionId: info.sessionID,
  }
}

/**
 * Map a single SDK Part to a canonical Block. Returns null for parts that
 * carry no user-visible content (synthetic/ignored text, empty reasoning).
 *
 * `opts.streaming` propagates the "this part is mid-stream" flag to the
 * block types that have a streaming UX (reasoning today; reserved for text
 * if/when we model it). Static historical loads pass `streaming: false`.
 */
export function partToBlock(part: Part, opts: { streaming?: boolean } = {}): Block | null {
  switch (part.type) {
    case "text": {
      if (part.synthetic || part.ignored) return null
      const text = part.text?.trim()
      if (!text) return null
      if (text.startsWith("[methodology]")) return null
      return { id: part.id, type: "text", text }
    }

    case "reasoning": {
      const text = part.text?.trim()
      if (!text) return null
      const block: Block = {
        id: part.id,
        type: "reasoning",
        text,
        streaming: opts.streaming === true,
        timeStart: part.time?.start ?? 0,
      }
      if (part.time?.end !== undefined) block.timeEnd = part.time.end
      return block
    }

    case "file": {
      // Carry every FilePart through. Renderers decide how to surface them
      // (inline image preview vs. attachment chip). Source path is retained
      // so the renderer can offer "open file" without going back to the
      // SDK.
      const sourcePath =
        part.source && "path" in part.source && typeof part.source.path === "string"
          ? part.source.path
          : undefined
      const block: Block = {
        id: part.id,
        type: "file",
        mime: part.mime,
        url: part.url,
      }
      if (part.filename) block.filename = part.filename
      if (sourcePath) block.sourcePath = sourcePath
      return block
    }

    case "tool": {
      const state = part.state
      const block: Block = {
        id: part.id,
        type: "tool",
        callID: part.callID,
        tool: part.tool,
        state: state.status,
      }
      // Every ToolState carries `input`; only completed/error carry result/error.
      if ("input" in state) block.args = state.input
      if (state.status === "completed") {
        block.result = state.output
        if (state.time?.start !== undefined && state.time?.end !== undefined) {
          block.durationMs = state.time.end - state.time.start
        }
      } else if (state.status === "error") {
        block.error = state.error
        if (state.time?.start !== undefined && state.time?.end !== undefined) {
          block.durationMs = state.time.end - state.time.start
        }
      }
      return block
    }

    case "step-start": {
      const block: Block = { id: part.id, type: "step-start" }
      if (part.snapshot) block.snapshot = part.snapshot
      return block
    }

    case "step-finish": {
      return {
        id: part.id,
        type: "step-finish",
        reason: part.reason,
        cost: part.cost,
        tokens: {
          input: part.tokens.input,
          output: part.tokens.output,
          reasoning: part.tokens.reasoning,
          cacheRead: part.tokens.cache.read,
          cacheWrite: part.tokens.cache.write,
        },
        ...(part.snapshot ? { snapshot: part.snapshot } : {}),
      }
    }

    case "snapshot": {
      return { id: part.id, type: "snapshot", snapshot: part.snapshot }
    }

    case "patch": {
      return {
        id: part.id,
        type: "patch",
        hash: part.hash,
        files: [...part.files],
      }
    }

    case "agent": {
      return { id: part.id, type: "agent", name: part.name }
    }

    case "retry": {
      // SDK ApiError carries data.message. Flatten to a single string for
      // the UI; full payload preserved on `errorDetail` for debugging.
      const errorMessage =
        part.error?.data && typeof part.error.data.message === "string"
          ? part.error.data.message
          : "retry"
      return {
        id: part.id,
        type: "retry",
        attempt: part.attempt,
        errorMessage,
        createdAt: part.time?.created ?? 0,
      }
    }

    case "compaction": {
      return { id: part.id, type: "compaction", auto: part.auto }
    }

    case "subtask": {
      return {
        id: part.id,
        type: "subtask",
        prompt: part.prompt,
        description: part.description,
        agent: part.agent,
      }
    }

    default: {
      // Exhaustiveness: TS will narrow `part` to `never` if every variant of
      // Part above is handled. New SDK part types surface here as a
      // compile error first, runtime null second.
      const _exhaustive: never = part
      void _exhaustive
      return null
    }
  }
}

/**
 * Convert an array of SDK Parts to canonical Blocks, dropping any that
 * `partToBlock` returns null for. Single iteration, no extra allocations
 * beyond the result array.
 */
export function partsToBlocks(parts: readonly Part[], opts: { streaming?: boolean } = {}): Block[] {
  const out: Block[] = []
  for (const part of parts) {
    const block = partToBlock(part, opts)
    if (block) out.push(block)
  }
  return out
}

/**
 * Build a canonical reasoning block from a live "thinking" SSE event.
 * The opencode server's `thinking` event is a parallel/synthesised channel
 * (not a true SDK ReasoningPart); this helper synthesises a minimal
 * ReasoningPart and routes it through `partToBlock` so the in-flight block
 * shape matches historical-load and reconnect-rebuild.
 *
 * Returns null for empty/whitespace-only text so the caller doesn't post a
 * vacuous block.
 */
export function reasoningEventToBlock(
  event: { text?: string; partId?: string; timeStart?: number },
): Block | null {
  const text = (event.text ?? "").trim()
  if (!text) return null
  const part = {
    id: event.partId ?? `thinking-${Date.now()}`,
    sessionID: "",
    messageID: "",
    type: "reasoning" as const,
    text,
    time: { start: event.timeStart ?? Date.now() },
  } as Part
  return partToBlock(part, { streaming: true })
}

/** Convert a list of SDK message+parts pairs to ChatMessages, preserving order. */
export function sdkMessagesToChatMessages(
  rows: ReadonlyArray<{ info: Message; parts: Part[] }>,
): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const row of rows) {
    const msg = sdkMessageToChatMessage(row.info, row.parts)
    if (msg) out.push(msg)
  }
  return out
}
