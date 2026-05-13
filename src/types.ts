export type MessageRole = "user" | "assistant" | "system"

export interface ChatMessage {
  role: MessageRole
  id?: string
  blocks: Block[]
  timestamp?: number
  sessionId?: string
  tokenCount?: number
}

export interface Block {
  type: string
  [key: string]: unknown
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
