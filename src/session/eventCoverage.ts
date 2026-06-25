const split = (value: string): string[] => value.split("|")
const prefixed = (prefix: string, value: string): string[] => split(value).map((suffix) => `${prefix}${suffix}`)

export const HANDLED_EVENT_TYPES: readonly string[] = [
  "file.edited",
  "mcp.tools.changed",
  "message.part.delta",
  "message.part.updated",
  "message.updated",
  "permission.asked",
  "permission.replied",
  "permission.updated",
  "permission.v2.asked",
  "permission.v2.replied",
  "question.asked",
  "question.rejected",
  "question.replied",
  "question.v2.asked",
  "question.v2.rejected",
  "question.v2.replied",
  "server.connected",
  "server.disconnected",
  "session.compacted",
  "session.diff",
  "session.error",
  "session.idle",
  ...prefixed("session.next.", "agent.switched|compaction.delta|compaction.ended|compaction.started|context.updated|interrupt.requested|model.switched|moved|prompt.admitted|prompt.promoted|prompted|reasoning.delta|reasoning.ended|reasoning.started|retried|shell.ended|shell.started|step.ended|step.failed|step.started|synthetic|text.delta|text.ended|text.started|tool.called|tool.failed|tool.input.delta|tool.input.ended|tool.input.started|tool.progress|tool.success"),
  "session.status",
  "session.updated",
  "todo.updated",
] as const

export const SAFE_IGNORED_EVENT_TYPES: readonly string[] = [
  ...prefixed("account.", "added|removed|switched"),
  "catalog.model.updated",
  "catalog.updated",
  "command.executed",
  "file.watcher.updated",
  "global.disposed",
  ...prefixed("installation.", "update-available|updated"),
  "integration.connection.updated",
  "integration.updated",
  "lsp.client.diagnostics",
  "lsp.updated",
  "mcp.browser.open.failed",
  "message.part.removed",
  "message.removed",
  "models-dev.refreshed",
  "plugin.added",
  "project.directories.updated",
  "project.updated",
  ...prefixed("pty.", "created|deleted|exited|updated"),
  "reference.updated",
  "server.heartbeat",
  "server.instance.disposed",
  ...prefixed("session.", "created|deleted"),
  ...prefixed("session.next.revert.", "cleared|committed|staged"),
  "sync",
  ...prefixed("tui.", "command.execute|prompt.append|session.select|toast.show"),
  "vcs.branch.updated",
  ...prefixed("workspace.", "failed|ready|status"),
  ...prefixed("worktree.", "failed|ready"),
] as const

// Namespaces whose every sub-event is noise for the chat UI. This prefix net is
// the safety valve that keeps un-enumerated future sub-events (a new `lsp.*`,
// `integration.*`, … variant) from regressing into "Unsupported OpenCode event"
// cards. The exact members enumerated above stay as the observed-event manifest;
// this list is matched in addition to them, never instead.
export const SAFE_IGNORED_EVENT_PREFIXES: readonly string[] = [
  "account",
  "catalog",
  "file.watcher",
  "installation",
  "integration",
  "lsp",
  "mcp.browser",
  "project",
  "pty",
  "reference",
  "tui",
  "workspace",
  "worktree",
] as const

export const HANDLED_PART_TYPES: readonly string[] = split("agent|compaction|reasoning|retry|step-finish|step-start|subtask|text|tool")

export const SAFE_IGNORED_PART_TYPES: readonly string[] = split("file|patch|snapshot")

const handledEvents = new Set<string>(HANDLED_EVENT_TYPES)
const safeIgnoredEvents = new Set<string>(SAFE_IGNORED_EVENT_TYPES)
const handledParts = new Set<string>(HANDLED_PART_TYPES)
const safeIgnoredParts = new Set<string>(SAFE_IGNORED_PART_TYPES)
const safeIgnoredPrefixes = new RegExp(`^(${SAFE_IGNORED_EVENT_PREFIXES.map((p) => p.replace(/\./g, "\\.")).join("|")})\\.`)

export function isHandledEventType(type: string): boolean {
  return handledEvents.has(type)
}

export function isSafeIgnoredEventType(type: string): boolean {
  return safeIgnoredEvents.has(type) || safeIgnoredPrefixes.test(type)
}

export function isHandledPartType(type: string): boolean {
  return handledParts.has(type)
}

export function isSafeIgnoredPartType(type: string): boolean {
  return safeIgnoredParts.has(type)
}
