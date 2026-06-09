import type { Block, ToolCallClass, ToolCallState, DiffHunk, DiffBlock, ThinkingBlock, ErrorBlock, ErrorActionButton } from "./types"

export function createTextBlock(text: string): Block {
  return { type: "text", text }
}

export function createToolCallBlock(args: {
  id: string
  name: string
  class: ToolCallClass
  state: ToolCallState
  args?: unknown
  result?: string
  error?: string
  durationMs?: number
}): Block {
  return {
    type: "tool-call",
    id: args.id,
    name: args.name,
    class: args.class,
    state: args.state,
    args: args.args,
    result: args.result,
    error: args.error,
    durationMs: args.durationMs,
  }
}

export function createSkillBadgeBlock(skillName: string): Block {
  return { type: "skill_badge", skillName }
}

export function createThinkingBlock(content: string, streaming: boolean, tokenCount?: number): Block {
  return { type: "thinking", content, streaming, tokenCount }
}

export function createErrorBlock(code: string, message: string, retryable: boolean, detail?: string, actionButtons?: ErrorActionButton[]): Block {
  return { type: "error", code, message, retryable, detail, actionButtons }
}

export function createImageBlock(data: string, mimeType: string): Block {
  return { type: "image", data, mimeType }
}

export function createTaskBannerBlock(status: string, text: string): Block {
  return { type: "task_banner", status, text }
}

export function createDiffBlock(args: {
  diffId: string
  path: string
  hunks: DiffHunk[]
  state: DiffBlock["state"]
  linesAdded: number
  linesRemoved: number
  revertable?: boolean
}): Block {
  return {
    type: "diff",
    diffId: args.diffId,
    path: args.path,
    hunks: args.hunks,
    state: args.state,
    linesAdded: args.linesAdded,
    linesRemoved: args.linesRemoved,
    revertable: args.revertable,
  }
}
