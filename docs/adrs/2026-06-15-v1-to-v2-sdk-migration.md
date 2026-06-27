# ADR: Migrate from the @opencode-ai/sdk v1 client to the v2 client (strangler)

**Date:** 2026-06-15 · **Status:** Complete (all phases shipped)

## Context

`@opencode-ai/sdk` ships two client surfaces:
- **v1** (`@opencode-ai/sdk`, `createOpencodeClient`) — the client used throughout the extension today (`SessionClient`, `SseSubscriber`, `BackfillService`, `StreamCoordinator`, `SubagentHeartbeat`). Mix of namespaced (`client.session.x`) and flat (`client.postSessionIdPermissionsPermissionId`) methods.
- **v2** (`@opencode-ai/sdk/v2/client`) — cleaner namespaced API and the home of **new features**: `question.reply`/`reject`, session-scoped questions, `session.context`, `session.compact`, reference lists, integration APIs, etc.

The trigger: the **question reply/reject feature was entirely broken** because that API exists only on v2; the v1 client has no `question` namespace, so calls always threw "API is unavailable" (and the question panel never dismissed, and a model blocked on a question never resumed). The existing permission flow already carries a "try a modern v2-ish path, fall back to v1 REST" hack — a symptom of the same v1/v2 split.

Measured v1 surface to migrate: **~24 call sites across 8 non-webview files**, dominated by `client.session.*`.

## Decision

Adopt a **strangler-fig migration**: stand up the v2 client as a first-class citizen, migrate call sites feature-by-feature behind tests, and remove v1 once nothing uses it. Do **not** big-bang the migration through the SSE event pipeline.

### Phases

- **Phase 1 — Beachhead (SHIPPED, commit `816a874`).** v2 client is first-class: `opencodeClientFactory.createV2Client`, `AuthProvider.makeV2Client`/`makeRemoteV2Client` (same baseUrl+auth as v1 via shared config helpers), `SessionManager.v2Client` lifecycle, `SessionClient.getV2Client`. `replyToQuestion`/`rejectQuestion` use v2. Behavioral tests via vscode-stub bundle.
- **Phase 2 — Request/response session calls.** Migrate `SessionClient` CRUD + prompt paths (`session.create/get/list/delete/update/revert/diff/abort/todo/children/summarize/command`, `file.read`, `command.list`, `app.agents`) to the v2 client, one cluster per PR, each with a behavioral test (vscode-stub bundle pattern). Verify request/response shapes against v2 `sdk.gen` (some bodies differ, e.g. session-scoped question uses `questionV2Reply`).
- **Phase 3 — Permissions.** Replace the permission "modern path + v1 REST fallback" with the v2 `permission.reply` (and/or `session.permission.reply`). Removes a standing dual-API hack.
- **Phase 4 — SSE event pipeline.** The `SseSubscriber` already used raw `fetch()` for SSE (not the v1 SDK client). The only v1 dependency was the `OpencodeClient` type for a null-check-only getter. Replaced with a boolean `hasClient` flag. No event normalizer changes needed — it uses `SdkEventLike` (local type). Effectively a no-op migration; risk never materialized.
- **Phase 5 — Remove v1.** Deleted `createOpencodeClient` from `opencodeClientFactory.ts`, `makeClient`/`makeRemoteClient` from `AuthProvider.ts`, `this.client` from `SessionManager.ts`, `getClient`/`guard()` from `SessionClient.ts`, and `OpencodeClient` type from `SseSubscriber.ts`. Reclaimed ~25KB of host bundle. Host limit re-baselined 624KB → 598KB.

### Guardrails

- The v2 client is always built from the **same baseUrl + auth** as v1 (shared `localClientConfig`/`remoteClientConfig`) so the two cannot drift while both exist.
- Each phase ships independently, green on: typecheck, unit, message-contract, roundtrip, prod build + bundle gate.
- Behavioral tests for vscode-dependent modules use the established esbuild `--alias:vscode=<stub>` bundle pattern (`tests/unit/*.test.mjs`).

## Consequences

**Positive:** one client surface; access to v2-only features (questions already; context/compact/etc. next); removes dual-API hacks; cleaner typed calls.

**Negative / cost:**
- **Bundle:** hey-api's class-based v2 SDK is **not tree-shakeable per-method** — importing it pulls the whole generated client graph (~44KB). Host bundle was 561.6KB → 618.1KB during the migration (both v1 and v2 shipped). After Phase 5 (v1 removal) the host dropped to ~593KB. The v2 ~44KB is now the sole client cost, which is the post-migration steady state.
- **Risk concentrated in Phase 4** (event pipeline). Mitigated by doing it last, under R1, with roundtrip/contract tests.

## Alternatives considered

- **Raw `fetch` to v2 REST endpoints** (zero bundle cost): rejected as the primary strategy — loses SDK typing/error handling and would be rewritten when the broader migration lands; acceptable only as a last resort for a single endpoint.
- **v2 raw transport (`@opencode-ai/sdk/v2/gen/client` `createClient`)** without the generated SDK class: smaller, but hand-rolled requests and churn when migrating to the typed client. Rejected for the same churn reason.
- **Stay on v1 + per-feature casts** (status quo): rejected — questions are unfixable on v1 and the dual-API hacks accumulate.

## Post-migration follow-up (2026-06-15)

### Phase 6 — Type import migration (2026-06-16)

All remaining `import type { ... } from "@opencode-ai/sdk"` (v1) statements migrated to `"@opencode-ai/sdk/v2"` across 8 files:

- `src/session/SessionClient.ts` — `Session, Message, Part, TextPartInput, FilePartInput, AgentPartInput, SubtaskPartInput`
- `src/session/SessionManager.ts` — same + `Event as SdkEvent`
- `src/session/v2ResponseMappers.ts` — `Session, Message, Part, SnapshotFileDiff` (replaced `FileDiff`)
- `src/session/sdkMessageConverter.ts` — `Message, Part`
- `src/session/sdkMessageConverter.test.ts` — `Message, Part` + added required `agent` field to `AssistantMessage` fixtures
- `src/chat/BackfillService.ts` — `Message, Part`
- `src/chat/handlers/StreamCoordinator.ts` — `Part`
- `src/chat/handlers/SubagentHeartbeat.ts` — `Session`

Key v2 type differences handled:
- `AssistantMessage` gains required `agent: string`
- `FileDiff` → `SnapshotFileDiff` (optional `file?/patch?/status?` vs required `file/before/after`)
- `Session.summary.diffs` is `SnapshotFileDiff[]`
- `mapV2Session` now maps `slug` and uses `mapV2SnapshotFileDiff`

25 TDD tests added in `tests/unit/v2ResponseMappers.test.mjs` covering all mapper functions.

**Phase 2 gap: `replyToQuestion`/`rejectQuestion` used the wrong v2 sub-client.**

The Phase 1 beachhead wired `SessionClient.replyToQuestion` to `client.question.reply` — the v2 *global* question endpoint (`POST /question/{requestID}/reply`) instead of the session-scoped endpoint (`POST /api/session/{sessionID}/question/{requestID}/reply`). The global endpoint returns `QuestionNotFoundError` because questions are session-scoped on the v2 server. The correct call is `client.session.question.reply({ sessionID, requestID, questionV2Reply: { answers } })`.

**Fixes shipped in commit `98d29fc`**:
- `SessionClient.replyToQuestion` now takes `(sessionId, requestID, answers)` and calls `client.session.question.reply`
- `SessionClient.rejectQuestion` now takes `(sessionId, requestID)` and calls `client.session.question.reject`
- `SessionManager` and `WebviewEventRouter` call sites threaded `sessionId` through
- Structural test tightened from `replyToQuestion(requestID` to `replyToQuestion(sessionId,`

Root cause: the generated SDK exposes `question` on BOTH the root client (`OpencodeClient.question` → `POST /question/{requestID}/reply`) and the session client (`Session2.question` → `POST /api/session/{sessionID}/question/{requestID}/reply`). The v2 ADR's Phase 2 note warned "session-scoped question uses `questionV2Reply`" but the call site was never updated after Phase 1.

### Phase 7 — V2Event format normalization (2026-06-25, commit `6783a1a`)

The SDK v1.17.11 server switched to emitting SSE events in **V2Event format**
(with a `data` field) instead of the legacy **Event format** (with a `properties`
field). The `SdkEventLike` interface and all event handlers read
`event.properties` exclusively, so V2Event-formatted events arrived with
`properties === undefined` — silently breaking question events (no `sessionID`,
`requestID`, or `questions`), which in turn broke the entire question flow (no
question bar rendered, no answer routing).

**Fixes shipped in commit `6783a1a`:**
- `sseParser.ts:normalizeEventFormat` — maps `data` → `properties` at the SSE
  ingest boundary so all handlers receive a unified `properties` field
- `EventNormalizer.unwrapSyncEvent` — applies the same normalization on the
  non-sync path (defense in depth)
- `QuestionHandler` — falls back to `event.id` (V2Event envelope ID) for the
  request ID when `properties.id` and `properties.requestID` are both absent
- `SdkEventLike` — extended with `data` and `id` fields to reflect both formats
- Regression tests in `session-event-normalizer.test.mjs` covering both the
  `data` → `properties` normalization and the `event.id` fallback

Root cause: the v2 SDK types define both `Event` (with `properties`) and
`V2Event` (with `data`) unions. Phase 4 noted "No event normalizer changes
needed — it uses `SdkEventLike` (local type)" — true at the time because the
server was still sending Event format. The v1.17.11 server switched to V2Event
format without a version-gated migration path, exposing the assumption.

### Phase 8 — v2 SDK error detail + file.read shape audit (2026-06-27, commit `6d57e4b`)

A full audit of all 27 `client.*` call sites in `SessionClient.ts` plus
`PtyService.ts` and `resolveSessionQuestionApi.ts` against the v2 SDK type
definitions found two issues:

1. **`throwOnV2Error` produced `Command failed: {}`** — when the server
   returned an empty error object (`{}`), `JSON.stringify({})` produced the
   useless string `"{}"`. New `v2ErrorDetail` helper
   (`src/session/v2ErrorDetail.ts`) extracts `error.message`, falls back to
   field JSON, then to `HTTP {status}`. Applied to `SessionClient`,
   `PtyService`, and the `sendPromptAsync` error path.

2. **`file.read` passed an unsupported `messageID`** — `readFile` forwarded
   `messageID` to `client.file.read`, but the v2 SDK `File.read` signature
   only accepts `{ directory?, workspace?, path }`. The extra field was
   silently ignored by the SDK's param builder (it only maps known keys),
   so it was dead code rather than a fatal error. Removed.

All other call sites (session.create/delete/get/update/list/messages/prompt/
promptAsync/command/shell/revert/unrevert/fork/share/unshare/abort/summarize/
diff/children/todo, permission.reply, command.list, pty.create/get/remove/
list/update/connectToken) match their v2 signatures correctly.

## References
- Beachhead commit `816a874`; `src/session/opencodeClientFactory.ts`, `AuthProvider.ts`, `SessionManager.ts`, `SessionClient.ts`.
- Related: `docs/implementation/2026-06-15-r1-unify-stream-state.md` (R1 — sequence Phase 4 with it).
