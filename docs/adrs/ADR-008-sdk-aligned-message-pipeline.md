# ADR-008: SDK-Aligned Message Pipeline & Bidirectional Session Title Sync

**Status:** Accepted (Layers 1-7 landed 2026-05-17; deferred sub-layers tracked in test plan)
**Date:** 2026-05-16
**Companion spec:** [docs/specs/2026-05-16-message-pipeline-alignment.md](../specs/2026-05-16-message-pipeline-alignment.md)
**Companion test plan:** [docs/test-plans/2026-05-16-message-pipeline-tdd.md](../test-plans/2026-05-16-message-pipeline-tdd.md)
**Supersedes:** Partially supersedes [ADR-007-unified-session-identity.md](ADR-007-unified-session-identity.md) for session title handling.

## Context

The extension currently has three independent SDK→`Block` converters
(`sdkMessageConverter.partToBlock`, `StreamCoordinator.partsToBlocks`, and
inline mapping in `ChatProvider`'s "thinking" event), each emitting subtly
different shapes (`tool_call` vs `tool-call`, `text` vs `content` on
reasoning, etc.). Several SDK `Part` types (`step-start`, `step-finish`,
`patch`, `agent`, `retry`, `compaction`, `subtask`, `snapshot`) are
silently dropped. Session titles drift between the SDK's `Session.title`
and the extension's `SessionState.name`: the extension never calls
`client.session.update`, and never subscribes to `session.updated` /
`session.created` / `session.deleted`.

Recent incidents (the thinking-block bugs fixed earlier this session)
exist because the same logical mapping was implemented multiple times and
drifted. The cost of maintaining the divergence is now visible in
renderer fallbacks (`block.content || block.text`), defensive type checks
(`type === "tool_call" || type === "tool-call"`), and silent data loss
during reconnect/reload.

## Decision

We adopt **SDK shapes as the canonical model** for the extension's internal
message representation. Specifically:

1. **`Block` becomes a discriminated union** that is a thin, typed
   projection of `@opencode-ai/sdk` `Part`. The current property-bag
   `LegacyBlock` is deleted.

2. **One converter, one switch.** `sdkMessageConverter.partToBlock` is the
   only function in `src/` that branches on `part.type`. Streaming and
   reconnect paths delegate to it; the duplicates in `StreamCoordinator`
   and `ChatProvider` are removed.

3. **Streaming uses `part.id` for identity.** `EventMessagePartUpdated`
   carries the full part each time; we replace the block in
   `tab.blocksBuffer` keyed by `part.id`. The ad-hoc `stableToolPartId`
   reconstruction in `StreamCoordinator` is removed.

4. **Session title is bidirectionally synced via `client.session.update`
   and the `session.updated` SSE event.** The extension's local field
   `SessionState.name` is renamed to `title` to match the SDK.

5. **Lossless one-shot state migration.** `WebviewState` gains a
   `schemaVersion` field. On boot, blocks and session metadata are
   normalised to the canonical shape. Renderer-level fallbacks added in
   the previous session are kept for one release, then removed in v2.

6. **`SessionStore` (extension host) is the single source of truth for
   session metadata.** Webview persists only message arrays + active-tab
   state and queries the host for current session metadata on boot.

## Alternatives considered

### Alt 1 — Keep the current `Block` model; fix all producers to emit it consistently
Less SDK coupling, but two parallel type systems remain. Every future
SDK change still requires propagating shape mappings into multiple
producers. Defers the problem rather than fixing it. Rejected.

### Alt 2 — Define a new third internal shape, neither raw SDK nor current `Block`
Maximum design flexibility, maximum upfront cost, and no concrete need
the SDK shape doesn't meet. Rejected.

### Alt 3 — Keep three converters but extract a shared "fields" helper
Cosmetic. Doesn't address the discriminated-union gap (G2) or the silent-
drop gap (G3). Rejected.

### Alt 4 — Title sync via polling instead of `session.updated`
Simpler client code, but lags reality by the poll interval and adds
constant baseline traffic. The SSE channel is already open; piggy-backing
on it is free. Rejected.

## Consequences

**Positive**
- Adding a new SDK `Part` type means updating exactly one file
  (`sdkMessageConverter.ts`) and one renderer dispatch.
- TypeScript catches malformed blocks at the producer site instead of at
  runtime in the renderer.
- Historical sessions render via deterministic migration, not stacking
  fallback code paths.
- Session rename works the same way whether initiated in CLI, this
  extension, or a sibling window — and is observable in all of them.
- The `step-start`, `step-finish`, `patch`, `compaction`, `retry`,
  `agent`, `subtask`, `snapshot` part types become visible to users
  (previously silently dropped).

**Negative**
- Touches 20–40 files across the message pipeline. High review surface
  for a single change. Mitigated by the layered rollout (Section 8 of
  the spec) — one PR per layer, each independently green.
- Renaming `SessionState.name` → `title` is a wide rename. Mitigated by
  a codemod-style refactor with full type coverage.
- Migration code becomes load-bearing on cold start. Mitigated by golden-
  fixture tests and a `schemaVersion` guard that refuses to load
  downgraded state.

**Mitigations**
- Each layer of the rollout lands behind tests written first (TDD).
- Migration is exercised against three captured production-shape
  fixtures before release.
- Open question Q1 (does the server implement `PATCH /session/:id`?)
  must be resolved before the title-sync layer ships; the spec's
  Acceptance Criterion A3 is gated on it.

## Validation

- **Structural test (A2):** a meta-test scans the source for
  `switch (.*part\.type)` and asserts only `sdkMessageConverter.ts` matches.
- **Migration golden tests (A4):** three captured `WebviewState`
  snapshots from real user state, each diffed pre/post migration.
- **Round-trip session title test (A3):** Playwright integration test
  renames in extension, asserts `client.session.get` returns the new
  title.
- **Coverage gate (A8):** mutation score ≥ 85% on
  `sdkMessageConverter.ts` measured via `npm run test:mutation`.
- **Regression gate (A9):** all 1390 existing tests stay green at every
  rollout step.

## References

- Spec: docs/specs/2026-05-16-message-pipeline-alignment.md
- Test plan: docs/test-plans/2026-05-16-message-pipeline-tdd.md
- Related: ADR-001 (client-server), ADR-003 (SSE streaming), ADR-007 (session identity)
- SDK types: node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts:74-353,465-505
- Constitution: CLAUDE.md (project root)
