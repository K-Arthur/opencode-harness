import type { ElementRefs } from "./dom"
import type { SendLogicDeps } from "./sendTypes"

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
  } = deps

  const active = stateManager.getActiveSession()
  if (!active) return
  const text = els.promptInput.value.trim()
  const attachments = attachmentManager.getAttachments()
  if (!text && attachments.length === 0) return
  attachmentManager.clearAttachments()
  renderAttachmentChips()
  // modeOverride is a one-shot (Cmd/Ctrl+Enter → interrupt) and must NOT mutate the
  // tab's persisted send-mode default; only the toggle (setSteerMode) does that.
  vscode.postMessage({
    type: "send_steer_prompt",
    text,
    sessionId: active.id,
    mode: modeOverride ?? getCurrentSteerModeFn(),
    ...(attachments.length > 0 ? { attachments } : {}),
  })
  els.promptInput.value = ""
  autoResizeTextarea()
  updateSendButtonFn()
}
