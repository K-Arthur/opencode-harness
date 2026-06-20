/**
 * Terminal panel — live PTY terminal visibility (audit §14.1/§14.2).
 *
 * Surfaces every PTY session the opencode server creates as an inspectable
 * card: command, status, exit code, runtime, and a bounded live stdout view
 * with a Cancel (kill) button. Folds `pty.*` lifecycle events + `pty_output`
 * byte chunks into renderable state via the pure `ptyReducer` from
 * `ptyModel.ts`.
 *
 * PTY terminals are a global resource (not per-chat-session), so this panel
 * shows all of them regardless of which chat tab is active. When the server
 * doesn't support the PTY API (`terminal_capability.ptySupported === false`),
 * the panel stays hidden and the Tasks panel's polling approximation remains
 * the terminal surface (constitution rule #6: graceful degradation).
 *
 * Architecture mirrors `tasks-panel.ts` / `todos-panel.ts`:
 * `setupTerminalPanel(els, deps)` → API, `terminal-panel hidden` region,
 * Escape-to-close, empty state, keyboard navigation.
 */
import type { ElementRefs } from "./dom"
import {
  ptyReducer,
  type PtyTerminalState,
  type PtyInfo,
  type PtyAction,
} from "../../terminal/ptyModel"

export type TerminalPanelEls = Pick<ElementRefs, "terminalPanel" | "terminalList" | "terminalCloseBtn"> & {
  terminalToggleBtn?: HTMLElement | null
}

export interface TerminalPanelDeps {
  postMessage: (msg: Record<string, unknown>) => void
  onPanelClose?: () => void
}

export interface TerminalPanelApi {
  /** Set whether the server supports the PTY API. When false, the panel stays hidden. */
  setCapability: (ptySupported: boolean) => void
  /** Hydrate the panel with an initial set of PTY sessions (from `pty_sessions`). */
  setSessions: (sessions: Array<{ id: string; title: string; command: string; status: string; pid: number; exitCode?: number }>) => void
  /** Fold a PTY lifecycle event (`pty.created`/`updated`/`exited`/`deleted`) into state. */
  applyLifecycleEvent: (event: { type: string; ptyId?: string; pty?: Record<string, unknown> }) => void
  /** Append a stdout chunk for a specific PTY. */
  appendOutput: (ptyId: string, data: string) => void
  /** Mark a PTY as connected (WebSocket established). */
  markConnected: (ptyId: string) => void
  /** Mark a PTY as cancelled (removed). */
  markCancelled: (ptyId: string) => void
  /** Show an error for a specific PTY. */
  showError: (ptyId: string, error: string) => void
  open: () => void
  close: () => void
  toggle: () => void
  isOpen: () => boolean
  dispose: () => void
}

const STATUS_LABEL: Record<string, string> = {
  running: "Running",
  exited: "Exited",
}

function formatRuntime(startedAt: number, endedAt?: number): string {
  const end = endedAt ?? Date.now()
  const ms = Math.max(0, end - startedAt)
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  const m = Math.floor(s / 60)
  const rem = Math.floor(s % 60)
  return `${m}m ${rem}s`
}

function mapInfoToPtyInfo(raw: Record<string, unknown>): PtyInfo {
  return {
    id: String(raw.id ?? ""),
    title: String(raw.title ?? ""),
    command: String(raw.command ?? ""),
    args: Array.isArray(raw.args) ? (raw.args as string[]).map(String) : [],
    cwd: String(raw.cwd ?? ""),
    status: raw.status === "exited" ? "exited" : "running",
    pid: Number(raw.pid ?? 0),
  }
}

export function setupTerminalPanel(els: TerminalPanelEls, deps: TerminalPanelDeps): TerminalPanelApi | undefined {
  const panel = els.terminalPanel
  const list = els.terminalList
  const closeBtn = els.terminalCloseBtn
  const toggleBtn = els.terminalToggleBtn ?? null
  if (!panel || !list) {
    console.warn("Terminal panel elements not found")
    return undefined
  }

  let state = new Map<string, PtyTerminalState>()
  let connected = new Set<string>()
  let errors = new Map<string, string>()
  let ptySupported = false
  let disposed = false
  let runtimeTimer: ReturnType<typeof setInterval> | undefined

  // Refresh running-session runtimes every 1s.
  runtimeTimer = setInterval(() => {
    if (disposed) return
    let hasRunning = false
    for (const s of state.values()) {
      if (s.status === "running") { hasRunning = true; break }
    }
    if (!hasRunning) return
    render()
  }, 1000)

  function render(): void {
    if (disposed) return
    list.innerHTML = ""

    if (state.size === 0) {
      const empty = document.createElement("div")
      empty.className = "terminal-empty"
      empty.textContent = ptySupported ? "No active terminal sessions." : "Terminal not available on this server."
      list.appendChild(empty)
      return
    }

    const sorted = Array.from(state.values()).sort((a, b) => a.startedAt - b.startedAt)
    for (const s of sorted) {
      list.appendChild(renderCard(s))
    }
  }

  function renderCard(s: PtyTerminalState): HTMLElement {
    const card = document.createElement("div")
    card.className = `terminal-card terminal-card--${s.status}`
    card.dataset.ptyId = s.id

    const header = document.createElement("div")
    header.className = "terminal-card-header"

    const statusDot = document.createElement("span")
    statusDot.className = `terminal-status-dot terminal-status-dot--${s.status}`
    statusDot.setAttribute("aria-hidden", "true")
    header.appendChild(statusDot)

    const title = document.createElement("span")
    title.className = "terminal-card-title"
    title.textContent = s.command || s.title || s.id
    header.appendChild(title)

    const statusLabel = document.createElement("span")
    statusLabel.className = "terminal-card-status"
    statusLabel.textContent = STATUS_LABEL[s.status] ?? s.status
    header.appendChild(statusLabel)

    if (s.status === "exited" && s.exitCode !== undefined) {
      const exitBadge = document.createElement("span")
      exitBadge.className = `terminal-card-exit terminal-card-exit--${s.exitCode === 0 ? "success" : "error"}`
      exitBadge.textContent = `exit ${s.exitCode}`
      header.appendChild(exitBadge)
    }

    if (s.status === "running") {
      const runtime = document.createElement("span")
      runtime.className = "terminal-card-runtime"
      runtime.textContent = formatRuntime(s.startedAt)
      header.appendChild(runtime)
    }

    if (s.status === "running") {
      const cancelBtn = document.createElement("button")
      cancelBtn.className = "terminal-card-cancel"
      cancelBtn.type = "button"
      cancelBtn.textContent = "Cancel"
      cancelBtn.setAttribute("aria-label", `Cancel terminal ${s.id}`)
      cancelBtn.addEventListener("click", () => {
        deps.postMessage({ type: "pty_cancel", ptyId: s.id })
      })
      header.appendChild(cancelBtn)
    }

    card.appendChild(header)

    // Output view (bounded). Show plaintext; ANSI stripping is handled at the
    // byte level by the host (PtyOutputEvent.type). For raw bytes we just
    // render as text with escaped HTML.
    const output = document.createElement("pre")
    output.className = "terminal-card-output"
    output.setAttribute("aria-label", `Terminal output for ${s.id}`)
    const outputText = s.output.slice(-10_000) // cap render to last 10k chars
    output.textContent = outputText
    card.appendChild(output)

    // Auto-scroll output to bottom
    requestAnimationFrame(() => {
      output.scrollTop = output.scrollHeight
    })

    const err = errors.get(s.id)
    if (err) {
      const errEl = document.createElement("div")
      errEl.className = "terminal-card-error"
      errEl.textContent = err
      card.appendChild(errEl)
    }

    return card
  }

  function open(): void {
    panel.classList.remove("hidden")
    toggleBtn?.setAttribute("aria-expanded", "true")
    // Connect to all running PTYs that aren't connected yet, so output streams.
    for (const s of state.values()) {
      if (s.status === "running" && !connected.has(s.id)) {
        deps.postMessage({ type: "pty_connect", ptyId: s.id })
      }
    }
  }

  function close(): void {
    panel.classList.add("hidden")
    toggleBtn?.setAttribute("aria-expanded", "false")
    deps.onPanelClose?.()
  }

  function toggle(): void {
    if (isOpen()) close()
    else open()
  }

  function isOpen(): boolean {
    return !panel.classList.contains("hidden")
  }

  // Close button + Escape
  closeBtn?.addEventListener("click", close)

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape" && isOpen()) {
      e.stopPropagation()
      close()
    }
  }
  panel.addEventListener("keydown", onKeydown)

  function setCapability(supported: boolean): void {
    ptySupported = supported
    if (!supported) {
      close()
      toggleBtn?.classList.add("hidden")
    } else {
      toggleBtn?.classList.remove("hidden")
    }
    render()
  }

  function setSessions(sessions: Array<{ id: string; title: string; command: string; status: string; pid: number; exitCode?: number }>): void {
    state = new Map()
    for (const s of sessions) {
      const info: PtyInfo = {
        id: s.id,
        title: s.title,
        command: s.command,
        args: [],
        cwd: "",
        status: s.status === "exited" ? "exited" : "running",
        pid: s.pid,
      }
      state = ptyReducer(state, { kind: "created", info, at: Date.now() })
      if (s.status === "exited" && s.exitCode !== undefined) {
        state = ptyReducer(state, { kind: "exited", id: s.id, exitCode: s.exitCode, at: Date.now() })
      }
    }
    render()
  }

  function applyLifecycleEvent(event: { type: string; ptyId?: string; pty?: Record<string, unknown> }): void {
    const ptyId = event.ptyId
    if (!ptyId) return
    const pty = event.pty
    const action: PtyAction | null = (() => {
      switch (event.type) {
        case "pty_created":
          if (!pty) return null
          return { kind: "created", info: mapInfoToPtyInfo(pty), at: Date.now() }
        case "pty_updated":
          if (!pty) return null
          return { kind: "updated", info: mapInfoToPtyInfo(pty) }
        case "pty_exited":
          if (!pty) return null
          return { kind: "exited", id: ptyId, exitCode: Number(pty.exitCode ?? 1), at: Date.now() }
        case "pty_deleted":
          return { kind: "removed", id: ptyId }
        default:
          return null
      }
    })()
    if (!action) return
    state = ptyReducer(state, action)
    if (event.type === "pty_deleted") {
      connected.delete(ptyId)
      errors.delete(ptyId)
    }
    render()
  }

  function appendOutput(ptyId: string, data: string): void {
    state = ptyReducer(state, { kind: "chunk", id: ptyId, data })
    // Only re-render if the panel is open and this PTY's card is visible
    if (isOpen()) {
      const card = list.querySelector<HTMLElement>(`[data-pty-id="${cssEscape(ptyId)}"]`)
      if (card) {
        const output = card.querySelector<HTMLElement>(".terminal-card-output")
        if (output) {
          const s = state.get(ptyId)
          if (s) {
            output.textContent = s.output.slice(-10_000)
            output.scrollTop = output.scrollHeight
          }
        }
      }
    }
  }

  function markConnected(ptyId: string): void {
    connected.add(ptyId)
    errors.delete(ptyId)
  }

  function markCancelled(ptyId: string): void {
    connected.delete(ptyId)
    errors.delete(ptyId)
  }

  function showError(ptyId: string, error: string): void {
    errors.set(ptyId, error)
    render()
  }

  function dispose(): void {
    disposed = true
    if (runtimeTimer) clearInterval(runtimeTimer)
    closeBtn?.removeEventListener("click", close)
    panel.removeEventListener("keydown", onKeydown)
  }

  return {
    setCapability,
    setSessions,
    applyLifecycleEvent,
    appendOutput,
    markConnected,
    markCancelled,
    showError,
    open,
    close,
    toggle,
    isOpen,
    dispose,
  }
}

/** Escape a string for use in a CSS attribute selector. */
function cssEscape(s: string): string {
  // Simple escape for IDs that may contain characters needing escaping.
  // CSS.escape is available in modern browsers (webview context).
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(s)
  }
  return s.replace(/["\\]/g, "\\$&")
}
