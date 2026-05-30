import * as vscode from "vscode"
import { mapToolType as mapToolTypePure, toUserErrorMessage } from "./chatUtils"

export interface MessagePostDeps {
  getWebview: () => vscode.Webview | undefined
  log: typeof import("../utils/outputChannel").log
  onRejected?: (msg: Record<string, unknown>) => void
}

export class MessagePostService {
  constructor(private deps: MessagePostDeps) {}

  postMessage(msg: Record<string, unknown>): void {
    this.postRawMessage(msg)
  }

  postRawMessage(msg: Record<string, unknown>): Thenable<boolean> | undefined {
    const webview = this.deps.getWebview()
    if (!webview) return undefined
    try {
      const result = webview.postMessage(msg)
      result.then(
        ok => {
          if (!ok) this.deps.onRejected?.(msg)
        },
        () => {},
      )
      return result
    } catch (err) {
      this.deps.log.error("Failed to post message to webview", err)
      this.deps.onRejected?.(msg)
      return undefined
    }
  }

  postRequestError(message: string, sessionId?: string): void {
    const webview = this.deps.getWebview()
    if (!webview) return
    webview.postMessage({
      type: "request_error",
      message: toUserErrorMessage(message),
      sessionId,
    })
  }

  mapToolType(tool: string): string {
    return mapToolTypePure(tool)
  }
}
