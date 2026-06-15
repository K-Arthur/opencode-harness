# ADR: Migrate from the @opencode-ai/sdk v1 client to the v2 client (strangler)

**Date:** 2026-06-15 · **Status:** Accepted (Phase 1 shipped) · **Decider:** user-approved ("beachhead now + phased migration")

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
- **Phase 4 — SSE event pipeline (HIGH RISK, do last, own PR).** Migrate `SseSubscriber` subscription + the `eventHandlers/` normalizer to v2 events (`V2EventSubscribe` + v2 event shapes). This is the core of streaming and overlaps R1 (unify the dual stream state machine) — sequence it with/after R1, gated by extensive roundtrip + message-contract tests and a flag if needed.
- **Phase 5 — Remove v1.** Delete the v1 import and `createOpencodeClient` once no call sites remain. Reclaims ~30KB of host bundle.

### Guardrails

- The v2 client is always built from the **same baseUrl + auth** as v1 (shared `localClientConfig`/`remoteClientConfig`) so the two cannot drift while both exist.
- Each phase ships independently, green on: typecheck, unit, message-contract, roundtrip, prod build + bundle gate.
- Behavioral tests for vscode-dependent modules use the established esbuild `--alias:vscode=<stub>` bundle pattern (`tests/unit/*.test.mjs`).

## Consequences

**Positive:** one client surface; access to v2-only features (questions already; context/compact/etc. next); removes dual-API hacks; cleaner typed calls.

**Negative / cost:**
- **Bundle:** hey-api's class-based v2 SDK is **not tree-shakeable per-method** — importing it pulls the whole generated client graph (~44KB). Host bundle 561.6KB → 618.1KB; host limit re-baselined 562 → 624KB. During Phases 1–4 **both** v1 (~30KB) and v2 (~44KB) ship; Phase 5 reclaims the v1 ~30KB.
- **Risk concentrated in Phase 4** (event pipeline). Mitigated by doing it last, under R1, with roundtrip/contract tests.

## Alternatives considered

- **Raw `fetch` to v2 REST endpoints** (zero bundle cost): rejected as the primary strategy — loses SDK typing/error handling and would be rewritten when the broader migration lands; acceptable only as a last resort for a single endpoint.
- **v2 raw transport (`@opencode-ai/sdk/v2/gen/client` `createClient`)** without the generated SDK class: smaller, but hand-rolled requests and churn when migrating to the typed client. Rejected for the same churn reason.
- **Stay on v1 + per-feature casts** (status quo): rejected — questions are unfixable on v1 and the dual-API hacks accumulate.

## References
- Beachhead commit `816a874`; `src/session/opencodeClientFactory.ts`, `AuthProvider.ts`, `SessionManager.ts`, `SessionClient.ts`.
- Related: `docs/implementation/2026-06-15-r1-unify-stream-state.md` (R1 — sequence Phase 4 with it).
