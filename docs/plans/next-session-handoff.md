# Next-Session Handoff — OpenCode Harness Feature Continuation

## ⚠️ CRITICAL: Research-First Mandate

**Before implementing ANYTHING** in this session, you MUST:

1. **Read the SDK documentation** — `@opencode-ai/sdk@1.17.7` (at `node_modules/@opencode-ai/sdk/dist/v2/*.d.ts`). Read the actual `.d.ts` files to understand the exact method signatures and type shapes. Do NOT assume — verify.

2. **Research the OpenCode server protocol** — Use `webfetch` to fetch `https://opencode.ai/docs` and understand how sessions, providers, snapshots, and variants work from the server's perspective.

3. **Read the existing codebase comprehensively** — For each area listed below, use jCodemunch tools (search_symbols, get_file_outline, get_file_content, search_text) to trace the full implementation before writing any new code. Cite file:line for every finding.

4. **Determine if the current approach is correct** — If the current implementation doesn't match how the SDK/server intends the feature to work, don't extend it — FIX it. Document what's wrong and why before writing code.

5. **Establish the correct approach** — Based on SDK docs + server protocol + codebase audit, determine the correct architecture. Then and only then implement.

6. **Write tests first (TDD)** — For every new function or behavior change, write a failing test first. Verify it fails, implement, verify it passes.

The three research-heavy areas below (Provider Connection, Checkpoints, Model Variants) REQUIRE steps 1-5 before any implementation begins. The diff/wrapping features (Tier 1) can follow steps 3-6. Do NOT skip the research phase.

## Context

The previous session completed **Wave 0 (stabilization)** and **most of Wave 1 (diff viewer + wrapping)** across 13 commits. The extension is at **v0.3.73**, installed and reindexed. The diff viewer now has:

- ✅ Wired accept/reject/revert diff+hunk buttons (real WorkspaceEdit flows)
- ✅ Word-level inline diff (diff-match-patch, TDD, 10 tests)
- ✅ Syntax highlighting inside diff lines (highlight.js, language inferred from file path)
- ✅ Per-hunk collapse/expand toggle
- ✅ Prev/next hunk navigation in sticky action bar
- ✅ Diff line-number color fix (old=red, new=green — was broken)
- ✅ Diff-wrap initial-state bug fixed
- ✅ Code-block wrap toggle (mirrors diff-wrap pattern)
- ✅ Tool-output `.tool-result-body--nowrap` CSS class
- ✅ Prompt-input max-height mismatch fixed (160px CSS+JS)
- ✅ `opencode.chat.wrapLongLines` setting added to package.json

## What Remains (Prioritized)

### Tier 1 — High Impact, Moderate Effort

#### 1. Side-by-Side Diff View (W1.D)
**Files:** `src/chat/webview/renderer.ts` (~line 1373, `createDiffTableWrapper`), `src/chat/webview/css/blocks.css`
**Approach:**
- Add a toggle button in the diff header (next to wrap toggle) that switches between unified and side-by-side modes
- Side-by-side = 2-column `<table>` layout: left column = old lines, right column = new lines, shared horizontal scroll
- Unchanged (context) lines span both columns or are duplicated
- Store preference in `displayPrefs.diffViewMode: "unified" | "side-by-side"`
- CSS: `.diff-table-wrapper--side-by-side { display: grid; grid-template-columns: 1fr 1fr; }` or use a real 2-col table with separate `<tbody>` per side
- **Key challenge:** Pairing removed/added lines for side-by-side layout. Use the same pairing logic from `wordDiff.ts` (`pairLinesInBlock`). Context lines appear in both columns.
- **Test:** Write TDD test in a new `sideBySide.test.ts` that verifies column alignment for mixed hunks

#### 2. Per-File Keep/Undo/Restore Cards (W1.E)
**Files:** `src/chat/webview/changed-files-dropdown.ts` (~line 570-620, `_renderTree`)
**Approach:**
- For each file row in the changed-files dropdown, add action buttons: Keep (acknowledge, no-op), Undo (revert file to git HEAD via WorkspaceEdit), Restore (re-apply from snapshot)
- "Keep" = visual ack only (file stays changed on disk)
- "Undo" = call existing `getFileBeforeAfter` → write `ba.before` via WorkspaceEdit (same as `reject_diff`)
- Wire buttons to new postMessage types: `keep_file`, `undo_file`, `restore_file`
- Add host handlers in `WebviewEventRouter.ts` (near line 500, where diff handlers are)
- **Test:** Add DOM-level test in `changed-files-dropdown.test.ts` for the new button rendering

#### 3. Bulk Accept-All / Revert-All (W1.F)
**Files:** `src/chat/webview/changed-files-dropdown.ts` (~line 496, `_renderStrip` or the dropdown header controls area)
**Approach:**
- Add "Accept All" and "Revert All" buttons in the `.cf-controls` area of the changed-files dropdown header
- "Revert All" = iterate all files, call `getFileBeforeAfter` for each, write `ba.before` via WorkspaceEdit (batch)
- "Accept All" = visual ack only (all files stay changed, mark all as accepted in UI)
- Wire to `accept_all_files` and `revert_all_files` postMessage types
- Add confirmation modal for "Revert All" (use existing `showRevertConfirmation` pattern)
- **Test:** Test in `changed-files-dropdown.test.ts`

### Tier 2 — High Impact, Higher Effort

#### 4. Highlight-Worker Separation (W2.A)
**Plan exists:** `docs/plans/highlight-worker-separation.md` (151 lines, 5 phases, fully specified)
**Why:** Reclaims ~80KB from webview bundle (currently at 767.4KB/770KB limit — only 2.6KB headroom)
**Approach:** Move `highlight.js` (78.8KB) out of `main.js` into `markdownWorker.js` via async highlight client. `renderer.renderCodeBlock` becomes async placeholder-swap.
**Prerequisite for:** Proper syntax-highlight in word-diff lines (currently skipped when wordDiffHtml is set)

#### 5. Mermaid Diagram Rendering (W3.A)
**Files:** `src/chat/webview/renderer.ts` (markdown rendering), `src/chat/webview/markdownWorker.ts`
**Approach:**
- Detect ````mermaid` fenced code blocks in markdown output
- Load `mermaid` library lazily (dynamic import, ~150KB gzipped)
- Render to SVG in a sandboxed iframe or via the markdown worker
- Add fallback: if mermaid fails, show the code block as-is
- **Test:** DOM-level test that verifies mermaid code blocks produce SVG elements

#### 6. LaTeX/KaTeX Math Rendering (W3.B)
**Files:** same as Mermaid
**Approach:**
- Detect `$$...$$` (display math) and `$...$` (inline math) in markdown output
- Load `katex` library lazily (~100KB gzipped)
- Render math to HTML via KaTeX's `renderToString`
- Handle edge cases: escaped `$`, code blocks containing `$`, mixed with inline code
- **Test:** DOM-level test for math block rendering

### Tier 3 — Medium Impact

#### 7. PDF Attachment Support (W4.A)
**Files:** `src/chat/handlers/attachmentStorage.ts`, `src/chat/webview/ui/attachments.ts`
**Approach:**
- Add `application/pdf` to `allowedMimes` in attachmentStorage.ts
- Read PDF as data URL, send as `FilePartInput` with `mime: "application/pdf"`
- No preview extraction needed initially — just pass the binary to the model
- **Test:** Unit test for PDF mime validation

#### 8. Real File Chips with Previews (W4.B)
**Files:** `src/chat/webview/file-chip-list.ts` (currently renders text dots, deliberately)
**Approach:**
- Replace the text-dot strip with actual interactive chips (`.file-chip` component)
- Each chip shows: filename, extension icon, remove button
- Click chip → opens file in editor
- Hover → file preview tooltip
- **Test:** DOM-level test for chip rendering

#### 9. One-Click Regenerate Last Assistant Turn (W4.E)
**Files:** `src/chat/ChatProvider.ts` (add `regenerate_last` handler)
**Approach:**
- New webview postMessage type: `regenerate_last`
- Host handler: get last assistant message → `session.revert({ messageID })` → re-send the original user prompt
- Add "Regenerate" button to the last assistant message's action bar
- **Test:** Structural test for the handler registration

#### 10. Prompt Template Library (W4.F)
**Files:** new `src/prompts/templateLibrary.ts`, `src/chat/webview/commands-modal.ts`
**Approach:**
- Client-side CRUD for prompt templates stored in `globalState`
- Each template: `{ name, content, tags? }`
- UI: `/template` slash command to list/insert, right-click "Save as template" on a message
- **Test:** Unit tests for CRUD operations

## Architecture Notes

- **Bundle size:** Currently 767.4KB / 770KB limit. The highlight-worker separation (W2.A) MUST be done before adding Mermaid/KaTeX, or the bundle will exceed limits.
- **Word-level diff works** but does NOT apply syntax highlighting to word-diff'd lines (only to pure additions/deletions). To highlight word-diff content, need async highlight (W2.A) to avoid blocking the main thread with 2x highlight calls per line.
- **Accept/Reject diff buttons** — "accept" is a UI bookmark (server already applied changes); "reject" reverts to git HEAD via WorkspaceEdit. This matches opencode's model where edits are server-side.
- **Changed-files dropdown** is the primary diff-review surface (not the in-message diff block). The in-message block is for plan-mode proposals and historical review.
- **Existing tests to preserve:** `tests/visual/diff-wrapping.spec.ts`, `src/chat/webview/diff-line-cap.test.ts`, `src/chat/webview/changed-files-dropdown.test.ts`, `src/chat/webview/wordDiff.test.ts`

## Verification Pipeline (per AGENTS.md)

After each feature:
```bash
npm run typecheck && npm run build && npm run test:unit
```

Before committing: ensure all pass. Commit small and frequent.

Before asking user to reload: `npm run reinstall` (bumps version, packages, installs, prunes stale).

## TDD Approach

Write test FIRST, verify it FAILS, then implement to make it PASS. The wordDiff.test.ts is the model to follow. For renderer tests, use JSDOM (see `diff-line-cap.test.ts` for setup pattern). For host-side handlers, use structural tests (read source, assert patterns exist).

## Key File Locations

| Area | Key Files |
|------|-----------|
| Diff rendering | `src/chat/webview/renderer.ts` (createDiffTableWrapper, createDiffLineRow, createHunkHeaderRow, createHunkActionCell, renderPendingDiffActions, createRevertDiffButton) |
| Word-level diff | `src/chat/webview/wordDiff.ts` + `wordDiff.test.ts` |
| Diff types | `src/chat/webview/types.ts` (DiffBlock, DiffHunk, DiffLine with wordDiffHtml?) |
| Changed-files dropdown | `src/chat/webview/changed-files-dropdown.ts` |
| Diff host handlers | `src/chat/WebviewEventRouter.ts` (~lines 500-560, 660-670, 1193-1210) |
| Diff CSS | `src/chat/webview/css/blocks.css` (~lines 1330-1600, diff-* classes) |
| Code-block CSS | `src/chat/webview/css/blocks.css` (~lines 97-175, code-block-*, code-wrap-toggle) |
| Wrap preferences | `src/chat/webview/renderer.ts` (readDiffWrapPreference, readCodeWrapPreference, persistDiffWrapPreference, persistCodeWrapPreference) |
| Bundle limits | `scripts/check-bundle-size.mjs` (LIMITS at line 139) |
| Highlight plan | `docs/plans/highlight-worker-separation.md` |
| SDK types | `node_modules/@opencode-ai/sdk/dist/v2/types.gen.d.ts` (SnapshotFileDiff, ToolPart, Part, etc.) |
| MCP config | `src/mcp/McpServerManager.ts` (sanitizeMcpServerConfig, accepts 'local' now) |
| Session store | `src/session/SessionStore.ts` (applyServerTitle, getChangedFileStats, forkSession) |

## Config Settings Added

- `opencode.chat.wrapLongLines` — `'on'|'off'|'auto'`, default `'auto'`, window-scoped
- `diff-match-patch` added as dev dependency (`@types/diff-match-patch` for types)

---

## 🚨 NEW: Research-Heavy Areas — REQUIRES FULL RESEARCH BEFORE IMPLEMENTATION

These three areas MUST be researched via (a) SDK documentation, (b) OpenCode server protocol (webfetch), and (c) comprehensive codebase audit before any implementation begins. The current implementation may be incomplete, incorrect, or using the wrong SDK surface. Do NOT extend the current approach until you verify it's correct.

### Area A: Provider Connection from the Extension Webview

**Problem:**
Connecting AI providers currently seems to require CLI interaction (opencode.json edits or CLI commands). Users expect to configure providers (set API keys, choose provider, manage OAuth) from the VS Code webview or settings panel — similar to Continue.dev, Cursor, or Cline.

**Research Questions (use webfetch + SDK audit + codebase audit):**

1. **SDK Surface:**
   - What does `client.provider.list()` return? Read `dist/v2/gen/sdk.gen.d.ts` for the exact return type.
   - What does `v2.provider.list()` return? Is it richer?
   - What's the `Provider` / `ProviderV2Info` type shape? Does it include `connected`, `needsAuth`, `authMethod`?
   - How does OAuth work? Read `dist/v2/gen/client.gen.d.ts` for `oauth.authorize` and `oauth.callback` signatures.
   - What does `client.auth.set({ providerID, auth })` take as the `auth` parameter?
   - Is there a `v2.credential.{update,remove}` API for credential management?
   - Read `types.gen.d.ts` for `FilePartInput`, `UserMessage`, `Error` types.

2. **Current Extension Implementation:**
   - How does `ProviderManagementService.ts` work? Read it fully. What CRUD does it support?
   - Where are provider credentials stored? SecretStorage? opencode.json? `client.auth.set()`?
   - Is there a "Connect Provider" flow anywhere in the webview?
   - How does `model-manager.ts` handle provider selection?
   - What does `session.ts` command `opencode-harness.selectModel` do?
   - Is `ProviderAuthError` from the SDK handled for onboarding?

3. **OpenCode Server/CLI:**
   - Use webfetch to check `https://opencode.ai/docs` for provider setup patterns.
   - How does the `opencode.json` config file define providers?
   - What's the `opencode.toml` or `opencode.json` schema for provider blocks?

4. **Competitive Analysis:**
   - Fetch `https://continue.dev/docs` or similar to see how Continue.dev handles provider UI.
   - Compare: Cursor's settings screen for providers vs our webview.

**Implementation Plan (after research):**
- Design provider onboarding flow for the webview (API key input, OAuth redirect, status badges)
- Add provider CRUD commands to the webview settings panel
- Wire credential storage through `client.auth.set()` or `v2.credential.update()`
- Add "Needs API Key" badge on model dropdown items
- Handle `ProviderAuthError` by opening the provider config UI

### Area B: Checkpoints / Snapshots / Rollback

**Problem:**
The "Rollback Changes" command and checkpoint concepts seem incomplete or conflicting. There may be multiple revert/snapshot/checkpoint mechanisms that overlap or contradict each other. The extension needs a coherent strategy.

**Research Questions (use webfetch + SDK audit + codebase audit):**

1. **SDK Surface:**
   - Read `session.revert({ sessionID, messageID?, partID? })` — what exactly happens server-side? Does it revert files, messages, or both?
   - Read `session.unrevert({ sessionID })` — what does this restore?
   - Read `session.snapshot(...)` if it exists — is there a snapshot API separate from revert?
   - What's `SnapshotPart`? `PatchPart`? Do they carry inline diff data or just IDs?
   - Read `session.diff({ sessionID, messageID? })` — returns `SnapshotFileDiff[]`. What does `SnapshotFileDiff.file`, `.patch`, `.additions`, `.deletions`, `.status` contain?
   - Is there a working-tree-level snapshot API? Or is it all session-level?
   - v2 surface: Is there anything in `v2.session.*` for checkpoints?

2. **Current Extension Implementation:**
   - Trace the "Rollback Changes" command (`opencode-harness.rollback`). Read `src/commands/session.ts` for the rollback handler.
   - Read `DiffAcceptService.ts` fully — what accept/reject model does it implement?
   - Read `DiffHandler.ts` — how are diffs registered and tracked?
   - Read `hunkRevertPlan.ts` and `hunkStaging.ts` — how do per-hunk reverts work?
   - Search for "checkpoint" across the codebase — any panel or UI?
   - How does `session.revert` get called? What parameters are passed?
   - Is there a checkpoint/snapshot panel in the webview?
   - How does PatchPart get rendered when loading historical messages?
   - What's the relationship between the `revert` field on Session (`Session.revert: { messageID, partID?, snapshot?, diff? }`) and the actual revert mechanism?

3. **OpenCode Server:**
   - Use webfetch to search `https://opencode.ai/docs` for snapshot/checkpoint concepts.
   - How does the CLI handle `session.revert`?

4. **Conceptual Cleanup:**
   - Determine the single source of truth: should checkpoints be snapshot-based (server state) or WorkspaceEdit-based (extension-local file changes)?
   - Should revert work per-message (undoing an entire assistant turn) or per-file (undoing changes to one file)?
   - What should rollback UI look like? A timeline? A diff list? A tree of snapshots?

**Implementation Plan (after research):**
- Depending on findings, either fix the existing revert/rollback pipeline or redesign it
- Add a checkpoint panel showing snapshot history for the current session
- Clarify the per-file revert (changed-files dropdown) vs session-level revert (rollback command) relationship

### Area C: Model Variant / Thinking Level Selection

**Problem:**
The variant selector exists (`variant-selector.ts` with "Default"/"Low"/"Medium"/"High") and thinking toggle exists (`thinkingToggle.ts`), but it's unclear if the wiring is correct for the SDK. The `variant` field may be mapped to the wrong SDK parameter, and the thinking/reasoning level may not actually affect the model's behavior.

**Research Questions (use webfetch + SDK audit + codebase audit):**

1. **SDK Surface:**
   - Read `session.prompt({ variant })` — what does `variant` mean to the server? Is it a model variant name (e.g., "claude-sonnet-4-v1") or a reasoning effort setting?
   - Read `ModelV2Info.request.generation` — does this exist? What fields? (temperature, maxTokens, topP, topK, frequencyPenalty, presencePenalty, seed, stop?)
   - Read `Model.variants` — what shape? Is it `{[name: string]: Partial<Model>}` or just string names?
   - Is there a `reasoning_effort` field anywhere in the prompt payload? In `UserMessage`? In `Prompt`?
   - Is there a `thinking` field on `TextPartInput` / `AgentPartInput`?
   - How do "thinking" models (like Claude with extended thinking) work in the SDK? Is there a separate thinking/reasoning budget?
   - Read `AgentConfig` — does it have `temperature`, `top_p`, `prompt`, `tools`, `steps`, `maxSteps`?

2. **Current Extension Implementation:**
   - Read `variant-selector.ts` fully — what variants does it offer? How does it wire to the prompt?
   - Read `thinkingToggle.ts` — what does it toggle? Is it related to reasoning variants or just a display toggle?
   - Trace how the variant is passed from webview → host → SDK. Look in `StreamCoordinator.ts` for `variant` usage.
   - Read `SessionClient.ts` for how `sendPromptAsync` constructs the prompt payload.
   - Is the variant correctly passed to `session.prompt({ variant })` or `session.prompt({ model })`?
   - Are `modelOptions` or generation parameters passed to the prompt?
   - Does the model capability check (`Model.capabilities.reasoning`) hide/show the variant selector?
   - Read `model-dropdown.ts` — does it filter by provider? By capability?

3. **OpenCode Server / Docs:**
   - Use webfetch to check `https://opencode.ai/docs` for variants/reasoning/thinking model support.
   - How does the CLI handle `opencode --variant`?

4. **Correctness Determination:**
   - If the SDK has no `reasoning_effort` field on the prompt payload, how does the variant selector work? Is it just setting a different model ID (e.g., "claude-sonnet-4" vs "claude-sonnet-4:thinking")?
   - If the variant selector just changes the model/variant string but doesn't actually affect the prompt payload, is it working correctly?
   - Is there a separate API for thinking budget / reasoning tokens?

**Implementation Plan (after research):**
- Depending on SDK findings: either fix the variant wiring, or document its correct usage
- If models have a `thinking` capability, add a "thinking budget" slider that maps to the correct SDK parameter
- Ensure non-reasoning models don't show the variant selector
- Wire the "thinking blocks" toggle to actually control reasoning visibility, not just display
- Consider adding per-mode model configuration (plan=high-reasoning, build=fast) — this may already be partially implemented via `opencode.modeModels`

---

## Final Notes

- After completing any feature, commit with a descriptive message referencing the feature code.
- Before the user reloads, run `npm run reinstall` to build + install the latest .vsix.
- If the bundle size exceeds limits, re-baseline `scripts/check-bundle-size.mjs` with justification.
- Run `jcodemunch_index_folder` to reindex after major changes.
- Do NOT modify files you don't own. Use `git status` before and after editing.
- Leave the 4 dirty files (README.md, docs/development/rebuild-and-reinstall.md, tests/integration/*.mjs) alone — they belong to another agent.
