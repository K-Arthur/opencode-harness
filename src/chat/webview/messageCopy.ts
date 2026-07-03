/**
 * Whole-message copy control — lets users copy their own prompts and the
 * model's responses, like other chat clients.
 *
 * Lives in its own module because renderMessage (messageRenderer.ts) is a
 * complexity hotspot (cc=90): quality gate says extract, never enlarge.
 * Clipboard access is injectable so tests don't have to mock globals.
 */
import { COPY_SVG, CHECK_SVG } from "./icons"
import type { ChatMessage } from "./types"

export interface MessageCopyOptions {
  /** Clipboard writer — defaults to navigator.clipboard.writeText. */
  writeText?: (text: string) => Promise<void>
  /** How long the "copied" feedback state is shown. */
  restoreDelayMs?: number
}

/**
 * The copyable representation of a message: its visible prose (text blocks)
 * joined by blank lines. Tool calls, diffs, and other structured blocks are
 * excluded — matching what the user reads in the bubble.
 */
export function extractMessageCopyText(msg: Pick<ChatMessage, "blocks">): string {
  const blocks = Array.isArray(msg.blocks) ? msg.blocks : []
  return blocks
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => (b.text as string).trim())
    .filter((t) => t.length > 0)
    .join("\n\n")
}

const COPIED_LABEL = "Copied"
const IDLE_LABEL = "Copy message"

/**
 * Legacy copy path for environments where the async clipboard API is
 * unavailable (headless test browsers; hardened webviews). Uses a hidden
 * textarea + execCommand inside the click's user gesture.
 */
function fallbackExecCopy(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ta = document.createElement("textarea")
    ta.value = text
    ta.setAttribute("readonly", "")
    ta.style.position = "fixed"
    ta.style.opacity = "0"
    document.body.appendChild(ta)
    ta.select()
    try {
      const ok = document.execCommand("copy")
      ta.remove()
      if (ok) resolve()
      else reject(new Error("execCommand copy failed"))
    } catch (err) {
      ta.remove()
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

function defaultWriteText(text: string): Promise<void> {
  try {
    const clip = typeof navigator !== "undefined" ? navigator.clipboard : undefined
    if (clip && typeof clip.writeText === "function") {
      // Even with the API present the write can reject (permissions);
      // chain into the legacy path instead of failing the copy outright.
      return clip.writeText(text).catch(() => fallbackExecCopy(text))
    }
  } catch {
    // navigator.clipboard access itself can throw in locked-down contexts
  }
  return fallbackExecCopy(text)
}

/**
 * Build the header copy button for a message, or null when the message has
 * no copyable text (no dead buttons in the UI). Styling mirrors the other
 * header actions (edit/revert/regenerate/fork) via .message-copy-btn.
 */
export function createMessageCopyButton(
  msg: Pick<ChatMessage, "blocks">,
  opts: MessageCopyOptions = {},
): HTMLButtonElement | null {
  const text = extractMessageCopyText(msg)
  if (!text) return null

  const writeText = opts.writeText ?? defaultWriteText
  const restoreDelayMs = opts.restoreDelayMs ?? 1500

  const btn = document.createElement("button")
  btn.className = "message-copy-btn"
  btn.setAttribute("aria-label", IDLE_LABEL)
  btn.title = IDLE_LABEL
  btn.innerHTML = COPY_SVG

  let restoreTimer: ReturnType<typeof setTimeout> | undefined
  btn.addEventListener("click", () => {
    void writeText(text)
      .then(() => {
        btn.classList.add("copied")
        btn.innerHTML = CHECK_SVG
        btn.title = COPIED_LABEL
        btn.setAttribute("aria-label", COPIED_LABEL)
        if (restoreTimer) clearTimeout(restoreTimer)
        restoreTimer = setTimeout(() => {
          btn.classList.remove("copied")
          btn.innerHTML = COPY_SVG
          btn.title = IDLE_LABEL
          btn.setAttribute("aria-label", IDLE_LABEL)
        }, restoreDelayMs)
      })
      .catch(() => {
        // Clipboard denied/unavailable: stay in the idle state rather than
        // claiming success. The webview clipboard API is available in VS
        // Code, so this is a defensive edge, not an expected path.
      })
  })
  return btn
}
