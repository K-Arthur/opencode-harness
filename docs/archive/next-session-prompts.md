# Next-Session Prompts — OpenCode Harness

These prompts are self-contained instruction blocks for new sessions. Each follows the research-first, TDD methodology mandated by AGENTS.md.

---

## Prompt 1: W2.A — Highlight-Worker Separation (Bundle Size Relief)

> **⚠️ PREREQUISITE:** Read `docs/plans/highlight-worker-separation.md` (151 lines, 5 phases, fully specified) before starting.
> **Bundle:** Currently 773KB / 780KB. After separation: expect ~690KB main.js.

### Task

Move highlight.js (78.8KB) from the synchronous `main.js` bundle into the existing `markdownWorker.js` by dispatching all syntax highlighting asynchronously. The plan is fully specified in `docs/plans/highlight-worker-separation.md` — read it first, then implement phase by phase.

### Files

| File | Action |
|------|--------|
| `src/chat/webview/markdownWorker.ts` | Add `type: "highlight"` handler to `self.onmessage` |
| `src/chat/webview/renderer.ts` | Add `highlight()` method to `MarkdownWorkerClient`; replace sync calls |
| `src/chat/webview/syntaxHighlighter.ts` | Remove highlight.js imports, `highlightSyntax`, `ensureLanguagesRegistered`, cache |
| `src/chat/webview/streamHandlers.ts` | Update import to only `sanitizeHtml` |
| `src/chat/webview/toolCallRenderer.ts` | Update import to only `sanitizeHtml` |
| `src/chat/webview/renderer.ts` lines 318, 755, 771 | Replace sync highlight with async placeholder-swap |

### Key Constraints

- `syntaxHighlighter.ts` MUST keep `sanitizeHtml()` and `escapeHtml()` — still needed everywhere
- `renderCodeBlock` returns placeholder immediately (plaintext), updates asynchronously — Option A from plan
- `markdown-it` `highlight` callback returns `escapeHtml(str)` — sync rendering shows plaintext, finalized blocks get async colors
- Tool args/JSON: streaming uses `escapeHtml()`, finalized panels use async highlight
- Worker timeout default is 10s; fallback to `escapeHtml()`

### Verification

```bash
npm run typecheck && npm run build && npm run test:unit
```

Success criteria from plan:
- highlight.js is NOT in `dist/chat/webview/main.js`
- highlight.js IS still in `dist/chat/webview/markdownWorker.js`
- Code blocks render with colors in the webview
- Bundle size: `dist/chat/webview/main.js` ≤ ~700KB

---

## Prompt 2: W3.A+W3.B — Mermaid Diagrams + KaTeX Math Rendering

> **PREREQUISITE:** Complete W2.A (highlight-worker separation) first — the bundle MUST have headroom before adding Mermaid/KaTeX.

### Task

Add lazy-loaded Mermaid diagram rendering and KaTeX math rendering to markdown output. Both libraries are loaded via dynamic `import()` to avoid blocking the main bundle.

### Mermaid (W3.A)

**Detection:** ````mermaid` fenced code blocks in markdown output.
**Rendering:** Load `mermaid` (~150KB gzipped) lazily, render to SVG.
**Fallback:** If mermaid fails or times out, show the code block as-is.
**Files:** `src/chat/webview/renderer.ts` (markdown rendering), `src/chat/webview/markdownWorker.ts`

### KaTeX (W3.B)

**Detection:** `$$...$$` (display math) and `$...$` (inline math) in markdown output.
**Rendering:** Load `katex` (~100KB gzipped) lazily, call `katex.renderToString`.
**Edge cases:** Escaped `$`, code blocks containing `$`, mixed with inline code.
**Files:** same as Mermaid

### Design Decisions

- Both libraries loaded via dynamic `import()` — never in the main bundle
- Content rendered via the markdown worker path (`renderMarkdownAsync`)
- SVG/math output sanitized with existing `sanitizeHtml()`
- Timeout: 8s per render, fallback to plain code block

### Verification

```bash
npm run typecheck && npm run build && npm run test:unit
```

Write DOM-level tests:
- Mermaid code block produces `<svg>` element
- Display math `$$x^2$$` produces `.katex-display` element
- Inline math `$x^2$` produces `.katex` span
- Failed render shows code block as-is

---

## Prompt 3: W4.B — Real File Chips with Previews

### Task

Replace the text-dot strip in `src/chat/webview/file-chip-list.ts` with actual interactive `.file-chip` components. Each chip shows filename, extension icon, and remove button. Click opens file in editor. Hover shows file preview tooltip.

### Files

| File | Action |
|------|--------|
| `src/chat/webview/file-chip-list.ts` | Rewrite `renderFileChipListHtml` to produce real chip DOM |
| `src/chat/webview/css/components.css` | Add `.file-chip` styles |
| `src/chat/webview/changed-files-dropdown.ts` line 275 | Update strip rendering to use new chips |

### Chip Design

```
┌─────────────────────────────┐
│ 📄 filename.ts    [×]       │  ← extension icon + name + remove
└─────────────────────────────┘
```

- Extension icon: map `.ts`→TS, `.py`→PY, `.js`→JS, etc. (existing `inferLanguageFromPath` in renderer.ts)
- Remove button: clears chip from strip, does NOT revert file
- Click: `postMessage({ type: "open_file", path })`
- Hover tooltip: last 3 lines of the file content (lazy fetch)
- Keyboard: Tab navigates chips, Delete removes focused chip

### Verification

```bash
npm run typecheck && npm run build && npm run test:unit
```

Write DOM-level test in `file-chip-list.test.ts`:
- Chips render with filename and extension badge
- Click posts `open_file` message
- Remove button clears chip from DOM

---

## Prompt 4: W4.F — Prompt Template Library

### Task

Implement client-side CRUD for prompt templates stored in `globalState`. Each template has `{ name, content, tags? }`. Accessible via `/template` slash command and right-click "Save as template" on messages.

### Files

| File | Action |
|------|--------|
| `src/prompts/templateLibrary.ts` | NEW: CRUD operations on `globalState` |
| `src/chat/webview/commands-modal.ts` | Add `/template` slash command handler |
| `src/chat/webview/slashCommands.ts` | Register `/template` command |
| `src/chat/webview/main.ts` | Wire template CRUD postMessage handlers |
| `src/chat/webview/types.ts` | Add template-related types |
| `src/chat/ChatProvider.ts` | Add host handlers for template CRUD |

### Template Type

```typescript
interface PromptTemplate {
  id: string
  name: string
  content: string
  tags: string[]
  createdAt: number
  updatedAt: number
}
```

### UI Flow

1. Type `/template` → dropdown shows saved templates + "Save current as template"
2. Select template → inserts template content into prompt
3. Right-click any message → "Save as template" → modal for name/tags
4. `/template list` → shows all saved templates with edit/delete icons
5. `/template delete <name>` → deletes template

### Host Handlers

- `save_template` — upsert template to `globalState`
- `list_templates` — return all templates
- `delete_template` — remove template by id

### Verification

```bash
npm run typecheck && npm run build && npm run test:unit
```

Write unit tests for:
- CRUD operations on template library
- `/template` slash command dispatching
- Template insertion into prompt

---

## Prompt 5: Area A — Provider Connection from the Extension Webview

### SDK Research (read first)

The SDK exposes these surfaces (verified against `@opencode-ai/sdk@1.17.7`):

```typescript
// Auth management (v1)
client.auth.set({ providerID, auth: OAuth | ApiAuth | WellKnownAuth })
client.auth.remove({ providerID })

// Provider listing
client.provider.list() → Provider[]  // { id, name, source, env, key?, options, models }
client.provider.auth() → ProviderAuthMethod[]  // { type: "oauth"|"api", label, prompts? }

// OAuth flow
client.oauth.authorize({ providerID })  // starts OAuth, returns authorization URL
client.oauth.callback({ providerID, code })  // completes OAuth with auth code

// v2 Integration flow (newer, richer)
client.v2.integration.list() → IntegrationInfo[]  // { id, name, methods, connections }
client.v2.integration.get({ integrationID }) → IntegrationInfo
client.v2.integration.connect.key({ integrationID, key, label? })  // API key auth
client.v2.integration.connect.oauth({ integrationID, methodID?, inputs?, label? })
client.v2.integration.attempt.status({ attemptID })  // poll OAuth progress
client.v2.integration.attempt.complete({ attemptID, code })  // complete OAuth
client.v2.integration.attempt.cancel({ attemptID })
client.v2.credential.update({ credentialID, label })
client.v2.credential.remove({ credentialID })

// Auth type shapes
type OAuth = { type: "oauth", refresh, access, expires, accountId?, enterpriseUrl? }
type ApiAuth = { type: "api", key, metadata? }
type ProviderAuthMethod = { type: "oauth"|"api", label, prompts?: Array<TextPrompt|SelectPrompt> }
```

### Current Implementation

`ProviderManagementService.ts` (65 lines) has basic CRUD (`handleAddProvider`, `handleListProviders`, `handleUpdateProvider`, `handleDeleteProvider`) using `ProviderConfigManager`. No OAuth flow, no integration discovery, no credential management. The webview has `connect_provider` and `add_provider` message types but no UI for auth flows.

### What to Build

1. **Provider discovery panel** — List available providers from `client.provider.list()`, show connection status (connected/needs_key/needs_oauth), filter by type
2. **API key entry** — Modal form for entering API keys, wired to `client.auth.set({ providerID, auth: { type: "api", key } })`
3. **OAuth flow** — Button triggers `client.oauth.authorize()`, opens browser URL, polls/callback completes auth
4. **Credential management** — List stored credentials via `client.v2.integration.list()`, remove via `client.v2.credential.remove()`
5. **"Needs API Key" badge** on model dropdown items for models from unconfigured providers
6. **Handle `ProviderAuthError`** by opening the provider config UI

### Files

| File | Action |
|------|--------|
| `src/chat/ProviderManagementService.ts` | Add OAuth flow, integration discovery, credential management |
| `src/chat/webview/ui/providerPanel.ts` | NEW: provider configuration panel UI |
| `src/chat/webview/css/components.css` | Add provider panel styles |
| `src/chat/webview/model-dropdown.ts` | Add "Needs API Key" badge on unconfigured model items |
| `src/chat/ChatProvider.ts` | Wire provider panel messages |
| `src/chat/webview/types.ts` | Add provider panel message types |

### Verification

```bash
npm run typecheck && npm run build && npm run test:unit
```

---

## Prompt 6: Area B — Checkpoints / Snapshots / Rollback

### SDK Research (read first)

```typescript
// Revert/Unrevert
session.revert({ sessionID, messageID?, partID? })  // reverts a message
session.unrevert({ sessionID })  // restores all reverted messages

// Diff
session.diff({ sessionID, messageID? }) → SnapshotFileDiff[]
// SnapshotFileDiff = { file?, patch?, additions, deletions, status?: "added"|"deleted"|"modified" }

// Fork
session.fork({ sessionID, messageID? })  // creates a new session from a point

// Session state
Session.revert?: { messageID, partID?, snapshot?, diff? }  // active revert state

// Parts carrying snapshot IDs
SnapshotPart = { id, sessionID, messageID, type: "snapshot", snapshot: string }
StepStartPart = { ... type: "step-start", snapshot?: string }
StepFinishPart = { ... type: "step-finish", snapshot?: string }
PatchPart = { id, sessionID, messageID, type: "patch", hash, files: string[] }

// Config
Config.snapshot?: boolean  // enables/disables automatic snapshots
```

### Current Implementation

- `revert_message` handler exists in `WebviewEventRouter.ts` → calls `sessionManager.revertMessage()`
- `revert_result` / `revert_success` / `revert_failed` messages in webview types
- `revert_message` / `revert_diff` / `revert_hunk` postMessage types exist
- `list_checkpoints` / `restore_checkpoint` message types exist
- `CheckpointInfo` type in `types.ts` (id, sessionId, messageId, createdAt, filesChanged, action)
- "Rollback Changes" command `opencode-harness.rollback` exists in `src/commands/session.ts`

### What to Build

1. **Audit existing handlers** — Verify `revert_message` correctly calls `session.revert()` with right parameters
2. **Checkpoint panel** — New webview panel showing snapshot history for current session (rendered from `checkpoint_list` messages)
3. **Per-message revert UI** — Already partially exists (revert button on assistant messages). Verify wiring.
4. **Clarify per-file vs session-level** — Document the relationship. Per-file (changed-files dropdown Undo) = WorkspaceEdit to git HEAD. Session-level (revert_message) = `session.revert()` server-side.
5. **Snapshot timeline** — Visual timeline of snapshots with restore capability
6. **Restore checkpoint** — Wire `restore_checkpoint` to the snapshot restore flow

### Files

| File | Action |
|------|--------|
| `src/chat/WebviewEventRouter.ts` ~line 688-704 | Audit `revert_message` and `list_checkpoints` handlers |
| `src/chat/webview/ui/checkpointPanel.ts` | NEW: checkpoint/snapshot history panel |
| `src/chat/webview/main.ts` | Wire checkpoint panel rendering |
| `src/chat/webview/css/components.css` | Add checkpoint panel styles |
| `src/commands/session.ts` | Audit rollback command wiring |

### Verification

```bash
npm run typecheck && npm run build && npm run test:unit
```

---

## Prompt 7: Area C — Model Variant / Thinking Level Selection

### SDK Research (read first)

```typescript
// Prompt takes variant as string
session.prompt({ sessionID, variant?, model?, agent?, parts?, ... })

// Model has variants
Model.variants?: { [key: string]: { [key: string]: unknown } }

// ModelV2Info has richer variant info
ModelV2Info.variants: Array<{
  id: string
  headers: Record<string, string>
  body: Record<string, unknown>
  generation?: { maxTokens?, temperature?, topP?, topK?, ... }
  options?: Record<string, unknown>
}>

// ModelV2Info.request.variant?: string  — default variant

// Capabilities
Model.capabilities.reasoning: boolean  // whether model supports reasoning/thinking

// Message metadata
UserMessage.model.variant?: string
AssistantMessage.variant?: string

// Agent config
AgentConfig.variant?: string
```

### Current Implementation

- `variant-selector.ts` (195 lines): Hardcoded `["Default", "Low", "Medium", "High"]` variants with no server data source
- `thinkingToggle.ts`: Global visibility toggle for thinking blocks (display only)
- `set_variant` / `variant_update` postMessage types exist
- `StreamCoordinator.ts` passes `variant` to `session.prompt({ variant })`
- `ModelInfo` has `supportsVariants?: boolean` — gates variant selector visibility
- Variant selector is hidden when model doesn't support variants

### Key Questions to Resolve

1. **Where do variants come from?** The selector has hardcoded `["Default", "Low", "Medium", "High"]` but the SDK shows variants come from the model (`Model.variants` / `ModelV2Info.variants`). Should the selector populate from server data?
2. **What does `variant` actually do?** `session.prompt({ variant })` passes it to the server. Is it a model variant name or a reasoning effort level? The SDK `ModelV2Info.variants` suggests it's a variant ID with generation parameter overrides.
3. **Thinking vs variant relationship** — Models with `reasoning: true` show the variant selector. But "thinking" models (like Claude with extended thinking) might need a separate thinking budget slider, not just variant selection.

### What to Build

1. **Populate variants from server data** — Fetch `Model.variants` keys and show them instead of hardcoded `["Low", "Medium", "High"]`. Map "Default" to no variant.
2. **Verify variant wiring** — Trace `set_variant` → `StreamCoordinator` → `session.prompt({ variant })`. Ensure the variant string correctly reaches the server.
3. **Thinking budget for reasoning models** — If SDK exposes `ModelV2Info.variants[].generation.maxTokens` or similar, show a slider or dropdown for thinking/reasoning budget, not just variant name.
4. **Hide variant selector for non-reasoning models** — Already partially done via `supportsVariants`. Verify it uses `Model.capabilities.reasoning`.
5. **Per-mode model configuration** — `opencode.modeModels` may already support per-mode model assignment. Verify and document.

### Files

| File | Action |
|------|--------|
| `src/chat/webview/variant-selector.ts` | Populate from `Model.variants` keys instead of hardcoded |
| `src/chat/webview/model-dropdown.ts` | Pass variant info alongside model selection |
| `src/chat/webview/main.ts` | Fetch variant data when model changes |
| `src/chat/handlers/StreamCoordinator.ts` | Verify variant wiring to `session.prompt()` |

### Verification

```bash
npm run typecheck && npm run build && npm run test:unit
```

---

## Execution Order Recommendation

```
Session 1: Prompt 1 (W2.A Highlight-worker) — Unblocks W3.A+W3.B
Session 2: Prompt 2 (W3.A+W3.B Mermaid/KaTeX) — Depends on W2.A
Session 3: Prompt 3 (W4.B File chips) — Independent frontend work
Session 4: Prompt 4 (W4.F Prompt templates) — Independent feature
Session 5: Prompt 5 (Area A Provider connection) — Research-heavy, needs SDK audit
Session 6: Prompt 6 (Area B Checkpoints) — Research-heavy, needs code audit
Session 7: Prompt 7 (Area C Model variants) — Research-heavy, needs verification
```

Prompts 3-7 are independent and can run in parallel. Prompts 1→2 must be sequential.
