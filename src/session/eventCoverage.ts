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
  ...prefixed("session.next.", "agent.switched|compaction.delta|compaction.ended|compaction.started|context.updated|model.switched|moved|prompt.admitted|prompt.promoted|prompted|reasoning.delta|reasoning.ended|reasoning.started|retried|shell.ended|shell.started|step.ended|step.failed|step.started|synthetic|text.delta|text.ended|text.started|tool.called|tool.failed|tool.input.delta|tool.input.ended|tool.input.started|tool.progress|tool.success"),
  "session.status",
  "session.updated",
  "todo.updated",
] as const

export const SAFE_IGNORED_EVENT_TYPES: readonly string[] = [
  ...prefixed("account.", "added|removed|switched"),
  "catalog.model.updated",
  "command.executed",
  "file.watcher.updated",
  "global.disposed",
  ...prefixed("installation.", "update-available|updated"),
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
  "server.heartbeat",
  "server.instance.disposed",
  ...prefixed("session.", "created|deleted"),
  "sync",
  ...prefixed("tui.", "command.execute|prompt.append|session.select|toast.show"),
  "vcs.branch.updated",
  ...prefixed("workspace.", "failed|ready|status"),
  ...prefixed("worktree.", "failed|ready"),
] as const

export const HANDLED_PART_TYPES: readonly string[] = split("agent|compaction|reasoning|retry|step-finish|step-start|subtask|text|tool")

export const SAFE_IGNORED_PART_TYPES: readonly string[] = split("file|patch|snapshot")

const handledEvents = new Set<string>(HANDLED_EVENT_TYPES)
const safeIgnoredEvents = new Set<string>(SAFE_IGNORED_EVENT_TYPES)
const handledParts = new Set<string>(HANDLED_PART_TYPES)
const safeIgnoredParts = new Set<string>(SAFE_IGNORED_PART_TYPES)

export function isHandledEventType(type: string): boolean {
  return handledEvents.has(type)
}

export function isSafeIgnoredEventType(type: string): boolean {
  return safeIgnoredEvents.has(type)
}

export function isHandledPartType(type: string): boolean {
  return handledParts.has(type)
}

export function isSafeIgnoredPartType(type: string): boolean {
  return safeIgnoredParts.has(type)
}
