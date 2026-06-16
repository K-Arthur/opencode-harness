# Handoff Prompt — Complete the @opencode-ai/sdk v1 → v2 Migration

> **STATUS: COMPLETE (2026-06-16).** All phases shipped. All type imports migrated to v2.
> This document is preserved for historical reference.

---

## Mission

Finish migrating the OpenCode Harness extension from the **v1** `@opencode-ai/sdk` client
to the **v2** client (`@opencode-ai/sdk/v2/client`), then delete v1. This is a **strangler
migration** already in progress — do it phase-by-phase, ship each phase green, never
big-bang the SSE event pipeline. Authoritative plan: `docs/adrs/2026-06-15-v1-to-v2-sdk-migration.md`.

Work TDD per `CLAUDE.md`. **Commit each green slice immediately** — the working tree is
ephemeral (external checkpoint process discards uncommitted changes).

## State at handoff (2026-06-15)

Already done (read these commits/files first):
- **v2 client is first-class** (commit `816a874`): `src/session/opencodeClientFactory.ts` (`createV2Client`), `AuthProvider.makeV2Client`/`makeRemoteV2Client` (built from the **same** baseUrl+auth as v1 via `localClientConfig`/`remoteClientConfig`), `SessionManager.v2Client` (created/cleared alongside `client`), `SessionClient` gets a `getV2Client` getter + `guardV2()`.
- **Questions on v2** (`816a874`): `SessionClient.replyToQuestion`/`rejectQuestion` use `client.question.reply`/`reject`.
- **Phase 2 partial** (commit `27cf50d`): the safe void/ack calls migrated — `deleteSession`→`session.delete`, `abortSession`→`session.abort`, `revertMessage`→`session.revert`.

Still on v1 in `src/session/SessionClient.ts`: `createSession`, `getSession`, `updateSessionTitle`, `getSessionMessages`, `getToolPartialOutput`, `listSessions`, `sendPrompt`, `sendPromptAsync`, `sendCommand`, `compactSession`, `listCommands`, `getMessages`, `getSessionDiff`, `readFile`, `getSessionTodos`, `getChildSessions`, `listAgents`. Also v1 in: `SseSubscriber.ts` (event stream), `BackfillService.ts`, `StreamCoordinator.ts`, `SubagentHeartbeat.ts`, and the permission flow (`respondToPermission`).

## CRITICAL findings — read before writing any code

1. **Param shape changed: nested → flat.** v1 takes `{ path: { id }, body: { … }, query: { … } }`; v2 takes **flat** params keyed by `sessionID` (not `id`). Examples already applied: `abort({ sessionID })`, `revert({ sessionID, messageID? })`, `delete({ sessionID })`. Verify each method's exact params in `node_modules/@opencode-ai/sdk/dist/v2/gen/sdk.gen.d.ts`.

2. **Domain types DIFFER (the real blocker).** The extension is built on the **v1** `Session`/`Message`/`Part` types (imported from `@opencode-ai/sdk`). The **v2** types are not identical — e.g. v2 `Session` adds `slug`, `workspaceID`, `path` and `summary.diffs` is `SnapshotFileDiff` (v1: `FileDiff`). So any call that returns a domain object (`create`/`get`/`list`/`messages`/`prompt`/`promptAsync`/`command`/`children`) is **not** a clean swap — today they use `resp.data as Session` casts that would silently return v2-shaped objects under a v1 type. **Decide a strategy first** (see next section).

3. **Namespace renames.** Some v1 namespaces moved in v2: `client.file.read` → check v2 `fs` (`V2FsRead`); `client.command.list` → v2 `command`/`V2CommandList`; `client.app.agents` → v2 `agent`/`V2AgentList`. Verify before migrating these.

4. **The SSE event pipeline is the high-risk core.** `SseSubscriber.ts` subscribes via the v1 client and `src/session/eventHandlers/*` normalizes v1 event shapes. v2 has its own `V2EventSubscribe` + event shapes. Migrate this **LAST**, in its own PR, sequenced with R1 (`docs/implementation/2026-06-15-r1-unify-stream-state.md`), gated by roundtrip + message-contract tests, behind a flag if needed. Do **not** touch it while migrating request/response calls.

5. **Bundle.** hey-api's class-based v2 SDK is **not tree-shakeable per-method** — the whole client graph (~44KB) is already pulled in. Host limit was re-baselined to **624KB** (`scripts/check-bundle-size.mjs`). When the migration finishes and v1 is removed, drop the v1 import and reclaim ~30KB (re-baseline back down). Both clients ship during the migration.

## Decide the domain-type strategy (do this before Phase 2b)

Pick ONE and record it in the ADR:
- **(A) v2→domain mapping/adapter** — a `SessionV2Adapter` (or pure `mapV2Session`/`mapV2Message`/`mapV2Part`) that translates v2 responses into the extension's existing v1-shaped domain types. Smallest blast radius; isolates v2 shape differences in one place. **Recommended.**
- **(B) Adopt v2 domain types** — change the extension's `Session`/`Message`/`Part` imports to v2 and fix all downstream (`sdkMessageConverter.ts`, `SessionStore`, renderers…). Cleaner long-term, large ripple, overlaps the streaming converter — higher risk.

## Phased plan

- **Phase 2b — domain-returning session calls.** After choosing the strategy, migrate `create`/`get`/`list`/`updateSessionTitle`/`messages`/`command`/`children`/`diff`/`todo`/`summarize` one cluster per commit, each with a behavioral test. Map params nested→flat; map responses via (A) or (B).
- **Phase 2c — prompt path (`sendPrompt`/`sendPromptAsync`).** Streaming-critical and behaviorally pinned (`tests/unit/session-client-prompt-identity.test.mjs`). Verify the v2 `prompt`/`promptAsync` body (parts/model/agent/variant/messageID) and the idempotency-key header still attach. Keep that test green (extend it for v2 shape). Migrate last among request/response calls.
- **Phase 2d — other v1 consumers.** `BackfillService.ts`, `StreamCoordinator.ts`, `SubagentHeartbeat.ts` (mostly read messages — reuse the Phase 2b mappers).
- **Phase 3 — permissions.** Replace the `respondToPermission` "modern path + v1 REST fallback" hack with v2 `permission.reply` (or `session.permission.reply`).
- **Phase 4 — SSE event pipeline.** `SseSubscriber` + `eventHandlers/*` → v2 events. Own PR, with R1, max test coverage. HIGH RISK.
- **Phase 5 — remove v1.** Delete the v1 import/`createOpencodeClient`; reclaim ~30KB; re-baseline the bundle limit down.

## Test & verification protocol (non-negotiable)

- **Pattern for vscode-dependent modules** (SessionClient, etc.): behavioral tests in `tests/unit/*.test.mjs` that bundle the module with `esbuild --alias:vscode=<stub>` and `require` it. Copy `tests/unit/session-client-question-v2.test.mjs` (it already exercises the v2 client by passing a fake as the 4th `SessionClient` arg).
- For each migrated call, assert the **exact v2 param object** (flat `sessionID`, mapped fields) and the mapped return shape — pin the transform, not just "it compiles".
- **Gates, every commit:** `npm run typecheck` · `npm run test:unit` · `npm run test:message-contract` · `npm run test:roundtrip` · `node esbuild.js --production && node scripts/check-bundle-size.mjs`.

## Guardrails

- Keep the v2 client built from the **same** baseUrl+auth as v1 (already true — don't break it).
- Don't change error-handling/behavior beyond the client swap unless a test demands it; keep each step a mechanical, reviewable transform.
- Never run `git reset --hard`/`git stash`/`git checkout -- <live edits>` (ephemeral tree). Commit small and often.
- If a call's v2 shape is ambiguous or its server endpoint may be unsupported, STOP and report rather than guess.

## Quick reference

- v2 method signatures: `node_modules/@opencode-ai/sdk/dist/v2/gen/sdk.gen.d.ts`
- v2 domain types: `node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts`
- v2 client factory + class: `@opencode-ai/sdk/v2/client`
- Migration ADR: `docs/adrs/2026-06-15-v1-to-v2-sdk-migration.md`
- R1 (sequence Phase 4 with it): `docs/implementation/2026-06-15-r1-unify-stream-state.md`
