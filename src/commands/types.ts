export interface PromptSender {
  sendPromptToWebview(text: string, autoSend?: boolean): void
}
