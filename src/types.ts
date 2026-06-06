export type MessageRole = "user" | "assistant" | "system"

export interface ChatMessage {
  role: MessageRole
  id?: string
  blocks: Block[]
  timestamp?: number
  sessionId?: string
  tokenCount?: number
  /**
   * The session mode (plan / build / auto) when this message was produced.
   * Enables per-turn mode badges in session history (like Copilot Session
   * Insights) and mode-tracking in analytics.
   */
  mode?: string
}

export interface Block {
  type: string
  [key: string]: unknown
}

/**
 * Canonical discriminated-union projection of the SDK `Part` union onto the
 * extension's internal block model. This is the target shape produced by
 * `sdkMessageConverter.partToBlock`. Each variant keeps an `id` (mirroring
 * `part.id`) so streaming updates can locate the block to replace.
 *
 * Spec: docs/specs/2026-05-16-message-pipeline-alignment.md §5.1.
 *
 * Each variant intentionally permits `[key: string]: unknown` during the
 * transition: existing consumers read miscellaneous fields without
 * narrowing, and Layer 5's migration normalises the underlying shape so the
 * escape hatch can be tightened in v2.
 */
export type TokenBreakdown = {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

export type CanonicalToolState = "pending" | "running" | "completed" | "error"

export type CanonicalBlock =
  | {
      id: string
      type: "text"
      text: string
      synthetic?: boolean
    }
  | {
      id: string
      type: "reasoning"
      text: string
      streaming: boolean
      timeStart: number
      timeEnd?: number
      tokenCount?: number
    }
  | {
      id: string
      type: "file"
      mime: string
      url: string
      filename?: string
      sourcePath?: string
    }
  | {
      id: string
      type: "tool"
      callID: string
      tool: string
      state: CanonicalToolState
      args?: unknown
      result?: string
      error?: string
      durationMs?: number
    }
  | {
      id: string
      type: "step-start"
      snapshot?: string
    }
  | {
      id: string
      type: "step-finish"
      reason: string
      cost: number
      tokens: TokenBreakdown
      snapshot?: string
    }
  | {
      id: string
      type: "snapshot"
      snapshot: string
    }
  | {
      id: string
      type: "patch"
      hash: string
      files: string[]
    }
  | {
      id: string
      type: "agent"
      name: string
    }
  | {
      id: string
      type: "retry"
      attempt: number
      errorMessage: string
      createdAt: number
    }
  | {
      id: string
      type: "compaction"
      auto: boolean
    }
  | {
      id: string
      type: "subtask"
      prompt: string
      description: string
      agent: string
    }

export interface SdkMessageEvent {
  type: string
  properties?: Record<string, unknown>
}

export interface DiffChunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}

export interface Attachment {
  data: string
  mimeType: string
}

export interface SteerPrompt {
  id: string
  text: string
  attachments: Attachment[]
  mode: 'interrupt' | 'append' | 'queue'
  timestamp: number
  sessionId: string
}
