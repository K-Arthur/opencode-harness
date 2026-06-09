# Message Pipeline Alignment Audit & Specification

**Date:** 2026-05-16
**Status:** Draft — awaiting approval
**SDK provenance:** Verified against `@opencode-ai/sdk@1.15.3` (current latest as of 2026-05-16; types byte-identical to installed `1.15.1`) and dev-branch `types.gen.ts` per opencode.ai/docs/sdk (last updated 2026-05-17).
**Companion ADR:** [ADR-XXXX-sdk-aligned-message-pipeline.md](../adrs/ADR-XXXX-sdk-aligned-message-pipeline.md)
**Companion test plan:** [docs/test-plans/2026-05-16-message-pipeline-tdd.md](../test-plans/2026-05-16-message-pipeline-tdd.md)

---

## 1. Goal

Align the extension's message handling with the canonical `@opencode-ai/sdk`
`Message` / `Part` model so that:

1. A message produced by the CLI, the SDK, or the extension renders identically.
2. Old chats in `globalState` / webview state continue to render after the
   alignment (lossless one-shot migration).
3. Session naming (`Session.title`) round-trips between the extension and the
   server in both directions.
4. There is exactly one converter between SDK shapes and the webview's
   internal `Block` model.

## 2. Canonical reference — what the SDK actually emits

From `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts`:

### 2.1 Session

```ts
type Session = {
  id: string
  projectID: string
  directory: string
  parentID?: string
  title: string        // ← canonical name field
  version: string
  time: { created: number; updated: number; compacting?: number }
  share?: { url: string }
  summary?: { additions: number; deletions: number; files: number; diffs?: FileDiff[] }
  revert?: { messageID: string; partID?: string; snapshot?: string; diff?: string }
}
```

### 2.2 Message

```ts
type Message = UserMessage | AssistantMessage
// AssistantMessage carries: id, sessionID, role, parentID, modelID, providerID,
// mode, path { cwd, root }, cost, tokens { input, output, reasoning, cache { read, write } },
// finish?, error?, time { created, completed? }, summary?
```

### 2.3 Part union

```ts
type Part =
  | TextPart             // type: "text", text, synthetic?, ignored?, time?
  | ReasoningPart        // type: "reasoning", text, time { start, end? }
  | FilePart             // type: "file", mime, filename?, url, source?
  | ToolPart             // type: "tool", callID, tool, state: ToolState
  | StepStartPart        // type: "step-start", snapshot?
  | StepFinishPart       // type: "step-finish", reason, cost, tokens, snapshot?
  | SnapshotPart         // type: "snapshot", snapshot
  | PatchPart            // type: "patch", hash, files[]
  | AgentPart            // type: "agent", name, source?
  | RetryPart            // type: "retry", attempt, error, time { created }
  | CompactionPart       // type: "compaction", auto
  | { type: "subtask"; prompt; description; agent }
```

### 2.4 Event types (SSE)

```
message.updated         { info: Message }
message.removed         { sessionID, messageID }
message.part.updated    { part: Part; delta?: string }
message.part.removed    { sessionID, messageID, partID }
session.created         { info: Session }
session.updated         { info: Session }     // ← title changes arrive here
session.deleted         { info: Session }
session.idle / status / error / diff / compacted
permission.updated / replied
```

## 3. Current extension pipeline — what we actually do

### 3.1 Inbound conversion paths (3 different converters!)

| Producer | File | Output shape |
|---|---|---|
| Live SSE event `"thinking"` | `ChatProvider.ts:621-628` | `{ type: "thinking", content, streaming: true }` (just fixed) |
| Historical session load | `sdkMessageConverter.ts:partToBlock` | `{ type: "thinking", content, streaming: false }` / `{ type: "tool_call", … }` |
| Snapshot / reconnect rebuild | `StreamCoordinator.partsToBlocks` | `{ type: "tool-call", … }` / `{ type: "thinking", content, streaming: false }` (just fixed) |
| Live streaming text/tool chunks | `streamHandlers.ts` (live deltas) | In-place DOM updates against `tab.blocksBuffer` |

Each converter handles a different subset of part types, with inconsistent
field names. None of them handle `step-start`, `step-finish`, `snapshot`,
`patch`, `agent`, `retry`, `compaction`, `subtask`, or `file` (except images
in `sdkMessageConverter`).

### 3.2 The `Block` type itself is degenerate

`src/chat/webview/types.ts:78-116`:

```ts
export interface LegacyBlock {
  type: string
  text?: string; code?: string; language?: string; skillName?: string
  toolType?: string; toolName?: string; args?: unknown; result?: string
  filePath?: string; diffText?: string; id?: string; permissionId?: string
  class?: ToolCallClass; state?: string; name?: string; diffId?: string
  path?: string; hunks?: DiffHunk[]; linesAdded?: number; linesRemoved?: number
  content?: string; tokenCount?: number; streaming?: boolean
  detail?: string; retryable?: boolean; status?: string; message?: string
  data?: string; mimeType?: string; durationMs?: number
  [key: string]: unknown
}
export type Block = LegacyBlock   // ← The discriminated unions are unused
```

Discriminated unions `ToolCallBlock`, `DiffBlock`, `ThinkingBlock`,
`ErrorBlock` exist but `Block` aliases the legacy bag instead of being the
sum of them. Type guards (`isToolCallBlock`, etc.) do runtime narrowing but
nothing forces producers to emit a valid shape.

### 3.3 Naming inconsistencies (audit-verified)

| Field / value | Used by | Conflicting place |
|---|---|---|
| `block.type === "tool_call"` | sdkMessageConverter, CommandExecutionService, SessionExporter (4 places) | Renderer expects `"tool-call"` (with hyphen). Many call-sites defensively check both. |
| `block.text` on thinking blocks | (formerly) sdkMessageConverter, ChatProvider | Renderer reads `block.content` (we just patched the renderer to tolerate both). |
| `Session.title` (SDK) | `client.session.create({ body: { title } })`, `client.session.update({ path, body: { title } })`, `session.updated` SSE | Extension keeps a local `name` compatibility cache, but synced rows prefer server title. |
| `block.toolType` vs `block.class` vs `block.name` | Various tool-call producers | Three different names for the same concept. |

### 3.4 Session naming — original gaps and current behavior

`SessionManager.createSession(title)` calls `client.session.create({ body: { title } })`
and stores the returned `Session.title` only transiently. The local
`SessionStore` originally kept `session.name` independently.

Resolved implementation:

- `SessionStore.setTitle(id, title)` writes the local cache and calls
  `SessionManager.updateSessionTitle(serverId, title)`, which wraps SDK
  `client.session.update({ path: { id }, body: { title } })`.
- `SessionUpdatedHandler` subscribes to `session.updated`; the extension
  applies `info.title` through `SessionStore.applyServerTitle()`.
- Synced session rows prefer server `Session.title`. Local `name` remains as
  a compatibility/cache field until the wider `name -> title` rename lands.

Net: the two stores drift the moment a session is renamed on either side.

### 3.5 Persistence

`WebviewState.sessions[sessionId].messages: ChatMessage[]` is persisted via
`vscode.setState`. Each message carries `blocks: Block[]` with whatever
shape it had when first persisted. There is **no per-message migration** in
`migrateState` — only top-level shape (`sessions` map presence) is migrated.
Any historical block written with `text:` instead of `content:`, or with
`type: "tool_call"` instead of `"tool-call"`, will stay broken forever
unless the renderer falls back to legacy fields.

Extension-side `SessionStore` (`globalState` via `context.globalState`) is
a *separate* persistence layer with its own session list, messages, etc. —
also not migrated message-by-message.

## 4. Gaps & risks catalogued

### G1 — Three independent SDK→Block converters
**Risk:** They drift. Bug 5–7 from the recent thinking-toggle audit existed
because the same logical mapping was implemented 3× with different field
names. Adding a new SDK part type requires changes in 3 files; missing one
silently drops content.

### G2 — Block model is an untyped property bag
**Risk:** TypeScript provides no help when a producer omits a required
field. The recent thinking-block bug compiled fine because `LegacyBlock`
makes every field optional and `[key: string]: unknown` swallows any name.

### G3 — Unsupported part types silently dropped
**Risk:** `step-start`, `step-finish`, `snapshot`, `patch`, `agent`, `retry`,
`compaction`, `subtask` are filtered out by `partToBlock`'s `default: return null`.
For sessions that compacted (most multi-turn ones), users see no indicator;
for sessions that retried, retries are invisible; for subtask delegations,
the subtask boundary is lost.

### G4 — Session.title ↔ session.name mismatch (bidirectional)
**Risk:** User-facing inconsistency. Rename in CLI → not reflected in
extension. Rename in extension → not reflected in CLI/other extension
windows. Sessions created in the extension can show "Untitled session" in
the CLI's session list.

### G5 — No `session.updated` / `session.created` / `session.deleted` SSE handlers
**Risk:** External session lifecycle changes (CLI deleting a session,
another window renaming it) are invisible to this extension until next
manual refresh.

### G6 — No versioned migration for `WebviewState.sessions[*].messages[*].blocks[*]`
**Risk:** Once a block is persisted with the wrong shape, only renderer
fallbacks keep it visible. Each new shape change extends the fallback
matrix. Eventually unmaintainable.

### G7 — Field naming drift inside the extension
**Risk:** `tool_call` vs `tool-call`, `text` vs `content`, `toolType` vs
`class` vs `name`. Every read site needs `||` chains.

### G8 — Streaming partial state not modeled
The SDK's `EventMessagePartUpdated` carries `delta?: string` for incremental
text. The extension reconstructs deltas via `tab.blocksBuffer` mutation and
DOM patching, without a typed model of "this part is mid-stream." That
makes resuming after reconnect fragile (see existing
`StreamCoordinator.transport.test.ts` reconnect paths).

### G9 — `WebviewState.sessions` and `SessionStore.sessions` are two truths
The extension persists session metadata twice: once in webview state
(per-webview), once in `globalState` (per-extension). Title/name lives in
both. There is no defined source of truth.

## 5. Proposed design (summary — full rationale in the ADR)

### 5.1 Single canonical model — `CanonicalBlock`

Introduce a discriminated-union `CanonicalBlock` that is a 1:1 typed
projection of SDK `Part` types, plus the small number of derived blocks the
webview needs (e.g. `diff` derived from a `patch` + file diff lookup).
`Block` becomes `CanonicalBlock`. `LegacyBlock` is deleted.

```ts
type CanonicalBlock =
  | { type: "text"; text: string; synthetic?: boolean }
  | { type: "reasoning"; text: string; streaming: boolean; timeStart: number; timeEnd?: number; tokenCount?: number }
  | { type: "file"; mime: string; filename?: string; url: string; sourcePath?: string }
  | { type: "tool"; callID: string; tool: string; toolClass: ToolClass; state: ToolStateBlock; args?: unknown; result?: string; error?: string; durationMs?: number }
  | { type: "step-start"; snapshot?: string }
  | { type: "step-finish"; reason: string; cost: number; tokens: TokenBreakdown; snapshot?: string }
  | { type: "patch"; hash: string; files: string[] }
  | { type: "agent"; name: string }
  | { type: "retry"; attempt: number; errorMessage: string; createdAt: number }
  | { type: "compaction"; auto: boolean }
  | { type: "subtask"; prompt: string; description: string; agent: string }
  | { type: "snapshot"; snapshot: string }
  // webview-only (derived):
  | { type: "diff"; diffId: string; path: string; hunks: DiffHunk[]; state: DiffState; linesAdded: number; linesRemoved: number; revertable?: boolean }
  | { type: "skill-badge"; skillName: string }
  | { type: "permission"; permissionId: string; pattern?: string }
  | { type: "error"; code: string; message: string; detail?: string; retryable: boolean }
```

(`reasoning` keeps the SDK's name. The `thinking` alias is retired post-migration.)

### 5.2 Single converter

`src/session/sdkMessageConverter.ts` becomes the **only** site that maps SDK
`Part` → `CanonicalBlock`. It exports:

```ts
export function partToBlock(part: Part, opts?: { streaming?: boolean }): CanonicalBlock | null
export function partsToBlocks(parts: readonly Part[], opts?): CanonicalBlock[]
export function sdkMessageToChatMessage(info: Message, parts: readonly Part[]): ChatMessage | null
```

`StreamCoordinator.partsToBlocks` and `ChatProvider`'s
`"thinking"` event handler delegate here. Field-name forks die.

### 5.3 Streaming model

`message.part.updated` events are routed through a thin reducer that:

1. Calls `partToBlock(part)` to get the canonical block.
2. Sets `block.streaming = true` when the part has no `time.end` (or for
   text, when a `delta` was supplied but `synthetic` is false).
3. Locates the block in `tab.blocksBuffer` by `part.id` (stable across
   chunks per SDK contract) and replaces it.
4. The renderer's existing `renderBlock` is invoked with the new block; the
   DOM-morphing path (already in `messageRenderer.ts`) handles the patch.

This makes `block.id === part.id` the single source of identity, removing
the ad-hoc `stableToolPartId` heuristic in `StreamCoordinator`.

### 5.4 Session naming — bidirectional sync

1. **Local rename → server.** `SessionStore.updateName(id, name)` is superseded
   by `setTitle(id, title)` and, after local write, calls
   `sessionManager.updateSessionTitle(serverId, title)`. `serverId` resolves
   to `cliSessionId` when present, otherwise the session id if it is already
   a real OpenCode server id. The manager wraps SDK `client.session.update`
   / `PATCH /session/{id}` with `{ title }`.
2. **Server rename → local.** `SessionUpdatedHandler` normalizes
   `session.updated` to `session_updated`; the extension applies
   `info.title` through `SessionStore.applyServerTitle()` and fires
   `_onSessionsChanged`.
3. **Field compatibility.** `SessionState.name` remains as the compatibility
   cache for now, but server `Session.title` is authoritative for synced
   sessions. Webview rows prefer server title over local title.
4. **Identity.** OpenCode server session id is canonical for synced
   sessions. `cliSessionId` is a legacy attachment alias used for migration
   and event routing. Duplicate local/server rows that point at the same
   server id are merged into one server-keyed record.

### 5.5 Lossless one-shot migration

`migrateState` gains a `schemaVersion` field on `WebviewState`. On load:

| From | To | Rules |
|---|---|---|
| no `schemaVersion` (legacy) | v1 | Walk `sessions[*].messages[*].blocks[*]`. Apply per-block normaliser: `tool_call`→`tool`, `text` (on thinking)→`text` keeping `reasoning`, `content` (on thinking)→`text`, drop `toolType` if `tool` present, etc. Copy session `name`→`title`. |
| v1 | v2 (future) | TBD |

Migration is pure, deterministic, and tested with golden fixtures from
real-user state snapshots (we'll capture 3 from current `globalState`).

Renderer fallbacks added in the previous turn are retained for one release
as a safety net, then deleted in v2.

### 5.6 Single source of truth for session metadata

`SessionStore` (extension host) becomes the authoritative store for
`(id, title, model, mode, lastActiveAt, cliSessionId)`. Webview persists
only message arrays + active-tab state; on boot it requests current
session metadata from `SessionStore` rather than reading its own copy.

## 6. Non-goals (this spec)

- Rewriting the SSE transport. We keep the existing event router; only the
  event → block mapping changes.
- Changing how tool-result diffing works (`DiffBlock` derivation stays
  webview-side; the spec just gives it a stable type).
- Changing persistence backends (still `vscode.Memento` / `vscode.setState`).
- Theming, layout, accessibility — out of scope.

## 7. Acceptance criteria

A1. Every SDK `Part` variant has exactly one canonical block representation
documented in [src/chat/webview/types.ts](../../src/chat/webview/types.ts).
A2. `partToBlock` is the only function in `src/` that switches on `part.type`
(verified by a structural test).
A3. Renaming a session in the extension propagates to the server within
≤1 SSE round-trip; renaming on the server propagates to the extension on
the next `session.updated` event.
A4. A captured pre-alignment `WebviewState` snapshot loads, migrates, and
renders identically to its source after a round-trip through `migrateState`.
A5. New SDK part types (`step-start`, `step-finish`, `patch`, `agent`,
`retry`, `compaction`, `subtask`, `snapshot`) each have a render
(possibly minimal — a labeled chip) and a regression test.
A6. `Block` is a discriminated union; `LegacyBlock` is deleted; TypeScript
flags any producer that emits an unknown shape.
A7. `noUncheckedIndexedAccess` remains on; no new `any` introduced.
A8. Mutation score on `sdkMessageConverter` ≥ 85% (it's the system's
integration boundary — extra coverage warranted).
A9. Zero behavior regressions in the existing 1390-pass unit suite.

## 8. Rollout

1. Land ADR + spec (this doc + companion). No code change.
2. RED: write the full test plan (Section 9 of the test-plans doc) —
   every assertion fails against current code.
3. GREEN: layer by layer (converter → reducers → stream coordinator →
   webview Block type → migration → session naming sync), one PR each, each
   keeping all prior tests green.
4. REFACTOR: delete `LegacyBlock`, remove renderer fallbacks (in a later
   release), update `docs/TechSpec.md`, update architecture diagram.
5. Cut a release; monitor for migration failures.

## 9. Open questions

Q1. The SDK type generator currently exposes `client.session.update` via
the generated client — does the running opencode server actually implement
PATCH on the session resource? If not, we negotiate an upstream change or
fall back to a local-only title with explicit "not synced" UI.

Q2. For sessions with thousands of messages (auto-compacted), how should
`patch` / `compaction` blocks render? Proposed: a single fold marker per
contiguous run. Decide before A5.

Q3. Migration write strategy: write back the migrated state immediately,
or only on next save? Proposed: immediately after migrate, gated behind
schemaVersion bump, so a downgrade can detect and refuse to load.
