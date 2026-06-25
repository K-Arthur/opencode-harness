# OpenCode Streaming Lifecycle

This extension talks to the OpenCode server through `@opencode-ai/sdk`; it does
not spawn the CLI for chat. The CLI is still the parity reference because it
attaches to the same server/session and prints the server JSONL stream directly.

Research anchors:

- OpenCode SDK: https://opencode.ai/docs/sdk/
- OpenCode Server API: https://opencode.ai/docs/server/
- Agents and permissions: https://opencode.ai/docs/agents/
- Modes deprecation / agent mapping: https://opencode.ai/docs/es/modes

## Prompt Flow

1. The webview creates an optimistic user message ID and a local
   `clientRequestId`.
2. `WebviewEventRouter` stores the user message locally, validates attachments,
   and calls `StreamCoordinator.startPrompt(...)` with both IDs.
3. `StreamCoordinator` creates one active run record:
   `{ tabId, cliSessionId, clientRequestId, userMessageId, assistantMessageId,
   mode, agent, model, startedAt, state }`.
4. `SessionClient.sendPromptAsync` forwards `messageID` to
   `/session/:id/prompt_async` and uses the idempotency key header for the SDK
   request.
5. When `prompt_async` returns, the host sends `prompt_accepted`. If the send
   fails, the host sends `prompt_send_failed` with the recoverable text.

`opencode.debugLogging` enables structured stream traces. Prompt content is not
logged; traces include prompt length and a short SHA-256 hash plus tab/session,
request, user message, assistant message, mode, agent, model, event type, and
accept/drop/finalize reason fields.

## Stream Ownership

The tab streaming boolean is only UI state. Backend work is owned by the active
run record and the OpenCode server session. Webview dispose/reload does not abort
OpenCode work. On reload, the webview receives live buffer replay through
`stream_start.resumed` and reconciliation can fetch `/session/:id/message`.

Only explicit stop or close-tab aborts a run. Startup diagnostics such as TTFB
timeout report an error but do not abort after `prompt_async` has accepted the
request, because the backend may still be running.

## Modes And Agents

Mode mapping is centralized:

| Extension mode | OpenCode agent |
| --- | --- |
| `plan` | `plan` |
| `build` | `build` |
| `auto` | `build` |

Auto mode is an extension UX mode. It still sends `agent: "build"` and applies
extension-side permission auto-approval. Mode changes during a run affect the
next prompt only.

## Questions

OpenCode v2 question events render as `question` blocks with `requestID`. Replies
use the v2 API:

- `question.reply({ requestID, answers })`
- `question.reject({ requestID })`

The legacy `question` tool-part fallback remains for older event streams. V2
answers do not consume a new stream slot and do not create a fresh unrelated
assistant run.

### V2Event format normalization (SDK v1.17.11+)

The SDK v1.17.11 server emits events in **V2Event format** (with a `data` field)
instead of the legacy **Event format** (with a `properties` field). Both formats
carry the same payload; only the field name differs. The SSE parser
(`sseParser.ts:normalizeEventFormat`) normalizes `data` → `properties` at the
ingest boundary so all handlers (`QuestionHandler`, `SessionNextHandler`, etc.)
can read `event.properties` uniformly regardless of which format the server
sends. `EventNormalizer.unwrapSyncEvent` applies the same normalization on the
non-sync path as defense in depth.

`QuestionHandler` resolves the request ID with a three-level fallback:
`properties.id` → `properties.requestID` → `event.id` (the V2Event envelope ID).
This covers the case where a V2Event question event carries the request ID only
at the event envelope level.

## Event And Part Coverage

The manifest in `src/session/eventCoverage.ts` classifies SDK v1/v2 server
event and part types as handled or safe-ignored. The unit test
`tests/unit/opencode-event-coverage.test.mjs` parses the installed SDK generated
type definitions and fails when a new SDK event or part appears without a
classification.

Handled surfaces include:

- v1: `message.part.updated`, `message.part.delta`, `message.updated`,
  `session.*`, `permission.*`, `todo.updated`, `file.edited`, `mcp.tools.changed`
- v2: `session.next.*`, `question.*`, `question.v2.*`, `permission.asked`,
  `permission.v2.*`, MCP/workspace/worktree/project/catalog/account events
- parts: `text`, `reasoning`, `tool`, `step-start`, `step-finish`, `agent`,
  `retry`, `compaction`, `subtask`

Safe-ignored surfaces are explicit, not accidental. Unknown unclassified events
become `unknown_server_event` and render a compact diagnostic activity block.

## CLI Parity

Use the parity helper to compare direct CLI JSONL with extension traces:

```bash
node scripts/trace-opencode-cli-parity.mjs \
  --attach http://127.0.0.1:4096 \
  --session <opencode-session-id> \
  --prompt "continue" \
  --out /tmp/opencode-cli.jsonl \
  --extension-trace /tmp/opencode-extension-trace.jsonl
```

The script runs `opencode run --attach <url> --session <id> --format json` and
prints compact event/part summaries for both streams.
