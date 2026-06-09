import { createHash } from "crypto"
import { log } from "../utils/outputChannel"

export interface StreamTraceContext {
  tabId?: string
  cliSessionId?: string
  clientRequestId?: string
  userMessageId?: string
  assistantMessageId?: string
  mode?: string
  agent?: string
  model?: string
  eventType?: string
  reason?: string
  promptText?: string
  [key: string]: unknown
}

function promptFingerprint(text: string | undefined): { promptLength?: number; promptHash?: string } {
  if (typeof text !== "string") return {}
  return {
    promptLength: text.length,
    promptHash: createHash("sha256").update(text).digest("hex").slice(0, 16),
  }
}

export function logStreamTrace(stage: string, context: StreamTraceContext): void {
  const { promptText, ...rest } = context
  log.debug(`[stream-trace] ${stage}`, {
    ...rest,
    ...promptFingerprint(promptText),
  })
}
