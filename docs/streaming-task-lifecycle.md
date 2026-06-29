# Streaming Task Lifecycle

OpenCode Harness treats a chat run as a long-lived activity, not just a token stream.
The extension now tracks model activity, tool activity, subagent activity, transport
state, and finalization separately so quiet periods do not become false failures.

## Host Model

`RunActivityTracker` owns run liveness for each tab. A run starts in
`waiting_for_activity`, records prompt acceptance separately, and only clears the
startup guard when credible OpenCode activity arrives:

- assistant text or reasoning
- tool pending/running/completed/error
- subtask/subagent part
- agent, retry, compaction, step-start, or step-finish part
- permission request
- busy/retry session status

Tool and subagent state are independent. Active tools put the run in
`waiting_on_tool`; active subagents put it in `waiting_on_subagent`. Finalization
is deferred while either is active. If the server becomes idle but a tool/subagent
does not emit a completion event, the coordinator waits the existing grace window,
marks the item unresolved, preserves partial output, and finalizes instead of
leaving a stale running state.

## Error Taxonomy

Run-scoped pipeline errors are mapped through `runErrorMapper` with:

- kind: `model_startup_timeout`, `transport_disconnected`, `server_error`,
  `tool_failed`, `tool_unresolved`, `subagent_failed`, `subagent_unresolved`,
  `user_cancelled`, `webview_bridge_error`, `session_reload_interruption`, or
  `unknown`
- source: model provider, OpenCode server, event stream, extension host, tool,
  subagent, webview bridge, user, or unknown
- recoverability: retryable, refresh from server, continue from partial,
  non-retryable, or unknown

The webview shows a plain-English title, likely cause, source, recoverability,
whether partial output was preserved, and whether server work may still be active.
Technical details stay behind the existing details disclosure.

## Webview Messages

The host emits `run_activity_update` snapshots with stable run/message/session IDs,
phase, status label, active tool/subagent counts, and compact tool/subagent state.
Large fields (`tool.input`, `tool.result`, `subagent.inputPrompt`) are stripped before
posting to stay under the `HostMessageBatcher`'s 256KB payload limit — the webview
never reads them. The webview uses this to show grounded status copy such as:

- `Waiting for first model activity`
- `Running tool: bash`
- `Subagent: UI Audit - running file analysis`
- `Reviewing with 2 active subagents`
- `Stream disconnected; attempting to reconcile`

Historical child-session fetches still enrich the subagent panel, but they no
longer invent completion. If OpenCode omits a child status, the extension uses
`unknown`/live instead of claiming `completed`.

## Recovery

Supported recovery remains honest:

- Retry from the last user message is supported through `retry_stream`.
- Refresh/reconcile after reconnect uses session messages and child sessions.
- True resume/reattach is not claimed unless the OpenCode server exposes enough
  active-stream state for the extension to prove it can reattach.
- Cancel calls the existing OpenCode abort API and marks the run as
  `user_cancelled`.

## Subagent Heartbeat Polling

`SubagentHeartbeat` (`src/chat/handlers/SubagentHeartbeat.ts`) polls the OpenCode
`/session/children` endpoint every 5 seconds per tab. It cross-references returned child
session IDs against the tracked `SubagentRunState` list:

- **Newly discovered children** are linked to unmatched running subagents via
  `childSessionId`. If no matching subagent exists, a new subagent entry is created
  for the child session.
- **Disappeared children** trigger marking the linked subagent as `completed`.
- **Retry policy**: up to 2 consecutive poll failures are tolerated and logged at
  `warn` level; further failures log at `error` level and the polling loop continues.

The heartbeat is wired into `StreamCoordinator`: initialized in the constructor, started
after prompt acceptance, stopped in `cleanupTab`, and `stopAll` on dispose. Subtask data
payloads on `subagent_add` now carry `childSessionId` (the linked OpenCode child session
ID) and `error` (failure detail when status is `failed`). `ActivityPartHandler` includes
both fields in the subtask event; `ChatProvider.recordSubagentActivity` passes
`childSessionId` through to the subagent tracking layer.

## Validation Commands

Use the repo's documented order before commit:

```bash
npm run typecheck
npm run build
npm run test:unit
```

CI also runs:

```bash
npx eslint src/
node scripts/check-architecture.mjs
npm run bundle:check
```

Package and reinstall from the documented VSIX workflow:

```bash
npm run vscode:prepublish
npx @vscode/vsce package --no-dependencies --allow-missing-repository
code --install-extension opencode-harness-*.vsix --force
```

Manual validation should include a long codebase review with subagents, a long
shell/tool run with quiet output, event stream reconnect, webview reload, cancel,
retry, and child-session detail inspection.
