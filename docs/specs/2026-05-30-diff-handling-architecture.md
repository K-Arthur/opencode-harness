# Diff Handling — Architecture Review & Optimal Resolution

**Date:** 2026-05-30
**Status:** Phase 1 implemented (keystone wiring + render guard); Phases 2–4 proposed
**Scope:** How file diffs are produced, transported, and rendered across opencode (CLI/SDK/server), the extension host, and the webview — backend, frontend, and visual/UX.

---

## 1. Problem statement

Users report VS Code "freezing" around diff handling — unable to queue messages or
interact — and diffs not displaying. Investigation shows the root issues are
**(a) a broken/unwired data path** (the extension asked for per-file diffs but the
host never answered) and **(b) an unbounded synchronous render** that can block the
webview's single thread. Underneath both is an architectural mismatch: the extension
still carries an *inline diff apply/accept/reject* pipeline that is **dead code**,
because opencode applies edits **server-side**.

## 2. How the pieces actually interact (researched)

### opencode CLI / server / SDK (`@opencode-ai/sdk`)
- **Edits are applied server-side.** `write`/`edit`/`patch` tools run inside the
  opencode server; the client does not apply `WorkspaceEdit`s for agent changes.
- The server is the **source of truth for diffs**. Relevant SDK surface:
  - `client.session.diff({ path:{id}, query:{messageID} })` — whole-session diff;
    emits `session.diff` events carrying `{ file, additions, deletions }[]`.
  - `client.file.read({ query:{ path, directory } }) → FileContent` where
    `FileContent = { type:"text"|"binary", content, diff?: string, patch?: { hunks: Array<{oldStart,oldLines,newStart,newLines,lines:string[]}> } }`.
    **This is the authoritative per-file diff** (structured `patch.hunks` and/or a
    unified `diff` string).
  - `client.file.status()` / the `File` type `{ path, added, removed }` — changed-file
    list with counts.
  - SSE parts: `ToolPart` (write/edit args in `state.input`, result in `state.output`),
    `PatchPart` `{ hash, files:string[] }` (no inline diff — just a pointer).

### Extension host (`src/`)
- `EventNormalizer` + `SessionDiffHandler` turn `session.diff` events into
  `file_edited` → `changed_files_update` (paths + `added`/`removed`). **Works.**
- `SessionStore.changedFiles` + `getChangedFileStats` persist the list/counts. **Works.**
- `DiffApplier` / `DiffHandler` — apply/accept/reject/backup via `WorkspaceEdit`.
  **Dead for agent edits** (server applies them). `accept_hunk`/`reject_hunk`/
  `revert_diff` routes exist but are effectively unreachable.
- `get_file_diff` (per-file expansion) had **no host handler** and
  `file_diff_response` was **never emitted** → expansion showed nothing. *(Fixed, §4.)*

### Webview (`src/chat/webview/`)
- `changed-files-dropdown.ts` — strip + panel; preview capped at 60 lines
  (`_renderHunk`), expand/collapse mutates one row, rAF-coalesced updates. Good — but
  it was rendering against data that never arrived.
- `renderer.ts` in-chat diff block (`renderNewDiffBlock`) — rendered **every** hunk
  line synchronously, **no cap**. Reachable via backfilled `diff` blocks and a latent
  freeze hazard. *(Capped, §4.)*
- `handleDiff` / `stream_diff` exists but is **not wired** to any host message.

## 3. Root causes

| Symptom | Cause |
|---|---|
| Diff expansion shows nothing | `get_file_diff` unhandled on host; `file_diff_response` never sent |
| Potential webview freeze on large changes | Uncapped per-line synchronous DOM build in `renderNewDiffBlock` |
| Confusing/dead apply UI | Inline `DiffApplier` accept/reject pipeline unreachable (server applies edits) |
| Mismatched mental model | Extension treated as *applier*; it should be a *viewer* of server-computed diffs |

## 4. Phase 1 — implemented (keystone, low-risk, self-contained)

1. **Wire the dead path.** New host handler `get_file_diff` →
   `SessionManager.getFileContent` → `SessionClient.readFile` (`client.file.read`) →
   `sdkFileContentToDiffLines` → `file_diff_response { lines | error }`.
   Files: `src/chat/WebviewEventRouter.ts`, `src/session/SessionManager.ts`,
   `src/session/SessionClient.ts`.
2. **Pure normalizer** `src/chat/diff/sdkFileContentToDiffLines.ts` — converts
   `FileContent.patch.hunks` (or a unified `diff` string) into the webview's
   `DiffLine[]`, with correct old/new line numbering and add/remove/context typing.
   Fully unit-tested (`sdkFileContentToDiffLines.test.ts`).
3. **Render guard.** `createDiffTableWrapper` caps eager rows at
   `MAX_DIFF_LINES_RENDERED = 500` and defers the remainder behind a one-click
   "Show all changes (N more lines)" expander — mirrors the dropdown's 60-line cap and
   the 500-char tool-args cap. Test: `diff-line-cap.test.ts`.

## 5. Phases 2–4 — proposed

### Phase 2 — Backend correctness & performance
- **Off-thread normalization for huge diffs.** Parse very large unified diffs in a
  worker (constitution rule 5) so the host never blocks; stream rows in chunks.
- **Cache** `file.read` results per `(path, session-revision)`; invalidate on the next
  `file_edited` for that path. Avoids re-fetching on every expand.
- **Decommission dead apply code.** Gate `DiffApplier` apply/accept/reject behind an
  explicit "manual diff" capability flag, or delete it after confirming opencode owns
  application. Remove `accept_hunk`/`reject_hunk`/`revert_diff` from the webview
  contract if unused. (ADR required.)
- **Prefer `session.diff` for the whole-turn view**; use `file.read` only for the
  expanded file to keep payloads small.

### Phase 3 — Frontend rendering (functional)
- **Virtualize** the expanded diff: render a windowed slice on scroll instead of all
  rows (reuse the cap + incremental append; add an IntersectionObserver sentinel).
- **Per-line syntax highlighting** routed through the existing cached highlighter
  (`syntaxHighlighter.ts` LRU) so large diffs reuse the worker/cache path rather than
  re-highlighting on every render.
- **"Open in editor"** affordance on every diff (dropdown row + in-chat block) that
  invokes `vscode.diff` (`DiffApplier.showDiff`) — offload heavy/whole-file diffs to
  VS Code's native, virtualized diff editor instead of the webview.
- **Unify the two diff renderers** (`renderNewDiffBlock` and the dropdown's
  `_renderHunk`) onto one capped/virtualized component fed by `DiffLine[]`.

### Phase 4 — Visual / UX
- Consistent diff chrome: split/unified toggle, line-wrap toggle (exists), +/- gutter
  with line numbers, sticky hunk headers, add/remove color tokens from the CSS-layer
  design system ([[webview-css-architecture]]).
- Changed-files strip: status badges (A/M/D), aggregate +N/−M, click-to-expand inline
  with lazy diff fetch (now functional via Phase 1).
- Large-diff affordance: collapsed-by-default with "Show all / Open in editor", and a
  size warning beyond a threshold (e.g. > 2k lines) steering users to the native editor.
- Loading/empty/error states for the inline expansion (server down, binary file, no
  changes) — the `file_diff_response.error` field now carries these.

## 6. Verification
- Unit: `sdkFileContentToDiffLines.test.ts` (patch + unified-diff + empty/binary),
  `diff-line-cap.test.ts` (cap + expander + small-diff passthrough),
  `WebviewEventRouter.getFileDiff.test.ts` (route wiring/guards/contract).
- Manual: trigger an agent edit, open the changed-files dropdown, expand a file →
  real hunks render; expand a very large file → capped with "Show all"/"Open in editor".
- Typecheck must stay clean (note: a concurrent ChatProvider refactor — `autoModeService`
  — is currently red independent of this work).

## 7. Risks & coordination
- Webview/streaming files (`main.ts`, `composer.ts`, `streamHandlers.ts`,
  `StreamCoordinator*`, `ChatProvider.ts`) are under **active concurrent edits** by
  another agent. Phase 1 was deliberately confined to non-colliding files
  (`WebviewEventRouter.ts`, `SessionClient.ts`, `SessionManager.ts`, new `diff/` module,
  `renderer.ts` diff section). Phases 2–4 touching shared webview files should be
  sequenced after the concurrent refactor lands to avoid conflicts.
