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
The webview uses this to show grounded status copy such as:

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
