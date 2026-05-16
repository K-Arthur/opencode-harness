import { SdkEventLike, NormalizedOpencodeEvent, NormalizerContext, EventHandler } from "./types"
import { extractSessionStatusError, mapSessionStatusError } from "../../chat/webview/sessionStatusMapper"

export class SessionStatusHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    return eventType === "session.status"
  }

  handle(event: SdkEventLike, context: NormalizerContext): NormalizedOpencodeEvent[] {
    const out: NormalizedOpencodeEvent[] = []
    const data = event.properties as { sessionID?: string; status?: unknown } | undefined
    
    // Extract and map session status error to user-friendly context
    const sessionError = extractSessionStatusError(data)
    const errorContext = sessionError ? mapSessionStatusError(sessionError) : undefined
    
    out.push({
      type: "session_status",
      sessionId: data?.sessionID,
      data: { 
        status: data?.status,
        errorContext,
      },
    })
    return out
  }
}

export class SessionErrorHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    return eventType === "session.error"
  }

  handle(event: SdkEventLike, context: NormalizerContext): NormalizedOpencodeEvent[] {
    const out: NormalizedOpencodeEvent[] = []
    const data = event.properties as { sessionID?: string; error?: unknown } | undefined
    out.push({
      type: "server_error",
      sessionId: data?.sessionID,
      data: { error: data?.error },
    })
    return out
  }
}

export class SessionIdleHandler implements EventHandler {
  canHandle(eventType: string): boolean {
    return eventType === "session.idle"
  }

  handle(event: SdkEventLike, context: NormalizerContext): NormalizedOpencodeEvent[] {
    const out: NormalizedOpencodeEvent[] = []
    const sessionId = (event.properties as { sessionID?: string } | undefined)?.sessionID
    out.push({
      type: "session_status",
      sessionId,
      data: { status: { type: "idle" } },
    })
    return out
  }
}
