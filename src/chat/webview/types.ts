/** Webview type definitions */

export type MessageRole = "user" | "assistant" | "system"

export interface Block {
  type: string
  text?: string
  code?: string
  language?: string
  skillName?: string
  toolType?: string
  toolName?: string
  args?: string
  result?: string
  filePath?: string
  diffText?: string
  id?: string
  permissionId?: string
  [key: string]: unknown
}

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
  mode: string
  messages: ChatMessage[]
  isStreaming: boolean
  cost?: number
  tokenUsage?: { prompt: number; completion: number; total: number }
}

export interface WebviewState {
  sessions: Record<string, SessionState>
  activeSessionId: string | null
  nextSessionNum: number
  globalModel: string
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
}

export interface TabInfo {
  id: string
  name: string
  model?: string
  isStreaming: boolean
}
