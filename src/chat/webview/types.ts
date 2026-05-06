/** Webview type definitions */

export type MessageRole = "user" | "assistant" | "system"

// ---------------------------------------------------------------------------
// New discriminated block types (preferred for new code)
// ---------------------------------------------------------------------------

export type ToolCallClass = 'read' | 'write' | 'exec' | 'error' | 'meta'
export type ToolCallState = 'pending' | 'running' | 'result'

export interface ToolCallBlock {
  [key: string]: unknown
  type: 'tool-call'
  id: string
  name: string
  class: ToolCallClass
  state: ToolCallState
  args?: unknown
  result?: string
  error?: string
  durationMs?: number
}

export interface DiffHunk {
  oldStart: number
  newStart: number
  lines: DiffLine[]
}

export interface DiffLine {
  type: 'added' | 'removed' | 'context'
  oldLine?: number
  newLine?: number
  content: string
}

export interface DiffBlock {
  [key: string]: unknown
  type: 'diff'
  diffId: string
  path: string
  hunks: DiffHunk[]
  state: 'pending' | 'accepted' | 'discarded'
  linesAdded: number
  linesRemoved: number
}

export interface ThinkingBlock {
  [key: string]: unknown
  type: 'thinking'
  content: string
  tokenCount?: number
  streaming: boolean
}

export interface ErrorBlock {
  [key: string]: unknown
  type: 'error'
  code: string
  message: string
  detail?: string
  retryable: boolean
}

// Legacy block type — kept for backward compatibility with existing renders
export interface LegacyBlock {
  type: string
  text?: string
  code?: string
  language?: string
  skillName?: string
  toolType?: string
  toolName?: string
  args?: unknown
  result?: string
  filePath?: string
  diffText?: string
  id?: string
  permissionId?: string
  // New optional fields that may appear on legacy blocks
  class?: ToolCallClass
  state?: string
  name?: string
  diffId?: string
  path?: string
  hunks?: DiffHunk[]
  linesAdded?: number
  linesRemoved?: number
  content?: string
  tokenCount?: number
  streaming?: boolean
  detail?: string
  retryable?: boolean
  [key: string]: unknown
}

// Legacy block type — kept for backward compatibility and as the canonical Block type.
// All new renderers use type guards (isToolCallBlock, etc.) to narrow to specific types
// when needed, but generic block property access uses LegacyBlock.
export type Block = LegacyBlock

export interface ChatMessage {
  role: MessageRole
  id?: string
  blocks: Block[]
  timestamp?: number
  sessionId?: string
}

export interface SessionState {
  id: string
  name: string
  model: string
  variant?: string
  mode: string
  messages: ChatMessage[]
  isStreaming: boolean
  cost?: number
  tokenUsage?: { prompt: number; completion: number; total: number }
  lastActiveAt?: number
}

export interface WebviewState {
  sessions: Record<string, SessionState>
  sessionOrder: string[]
  activeSessionId: string | null
  nextSessionNum: number
  globalModel: string
  globalVariant?: string
  initialized?: boolean
  disabledModels?: string[]
}

export interface MentionItem {
  prefix?: string
  display?: string
  description?: string
  icon?: string
}

export interface SessionSummary {
  id: string
  title?: string
  time?: number
  messageCount?: number
  cost?: number
}

export interface ContextChip {
  label?: string
  removable?: boolean
  onRemove?: () => void
}

export interface ContextUsage {
  tokens: number
  total: number
  percentage?: number
}

export interface HostMessage {
  type: string
  message?: ChatMessage
  messageId?: string
  text?: string
  items?: MentionItem[]
  sessions?: SessionSummary[]
  status?: string
  vars?: Record<string, string>
  model?: string
  resetAt?: string
  blockId?: string
  ok?: boolean
  [key: string]: unknown
}

export interface VsCodeApi {
  postMessage(message: Record<string, unknown>): void
  getState(): WebviewState | undefined
  setState(state: WebviewState): void
}

export interface ModelInfo {
  id: string
  provider: string
  displayName: string
  enabled?: boolean
  supportsVariants?: boolean
}

export interface TabInfo {
  id: string
  name: string
  model?: string
  isStreaming: boolean
}
