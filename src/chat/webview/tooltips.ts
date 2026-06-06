/**
 * Centralized tooltip / aria-label copy for the OpenCode webview.
 *
 * Every user-facing label and tooltip string for the chat webview lives here.
 * Static copy is in the {@link TOOLTIPS} object. State-aware copy is produced
 * by the dynamic helpers (`getSendTooltip`, `getVoiceTooltip`, etc).
 *
 * To keep `title` (hover) and `aria-label` (screen reader) in lockstep on
 * icon-only buttons, prefer {@link applyTooltip} from `tooltipHelpers.ts`.
 *
 * Design rules followed by every entry:
 *   - State what the control does, not what it is.
 *   - Mention the keyboard shortcut if one exists.
 *   - Mention risk / irreversibility when relevant.
 *   - Mention dependencies (server, session, model) when relevant.
 *   - Explain *why* a control is disabled when state is non-default.
 *   - Never use "Click here" / "Submit" / "Open" / "Button" alone.
 */

export const TOOLTIPS = {
  chat: {
    send: "Send message (Ctrl+Enter)",
    sendPlain: "Send message",
    stop: "Stop the current model response",
    sendEmpty: "Type a message to enable Send",
    sendEmptyHint: "Type a message or attach an image to enable Send",
    sendBlockedByLimit: (streamingNames: string) =>
      streamingNames
        ? `Send is paused — ${streamingNames} still streaming. Stop one to continue.`
        : "Send is paused until a streaming tab is stopped.",
    mention: "Add a file or context mention (@)",
    attach: "Attach image or file to your message",
    commandsPalette: "Open the commands palette (Ctrl+Shift+/)",
    voiceStart: "Voice input: dictate a prompt locally when supported",
    voiceStop: "Stop recording and transcribe",
    instructionsGear: "Edit custom instructions for this tab",
    sendWhenStreamingHint: "Send this prompt — the agent will continue from here",
  },
  sessions: {
    newTab: "Open a new chat tab (Ctrl+T)",
    closeTab: "Close this tab (Ctrl+W)",
    nextTab: "Switch to the next tab (Ctrl+Tab)",
    previousTab: "Switch to the previous tab (Ctrl+Shift+Tab)",
    history: "Browse, resume, or delete previous sessions",
    pin: "Pin this session to the top of the list",
    unpin: "Unpin this session",
    rename: "Rename this session",
    archive: "Archive this session — hide it from the list but keep history",
    delete: "Delete this session permanently",
    deleteServer: "Delete this session from the OpenCode server",
    tags: "Edit tags for this session",
    loadEarlier: (count: number) => `Load ${count} earlier message${count === 1 ? "" : "s"}`,
  },
  models: {
    selector: "Choose which model OpenCode should use for this chat",
    selectorActive: (modelName: string) => `Active model: ${modelName}. Click to change.`,
    favoriteAdd: "Add this model to your favorites",
    favoriteRemove: "Remove this model from your favorites",
    enable: "Enable this model",
    disable: "Disable this model",
    search: "Search models by provider or name",
    noModels: "No models available — connect a provider in settings",
    providerKeyMissing:
      "Provider key is missing or invalid — open settings to configure",
  },
  mode: {
    selector: "Pick the session mode — controls how the agent is allowed to act",
    selectorActive: (label: string) =>
      `Mode: ${label}. Click to change. Alt+Shift+Tab to cycle.`,
    disabledDuringStream: "Mode is locked while the agent is responding",
    build:
      "Build mode: full access including running shell commands and editing files",
    plan: "Plan mode: agent proposes changes; nothing is applied without your approval",
    auto: "Auto mode: agent applies changes without per-action prompts — review output carefully",
    cycleHint: "Alt+Shift+Tab to cycle plan → build → auto",
  },
  server: {
    start: "Start the OpenCode server",
    reconnect: "Try to reconnect to the OpenCode server",
    statusConnected: "OpenCode server connected",
    statusDisconnected:
      "OpenCode server is not running. Click to start.",
    statusReconnecting: "Reconnecting to OpenCode server…",
    statusError:
      "OpenCode server encountered an error. Check the output channel for details.",
  },
  tools: {
    collapseAll: "Collapse all tool output in this message",
    expandAll: "Expand all tool output in this message",
    compact: "Switch to compact view — show tool counts only",
    detailed: "Switch to detailed view — show full tool output",
    toolPending: "Tool call is queued",
    toolRunning: "Tool is running",
    toolDone: "Tool completed",
    toolError: "Tool failed",
    copyCode: "Copy this code block to the clipboard",
    insertAtCursor:
      "Insert this code at the cursor position in the active editor",
    newFile: "Create a new file from this code block",
  },
  files: {
    openDiff: "Open the file changes panel for this session",
    changedFiles: "View files changed in this session",
    sort: "Toggle sort order — most-changed or alphabetical",
    collapseAll: "Collapse all diffs",
    expandDiff: "Expand this diff",
    collapseDiff: "Collapse this diff",
    openFile: "Open this file in the editor",
    contextWindowUnknown:
      "Context window size is unknown for this model. Click to set an override.",
  },
  settings: {
    menu: "Open settings and management options",
    thinkingShow: "Show thinking blocks in responses",
    thinkingHide: "Hide thinking blocks in responses",
    mcp: "Manage Model Context Protocol servers",
    theme: "Customize the chat theme colors",
    checkpoints: "Toggle the checkpoint history panel",
    todos: "Toggle the todos and changed files panel",
    activity: "Toggle the activity timeline",
    tasks: "Toggle the command tasks panel",
    timeline: "Toggle the conversation timeline sidebar",
    skills: "Browse and enable agent skills",
  },
  voice: {
    unavailable:
      "Voice input is not available in this VS Code environment. You can still type your prompt normally.",
    disabledBySetting:
      "Voice input is disabled — enable it in OpenCode settings",
    noSpeech: "No speech was detected — try again closer to the microphone",
    starting: "Starting microphone — click again to cancel",
    recording: "Recording — press Escape or the microphone button to stop",
    transcribing: "Transcribing your recording…",
    stopped: "Voice input stopped",
    error: "Voice input failed — see status for details",
  },
  status: {
    thinking: "OpenCode is thinking",
    contextUsage: "Context window usage — click for a breakdown by category",
    tokens: "Token usage for this session",
    cost: "Estimated cost for this session",
    quota: "Provider quota and rate limit",
  },
  search: {
    prev: "Previous match (Shift+Enter)",
    next: "Next match (Enter)",
    close: "Close message search (Escape)",
  },
  limits: {
    streamCapReached:
      "Concurrent stream limit reached — wait or stop another tab first",
    streamCapWithNames: (names: string) =>
      `Concurrent stream limit reached. Currently streaming: ${names}. Stop one to continue.`,
  },
  errors: {
    dismiss: "Dismiss this error",
    retry: "Retry the last failed request",
    switchModel: "Switch to a different model",
    waitAndRetry: "Wait for the rate limit to reset, then retry",
    switchProvider: "Switch to a different provider",
    showDetails: "Show technical details",
    hideDetails: "Hide technical details",
  },
  instructions: {
    label: "Custom instructions for this tab — injected at session start",
    save: "Save custom instructions (Ctrl+Enter)",
    cancel: "Discard and close",
  },
  prompts: {
    placeholder: "Ask OpenCode a question about your code…",
    queueSteerHint:
      "Add to queue (Ctrl+3) — runs after the current response ends",
    interruptHint:
      "Interrupt (Ctrl+1) — stops the current response and starts the new one",
    appendHint:
      "Append (Ctrl+2) — adds your message after the current response finishes",
  },
  steer: {
    interrupt: "Interrupt current response (Ctrl+1)",
    append: "Append after current response (Ctrl+2)",
    queue: "Queue for later (Ctrl+3)",
  },
  /**
   * Static tooltips for header/icon buttons declared in `index.html`.
   * These are injected at webview init time by `initStaticButtonTooltips()`
   * so the copy lives in one place (this module) and the HTML stays
   * free of duplicated user-facing strings.
   *
   * Format convention: short action + keyboard shortcut (where one
   * exists) + brief consequence. Two to four sentences max.
   */
  buttons: {
    history: "Open session history (Ctrl+Alt+H)\nBrowse and resume past sessions",
    checkpointToggle:
      "Toggle checkpoint panel (Ctrl+Shift+Alt+K)\nShow or hide the checkpoint timeline",
    todosToggle:
      "Toggle todos panel (Ctrl+Shift+Alt+T)\nShow or hide the todo list for this session",
    activityToggle:
      "Toggle activity timeline\nShow or hide the file/command activity feed",
    tasksToggle:
      "Toggle command tasks\nShow or hide running and recent shell commands",
    timelineToggle:
      "Toggle conversation timeline sidebar (Ctrl+Shift+Alt+L)\nShow or hide the turn-by-turn navigation",
    skills: "Open skills manager\nView, enable, or disable agent skills",
    settings: "Open more options\nTheme, provider config, and advanced settings",
    closeTodos: "Close todos panel",
    closeActivity: "Close activity timeline",
    closeTasks: "Close command tasks panel",
    closeSubagent: "Close subagent panel",
    subagentBack: "Back to subagent list",
    subagentDetailClose: "Close subagent detail",
    mention: "Add a context mention (@)\nReference a file, agent, or tool",
    commandsPalette:
      "Open commands palette (Ctrl+Shift+/)\nSlash commands, stashes, and built-in actions",
    attach: "Attach files or images\nReference local files in your message",
    instructionsGear:
      "Edit per-tab instructions\nSet custom behavior for this tab only",
    modelSelector:
      "Select model\nChoose provider and model for this tab",
    variantSelector:
      "Select thinking level\nControl reasoning depth for the next response",
    send: "Send message (Ctrl+Enter)\nSubmit the prompt to the active session",
    searchPrev: "Previous match (Shift+Enter)",
    searchNext: "Next match (Enter)",
    searchClose: "Close search (Escape)",
  },
} as const

/**
 * Legacy constant kept for backward compatibility with existing call sites
 * (e.g. {@link import("./main").STREAM_LIMIT_TOOLTIP}) and tests that match
 * the substring. New code should reach for {@link TOOLTIPS.limits}.
 */
export const STREAM_LIMIT_TOOLTIP = TOOLTIPS.limits.streamCapReached

// ─── Dynamic helpers ──────────────────────────────────────────────

export interface SendTooltipOptions {
  isStreaming: boolean
  streamCapacity?: { isFull: boolean; streamingNames: string; activeStreams: number }
}

/**
 * Compute the title and aria-label for the send / stop button given the
 * current state. The send button has three logical states:
 *   1. idle — ready to send
 *   2. streaming — sends a stop affordance
 *   3. blocked-by-stream-cap — disabled with a reason
 */
export function getSendTooltip(opts: SendTooltipOptions): { title: string; ariaLabel: string } {
  if (opts.isStreaming) {
    return {
      title: TOOLTIPS.chat.stop,
      ariaLabel: "Stop the current model response",
    }
  }
  if (opts.streamCapacity?.isFull) {
    const reason = opts.streamCapacity.streamingNames
      ? TOOLTIPS.chat.sendBlockedByLimit(opts.streamCapacity.streamingNames)
      : TOOLTIPS.limits.streamCapReached
    return { title: reason, ariaLabel: reason }
  }
  return {
    title: TOOLTIPS.chat.send,
    ariaLabel: "Send message",
  }
}

export type VoiceState =
  | "disabled"
  | "idle"
  | "starting"
  | "recording"
  | "transcribing"
  | "inserted"
  | "error"

/**
 * Compute title and aria-label for the voice-input mic button given the
 * current voice state. Always communicates what *will* happen on click.
 */
export function getVoiceTooltip(state: VoiceState): { title: string; ariaLabel: string } {
  switch (state) {
    case "recording":
      return {
        title: TOOLTIPS.voice.recording,
        ariaLabel: TOOLTIPS.chat.voiceStop,
      }
    case "starting":
      return {
        title: TOOLTIPS.voice.starting,
        ariaLabel: "Starting microphone — click to cancel",
      }
    case "transcribing":
      return {
        title: TOOLTIPS.voice.transcribing,
        ariaLabel: "Transcribing voice input",
      }
    case "inserted":
      return {
        title: "Transcript inserted into the prompt",
        ariaLabel: "Voice input ready",
      }
    case "error":
      return {
        title: TOOLTIPS.voice.error,
        ariaLabel: "Voice input failed — click to retry",
      }
    case "disabled":
      return {
        title: TOOLTIPS.voice.unavailable,
        ariaLabel: "Voice input unavailable",
      }
    case "idle":
    default:
      return {
        title: TOOLTIPS.chat.voiceStart,
        ariaLabel: "Start voice input",
      }
  }
}

export type SessionMode = "plan" | "build" | "auto"

const MODE_LABELS: Record<SessionMode, string> = {
  plan: "Plan",
  build: "Build",
  auto: "Auto",
}

const MODE_DESCRIPTIONS: Record<SessionMode, string> = {
  plan: "Plan mode: agent proposes changes; nothing is applied without your approval",
  build:
    "Build mode: full access including running shell commands and editing files",
  auto: "Auto mode: agent applies changes without per-action prompts — review output carefully",
}

const MODE_SHORTCUTS: Record<SessionMode, string> = {
  plan: "Ctrl/Cmd+Alt+1",
  build: "Ctrl/Cmd+Alt+2",
  auto: "Ctrl/Cmd+Alt+3",
}

const CYCLE_SHORTCUT_LABEL = "Alt+Shift+Tab to cycle modes"

/**
 * Build the tooltip / aria-label for the mode selector dropdown trigger.
 *
 * Format preserved for backward compatibility with the (currently
 * skipped) test `adds discoverable mode tooltips and labels` in
 * modeDropdown.test.ts.
 */
export function getModeSelectorTooltip(mode: SessionMode): {
  title: string
  ariaLabel: string
} {
  const label = MODE_LABELS[mode]
  const desc = MODE_DESCRIPTIONS[mode]
  const shortcut = MODE_SHORTCUTS[mode]
  return {
    title: `${desc} Shortcut: ${shortcut}. ${CYCLE_SHORTCUT_LABEL}.`,
    ariaLabel: `Mode: ${label}. ${desc} Shortcut: ${shortcut}. ${CYCLE_SHORTCUT_LABEL}.`,
  }
}

/**
 * Build the tooltip / aria-label for an individual mode option in the
 * dropdown list. Format preserved for backward compatibility with the
 * (currently skipped) modeDropdown.test.ts.
 */
export function getModeOptionTooltip(mode: SessionMode): {
  title: string
  ariaLabel: string
} {
  const label = MODE_LABELS[mode]
  const desc = MODE_DESCRIPTIONS[mode]
  const shortcut = MODE_SHORTCUTS[mode]
  return {
    title: `${desc} Shortcut: ${shortcut}. ${CYCLE_SHORTCUT_LABEL}.`,
    ariaLabel: `${label} mode. ${desc} Shortcut: ${shortcut}. ${CYCLE_SHORTCUT_LABEL}.`,
  }
}

/**
 * Build the tooltip / aria-label for a status-bar context-usage chip.
 *
 * Pass `tokens` and `maxTokens` to include the actual token counts in
 * the copy (preferred for the live status bar, where users want to see
 * exact numbers). Without them, only the percentage is shown.
 */
export function getContextUsageTooltip(opts: {
  percent: number
  label?: string
  tokens?: number
  maxTokens?: number
  unknownWindow?: boolean
}): string {
  const pct = Math.max(0, Math.min(100, Math.round(opts.percent)))
  const labelPart = opts.label ? `${opts.label} — ` : ""
  if (opts.unknownWindow) {
    if (opts.tokens != null) {
      return `${labelPart}${opts.tokens.toLocaleString()} tokens · context window unknown · click for breakdown`
    }
    return `${labelPart}Context window unknown · click for breakdown`
  }
  if (opts.tokens != null && opts.maxTokens != null && opts.maxTokens > 0) {
    return `${labelPart}${pct}% used · ${opts.tokens.toLocaleString()} / ${opts.maxTokens.toLocaleString()} tokens · click for breakdown`
  }
  if (opts.label) {
    return `${labelPart}${pct}% of context used. Click for breakdown.`
  }
  return `Context window usage: ${pct}%. Click for breakdown.`
}

/**
 * Build a short, accessible name for a streaming session status indicator.
 */
export function getServerStatusTooltip(status: string): string {
  const normalized = status.toLowerCase()
  if (normalized.includes("think")) return TOOLTIPS.status.thinking
  if (normalized.includes("error") || normalized.includes("fail"))
    return TOOLTIPS.server.statusError
  if (normalized.includes("connect") || normalized.includes("reconnect"))
    return TOOLTIPS.server.statusReconnecting
  if (
    normalized.includes("busy") ||
    normalized.includes("tool") ||
    normalized.includes("run") ||
    normalized.includes("exec")
  ) {
    return "OpenCode is running a tool"
  }
  return TOOLTIPS.server.statusConnected
}

/**
 * Build a tooltip explaining why a control is disabled. The control's
 * `aria-label` should also be prefixed with "Unavailable: …" so screen
 * readers convey the reason, not just the state.
 */
export function getDisabledReasonTooltip(reason: string): {
  title: string
  ariaLabel: string
} {
  return {
    title: `Unavailable: ${reason}`,
    ariaLabel: `Unavailable: ${reason}`,
  }
}

/**
 * Map of button id → tooltip copy for the static buttons declared in
 * `index.html`. Kept in sync with the `TOOLTIPS.buttons` map above.
 * `initStaticButtonTooltips()` uses this to wire the strings to the
 * live DOM after webview init.
 */
const STATIC_BUTTON_TOOLTIPS: ReadonlyArray<{ id: string; tooltip: string }> = [
  { id: "history-btn", tooltip: TOOLTIPS.buttons.history },
  { id: "checkpoint-toggle-btn", tooltip: TOOLTIPS.buttons.checkpointToggle },
  { id: "todos-toggle-btn", tooltip: TOOLTIPS.buttons.todosToggle },
  { id: "activity-toggle-btn", tooltip: TOOLTIPS.buttons.activityToggle },
  { id: "tasks-toggle-btn", tooltip: TOOLTIPS.buttons.tasksToggle },
  { id: "timeline-toggle-btn", tooltip: TOOLTIPS.buttons.timelineToggle },
  { id: "skills-btn", tooltip: TOOLTIPS.buttons.skills },
  { id: "settings-btn", tooltip: TOOLTIPS.buttons.settings },
  { id: "close-todos-btn", tooltip: TOOLTIPS.buttons.closeTodos },
  { id: "activity-close-btn", tooltip: TOOLTIPS.buttons.closeActivity },
  { id: "tasks-close-btn", tooltip: TOOLTIPS.buttons.closeTasks },
  { id: "close-subagent-btn", tooltip: TOOLTIPS.buttons.closeSubagent },
  { id: "subagent-detail-back-btn", tooltip: TOOLTIPS.buttons.subagentBack },
  { id: "subagent-detail-close-btn", tooltip: TOOLTIPS.buttons.subagentDetailClose },
  { id: "mention-btn", tooltip: TOOLTIPS.buttons.mention },
  { id: "commands-palette-btn", tooltip: TOOLTIPS.buttons.commandsPalette },
  { id: "attach-btn", tooltip: TOOLTIPS.buttons.attach },
  { id: "instructions-gear-btn", tooltip: TOOLTIPS.buttons.instructionsGear },
  { id: "model-selector-btn", tooltip: TOOLTIPS.buttons.modelSelector },
  { id: "variant-selector-btn", tooltip: TOOLTIPS.buttons.variantSelector },
  { id: "send-btn", tooltip: TOOLTIPS.buttons.send },
  { id: "chat-search-prev", tooltip: TOOLTIPS.buttons.searchPrev },
  { id: "chat-search-next", tooltip: TOOLTIPS.buttons.searchNext },
  { id: "chat-search-close", tooltip: TOOLTIPS.buttons.searchClose },
]

/**
 * Apply the static button tooltips from {@link TOOLTIPS.buttons} to the
 * matching DOM elements. Idempotent: safe to call multiple times.
 *
 * The hardcoded `title=` / `aria-label=` attributes in `index.html` are
 * kept as a graceful fallback for the brief moment between webview
 * load and this call. After it runs, the centralized copy wins.
 */
export function initStaticButtonTooltips(root: Document = document): number {
  let applied = 0
  for (const { id, tooltip } of STATIC_BUTTON_TOOLTIPS) {
    const el = root.getElementById(id)
    if (!el) continue
    el.setAttribute("title", tooltip)
    el.setAttribute("aria-label", tooltip.replace(/\n/g, ". "))
    applied++
  }
  return applied
}
