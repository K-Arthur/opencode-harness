import type { ElementRefs } from "./dom"
import type { SendLogicDeps } from "./sendTypes"
import type { ChatMessage } from "./types"
import { generateUserMessageId } from "../../session/messageId"

export function getCurrentSteerMode(
  stateManager: SendLogicDeps["stateManager"],
): "interrupt" | "queue" {
  const active = stateManager.getActiveSession()
  // Queue is the safe default while streaming (never aborts, fully visible/editable).
  // Interrupt is opt-in (the toggle, or a one-shot Cmd/Ctrl+Enter).
  return active?.steerMode === "interrupt" ? "interrupt" : "queue"
}

export function setSteerMode(
  mode: "interrupt" | "queue",
  stateManager: SendLogicDeps["stateManager"],
  els: ElementRefs,
): void {
  const active = stateManager.getActiveSession()
  if (active && stateManager.setSessionSteerMode) {
    stateManager.setSessionSteerMode(active.id, mode)
  }
  document.querySelectorAll<HTMLElement>(".steer-mode-btn").forEach((btn) => {
    const isActive = btn.dataset.mode === mode
    btn.classList.toggle("active", isActive)
    btn.setAttribute("aria-checked", String(isActive))
  })
  const btn = document.getElementById(`steer-mode-${mode}`)
  if (btn) {
    btn.classList.add("active")
    btn.setAttribute("aria-checked", "true")
  }
  els.inputArea.classList.remove("steer-interrupt", "steer-queue")
  els.inputArea.classList.add(`steer-${mode}`)
}

export function syncSteerModeUI(
  stateManager: SendLogicDeps["stateManager"],
  els: ElementRefs,
): void {
  setSteerMode(getCurrentSteerMode(stateManager), stateManager, els)
}

export function getSteerMode(
  stateManager: SendLogicDeps["stateManager"],
): "interrupt" | "queue" {
  return getCurrentSteerMode(stateManager)
}

export function sendSteerPrompt(
  modeOverride: "interrupt" | "queue" | undefined,
  deps: SendLogicDeps,
  getCurrentSteerModeFn: () => "interrupt" | "queue",
  updateSendButtonFn: () => void,
): void {
  const {
    els,
    stateManager,
    vscode,
    attachmentManager,
    renderAttachmentChips,
    autoResizeTextarea,
    addMessage,
  } = deps

  const active = stateManager.getActiveSession()
  if (!active) return
  const text = els.promptInput.value.trim()
  const attachments = attachmentManager.getAttachments()
  if (!text && attachments.length === 0) return

  // Only image attachments are sent to the server as base64. Document
  // attachments are decoded and injected into the prompt text to avoid
  // "media type not supported" errors from the opencode server.
  // SVG (image/svg+xml) is treated as a document: the server's raster decoder
  // (Image.normalize) cannot decode SVG, so we inject the XML text instead.
  const isSvg = (a: { mimeType: string }) => a.mimeType === "image/svg+xml"
  const imageAttachments = attachments.filter((a) => a.mimeType.startsWith("image/") && !isSvg(a))
  const documentAttachments = attachments.filter((a) => !a.mimeType.startsWith("image/") || isSvg(a))

  let sendText = text
  for (const doc of documentAttachments) {
    try {
      const decoded = atob(doc.data)
      const filename = doc.filename || "document"
      const langTag = filename.split(".").pop() || ""
      sendText += `\n\n<file name="${filename}">\n\`\`\`${langTag}\n${decoded}\n\`\`\`\n</file>`
    } catch {
      // If base64 decoding fails, skip silently
    }
  }

  // Build and persist the user message optimistically in the webview's local state,
  // matching the normal send path (sendMessage.ts:237-254). The same id is sent to
  // the host so the host-side SessionStore entry (added by SteerPromptHandler) uses
  // the same id, preventing duplicates on drain.
  const userMessageId = generateUserMessageId()
  const msgObj: ChatMessage = {
    role: "user",
    id: userMessageId,
    blocks: [
      ...(sendText ? [{ type: "text" as const, text: sendText }] : []),
      ...imageAttachments.map((a) => ({ type: "image" as const, data: a.data, mimeType: a.mimeType })),
    ],
    timestamp: Date.now(),
    sessionId: active.id,
  }
  addMessage(active.id, msgObj)

  attachmentManager.clearAttachments()
  renderAttachmentChips()
  // modeOverride is a one-shot (Cmd/Ctrl+Enter → interrupt) and must NOT mutate the
  // tab's persisted send-mode default; only the toggle (setSteerMode) does that.
  vscode.postMessage({
    type: "send_steer_prompt",
    text: sendText,
    sessionId: active.id,
    mode: modeOverride ?? getCurrentSteerModeFn(),
    userMessageId,
    ...(imageAttachments.length > 0 ? { attachments: imageAttachments } : {}),
  })
  els.promptInput.value = ""
  autoResizeTextarea()
  updateSendButtonFn()
}
