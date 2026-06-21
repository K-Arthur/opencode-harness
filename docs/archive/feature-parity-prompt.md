# Feature Parity & Enhancement — Full Execution Prompt

## Mission
Perform a systematic audit of every feature the opencode CLI exposes — theming, compaction, model selection, session history and naming, slash commands, permission modes, rate limiting, checkpoints — then compare each feature against its current extension implementation. For every gap, implement the best possible version for a VS Code sidebar context.

## Phase 0 — Index & Baseline (required before any code)

### Step 1: Repo Index
Use jCodemunch MCP tools:
```
resolve_repo { "path": "." }
plan_turn { "repo": ".", "query": "feature audit: ThemeManager, SessionManager, SessionStore, ModelManager, RateLimitMonitor, ContextMonitor, slash commands, permission modes, compaction, checkpoint, session naming, session history", "model": "claude-sonnet-4-6" }
```

### Step 2: Capture Baseline
```bash
npm run typecheck 2>&1 | tee /tmp/features-before-typecheck.txt
npm run test:unit  2>&1 | tee /tmp/features-before-tests.txt
```

### Step 3: Read These Files Completely
1. `src/theme/ThemeManager.ts`
2. `src/session/SessionManager.ts`
3. `src/session/SessionStore.ts`
4. `src/model/ModelManager.ts`
5. `src/monitor/RateLimitMonitor.ts`
6. `src/monitor/ContextMonitor.ts`
7. `src/checkpoint/CheckpointManager.ts`
8. `src/chat/webview/model-dropdown.ts`
9. `src/chat/webview/state.ts`
10. `src/chat/handlers/MessageRouter.ts`
11. `src/chat/webview/css/tokens.css`

Also read their corresponding `.test.ts` files to understand existing test coverage.

---

## Feature 1 — Theming

### CLI Baseline
The opencode CLI reads a tui.json active theme name, loads the matching theme .json from workspace or global config (~/.config/opencode/themes/), and applies a 20-property color palette covering messages, tool calls, diffs, thinking blocks, and 7 syntax highlight slots. Resolution order: VS Code tokens → preset → CLI theme file → settings overrides.

### 1.1 File Watching
- Watch CLI theme files (tui.json and loaded *.json) with `vscode.workspace.createFileSystemWatcher`
- On change: reload theme and re-inject CSS variables into webview without extension reload
- Dispose watcher on extension deactivation

### 1.2 Preset Completeness
- Four presets (cli-default, light, dark, high-contrast) must define ALL 20+ properties
- Missing tokens fall back to VS Code semantic colors — fallback must be explicit code, not silent undefined
- Audit each preset object for completeness

### 1.3 Settings Schema Parity
- `opencode.theme.overrides` in package.json must list every overridable property
- Add all missing properties with descriptions

### 1.4 forced-colors / High-Contrast Override
- When `@media (forced-colors: active)` is active, use system color keywords
- Required keywords: ButtonText, ButtonFace, CanvasText, Canvas, LinkText, GrayText

### 1.5 Theme Preview Command
- Add `opencode-harness.previewTheme` command
- QuickPick with all 4 presets + discovered CLI themes
- Selecting applies it live (writes to workspace settings)

### 1.6 CLI Theme Discovery
- Full resolution: workspace `.opencode/tui.json` → `~/.config/opencode/tui.json` (respecting $XDG_CONFIG_HOME)
- Parse JSON, extract theme name, load corresponding .json
- Map CLI color keys to extension token names

### Tests (RED first):
```
reloads_theme_on_tui_json_change
preset_high_contrast_defines_all_20_properties
cli_theme_discovery_prefers_workspace_over_global
missing_cli_theme_file_falls_back_to_preset_gracefully
forced_colors_override_uses_system_color_keywords
```

---

## Feature 2 — Compaction

### CLI Baseline
The opencode CLI supports /compact which summarises the conversation and replaces the message history with a compact summary, preserving context while freeing context window space. Triggers automatically or on demand.

### 2.1 autoCompact Setting Enforcement
- `opencode.autoCompact` has three values: `ask`, `auto`, `off`
- ContextMonitor.ts must read this setting at the point the 80% threshold is crossed — not just at activation
- The setting can change during a session

### 2.2 "Ask" Flow — Modal Quality
When autoCompact === 'ask':
- Show webview banner (preferred) not vscode.window.showInformationMessage
- Banner shows current context usage percentage + estimated tokens to recover
- CTAs: "Compact Now" and "Remind me later" (not Yes/No)
- "Remind me later" snoozes for 10 minutes or until context grows another 5%

### 2.3 Compact in Progress State
- Show system-message block: `─── compacting session ───` with spinner
- Disable input during compaction
- On complete: session-divider `─── compacted ───` + updated context usage in status bar

### 2.4 /compact Slash Command
- Verify /compact is registered, routed to server
- SSE events correctly handled in StreamCoordinator / MessageRouter

### 2.5 Compact History Preservation
- Summary stored in SessionStore
- Compact event visible as timeline marker in session history panel

### Tests:
```
autoCompact_ask_shows_banner_not_modal
autoCompact_banner_shows_usage_percentage
compact_in_progress_disables_input
compact_complete_inserts_session_divider
compact_snooze_rearms_after_5pct_growth
compact_slash_command_routes_to_server
```

---

## Feature 3 — Model Selection

### CLI Baseline
CLI allows per-session model switching via /model. Models listed in provider/model format, grouped by provider. Active model persists across restarts.

### 3.1 Model List Source
- Must come from opencode server (GET /models or SDK call), not hardcoded
- Fallback: last cached list in context.globalState
- No cache: static fallback list with warning badge

### 3.2 Model Grouping in Dropdown
- Group by provider with provider headers as separators
- Sort by capability tier (largest context window first)

### 3.3 Per-Tab Persistence
- Each tab's model selection persists to SessionStore
- TabManager stores modelId with tab state
- Restore on session resume

### 3.4 Model Change Mid-Conversation
- Send model switch event to server for that session
- Show system-message: `─── switched to {providerDisplayName} / {modelDisplayName} ───`
- Update model badge in tab header immediately

### 3.5 Context Window Indicator
- Dropdown shows each model's context window size (e.g. "200k tokens")
- Context usage bar shows usage relative to active model's specific limit

### 3.6 Model Availability Status
- Unavailable models show disabled state with tooltip explaining why
- Don't just disappear from the list

### Tests:
```
model_list_fetched_from_server_not_hardcoded
model_list_falls_back_to_cache_on_server_unavailable
model_grouped_by_provider_in_dropdown
per_tab_model_persists_to_session_store
model_change_emits_system_message_in_chat
context_bar_uses_active_model_context_limit
unavailable_model_shown_disabled_with_tooltip
```

---

## Feature 4 — Session History & Naming

### CLI Baseline
CLI maintains past sessions with title (auto-generated from first message), creation time, model, message count. Sessions resumable by name/ID. Stored in ~/.local/share/opencode/sessions/.

### 4.1 Session Title Auto-Generation
- Generate title from first 100 chars of first message
- Truncate at first sentence, max 40 chars
- Store immediately (not after turn completes — crash-safe)

### 4.2 Session Rename
- `opencode-harness.renameSession` opens InputBox with current name pre-filled
- Validate: non-empty, max 80 chars, no path separators
- Update SessionStore, tab header, and server-side metadata
- Handle renaming during streaming

### 4.3 Session History Panel
- Webview-based (NOT QuickPick), searchable, scrollable
- Each item shows: title (bold), relative date, model badge, message count + compact marker
- 3-dot overflow menu: Rename, Export, Delete, Open in new tab
- Updates in real time as messages arrive

### 4.4 Session Search
- Search input filters by title, message snippet, date
- Debounced 200ms
- Empty state for no results

### 4.5 Session Delete with Confirmation
- Show warning modal before deletion
- Close tab if session is open
- Abort stream if session is streaming

### 4.6 Session Export
- Markdown file with header (title, date range, model, message count, compact events)
- Messages: timestamp, role, content
- Tool calls: collapsed with summary, full args in <details>
- Diffs: fenced code blocks with filename header
- Save via showSaveDialog defaulting to ~/Desktop/{session-title}.md

### 4.7 Cross-Tab Session Navigation
- `opencode-harness.openStoredSession` checks if already open → focus that tab

### Tests:
```
session_title_generated_from_first_message_first_sentence
session_title_persisted_before_turn_completion
rename_validates_empty_and_oversized_names
rename_updates_tab_header_immediately
delete_streaming_session_aborts_stream_first
delete_requires_confirmation
open_stored_session_focuses_existing_tab
export_markdown_includes_tool_calls_and_diffs
session_history_search_debounced_200ms
```

---

## Feature 5 — Slash Commands

### CLI Baseline
Commands: /clear, /model, /cost, /new, /export, /compact, /continue, /help

### 5.1 Slash Command Parser
- Triggers on `/` as first character of input only
- Autocomplete popover with all commands, descriptions, keyboard navigation
- Filters as user types
- Enter submits, Escape dismisses

### 5.2 Command Implementations
| Command | Behaviour |
|---------|-----------|
| /clear | Clears tab messages (client-side), creates new server session, preserves old session in history |
| /model {id} | Switches model. No arg → opens dropdown. Accepts full and short form. |
| /cost | Shows token usage + estimated cost from server as system-message block |
| /new | New tab with fresh session. Does not close current tab. |
| /export | Triggers exportConversation (same format as Feature 4.6) |
| /compact | Triggers compaction (shows compact-in-progress state from Feature 2.3) |
| /continue | Resumes most recently closed session. None exist → "No previous session to continue." |
| /help | All slash commands with descriptions as Markdown table rendered inline |

### 5.3 Unknown Command Handling
- Show inline error: `Unknown command: /unknown. Type /help for available commands.`
- No crash, no silent ignore

### 5.4 Multi-Line Safety
- Slash commands ONLY trigger if `/` is first character of entire input
- `/src/index.ts` must NOT trigger command parser

### Tests:
```
slash_command_autocomplete_triggers_on_leading_slash
slash_command_mid_message_does_not_trigger
slash_unknown_shows_error_not_crash
slash_clear_preserves_session_in_history
slash_cost_shows_server_figures
slash_continue_focuses_most_recently_closed
```

---

## Feature 6 — Permission Modes

### CLI Baseline
Three modes: Normal (ask per action), Plan (read-only, review before apply), Auto (apply without asking). Mode persists per session.

### 6.1 Mode Persistence
- Stored per-tab in TabManager, persisted in SessionStore
- Restoring session restores mode
- New session defaults to Normal

### 6.2 Mode Selector UI
- Visible in header without scrolling
- Current mode has distinct visual indicator
- Updates immediately on click (no server round-trip)
- Disabled during streaming

### 6.3 Plan Mode Enforcement
- Diff blocks show "Review" label
- Accept button → "Approve & Apply" with prominent style
- Defensive: warn if server sends write tool call in Plan mode

### 6.4 Auto Mode Warning
- One-time confirmation: "Auto mode will apply all changes without asking."
- "Don't show again" option stored in context.globalState

### Tests:
```
mode_persisted_per_tab_in_session_store
mode_selector_disabled_during_stream
plan_mode_replaces_accept_with_approve_and_apply
auto_mode_shows_one_time_confirmation
auto_mode_confirmation_suppressible
```

---

## Feature 7 — Rate Limit Monitoring

### 7.1 Header Source
- Read from HTTP response headers: x-ratelimit-remaining-tokens, x-ratelimit-remaining-requests, x-ratelimit-reset-tokens
- Verify SDK passes headers through

### 7.2 Fallback Configuration
- `opencode.rateLimits` per-provider fallback when headers absent
- Degraded gracefully: show "limit unknown" not 0% or 100%

### 7.3 Status Bar Accuracy
- Update on every completed turn
- Display: min(tokensRemaining/tokensLimit, requestsRemaining/requestsLimit)

### 7.4 Rate Limit Reset Timer
- Critical/exhausted state shows countdown: "⚠ Rate limit exhausted — resets in 42s"
- Real-time countdown via setInterval
- Send button re-enables automatically at zero

### 7.5 Rate Limit Detail Panel
- `opencode-harness.showRateLimits` opens webview panel
- Table: provider, model, tokens remaining, requests remaining, reset time
- Historical sparkline (SVG, no external libraries)

### Tests:
```
rate_limit_uses_min_of_tokens_and_requests
rate_limit_fallback_used_when_headers_absent
send_button_reenables_automatically_on_reset
rate_limit_countdown_ticks_in_realtime
```

---

## Feature 8 — Checkpoints

### 8.1 Pre-Action Snapshot
- Git worktree snapshot BEFORE every write tool call on tracked files
- Synchronous, not after-write

### 8.2 Rollback Command
- `opencode-harness.rollback` QuickPick listing checkpoints: `{timestamp} — before {tool name} on {filename}`
- Diff preview before confirming
- Apply git worktree restore on confirm
- Success task-banner

### 8.3 Checkpoint Storage Limit
- Max 20 checkpoints per session
- Delete oldest when exceeded

### 8.4 Checkpoint on Compact
- Checkpoint before compact operation (session message history snapshot)

Feature 9 — Inline Suggestions (Tab Autocomplete)
Competitors: Continue, Copilot, Cursor
Gap: The extension has CodeLens actions (Explain, Refactor, Generate Tests) but no inline ghost-text suggestions as the user types in the editor. This is the #1 feature users expect from AI extensions.
Scope: Implement an InlineCompletionProvider that sends the prefix/suffix context to the opencode server and renders ghost-text completions. Configurable trigger delay, enable/disable toggle.

Feature 10 — Image & Multimodal Support
Competitors: Cline, Aider, ChatGPT
Gap: No ability to paste or attach images in the chat input. The webview has a file attachment dialog but doesn't handle image files or clipboard image paste.
Scope: Handle paste events for clipboard images, support image file attachments, encode to base64, send as multimodal content to the server.

Feature 11 — Drag & Drop File Attachments
Competitors: Continue, Cline, Copilot
Gap: The chat input has no drag-and-drop handler. Users must use @-mention or the file picker dialog.
Scope: Add dragover/drop event handlers on the input area, show drop zone highlight, attach files to the message.

Feature 12 — Code Block Actions (Copy, Insert, New File)
Competitors: Copilot, Continue, Cursor
Gap: Rendered code blocks in messages lack action buttons. No one-click copy, no "Insert at Cursor", no "Create New File".
Scope: Add a floating toolbar on code fence hover with Copy, Insert at Cursor, and Create New File buttons.

Feature 13 — Message Editing & Re-send
Competitors: ChatGPT, Copilot, Continue
Gap: Users cannot edit a previously sent message and re-send it. This is a standard chat UX pattern.
Scope: Add an edit action on user messages. Clicking opens the message content in the input area for re-submission. Clears downstream messages (standard pattern).

Feature 14 — Search Within Conversation
Competitors: Copilot, ChatGPT
Gap: No way to search within the current conversation's messages. Long sessions become hard to navigate.
Scope: Add a search bar (Ctrl+F in the message area) that highlights matching text across all messages with prev/next navigation.

Feature 15 — Notification & Sound System
Competitors: Cline, Copilot
Gap: No audio or visual notification when a long-running agent turn completes. Users switch away and don't know when it finishes.
Scope: Play a subtle notification sound (configurable) and show a VS Code notification when a turn completes while the webview is not focused.

Feature 16 — Prompt Files / Custom Slash Commands
Competitors: Continue (.prompt files), Cody (recipes), Cursor
Gap: Users cannot define custom slash commands or reusable prompt templates stored as files in the workspace.
Scope: Support .opencode/prompts/*.md files that appear as custom slash commands in the autocomplete. Variables like {{selection}}, {{file}}, {{language}} are substituted.

Feature 17 — Voice Input
Competitors: Aider, ChatGPT
Gap: No voice-to-text input option.
Scope: Integrate with the Web Speech API (browser-native) or VS Code's speech extension API for voice input to the chat. Toggle button in the input bar.

Feature 18 — Workspace Indexing & Semantic Context
Competitors: Copilot (@workspace), Cody (codebase search), Cursor (indexing)
Gap: The context engine exists but doesn't build a persistent semantic index. Context is gathered ad-hoc from open files, diagnostics, git status.
Scope: Build a lightweight embeddings index of the workspace (using the opencode server's embedding endpoint), persist in extension storage, use for semantic @codebase mentions that surface the most relevant chunks.

Updated Priority Assessment
Priority	Feature	Impact	Effort
P0	F9: Inline Suggestions	Very High — expected feature	High
P0	F12: Code Block Actions	High — daily-use QoL	Low
P0	F13: Message Editing	High — standard chat UX	Medium
P1	F10: Image/Multimodal	High — multi-modal models	Medium
P1	F11: Drag & Drop	Medium — convenience	Low
P1	F16: Prompt Files	Medium — power user feature	Medium
P1	F15: Notifications	Medium — long-running tasks	Low
P2	F14: Search in Conversation	Medium — navigation	Medium
P2	F17: Voice Input	Low — niche	Medium
P2	F18: Workspace Indexing	High but complex	Very High

### Tests:
```
checkpoint_created_before_write_not_after
rollback_shows_diff_preview_before_confirm
checkpoint_cap_at_20_deletes_oldest
checkpoint_created_before_compact
```

---

## Phase 9 — Deliverables

1. **ADR**: `docs/adrs/2026-05-04-feature-parity-audit.md` — document every gap found and approach chosen
2. **TechSpec**: Update `docs/TechSpec.md` — add/update sections for every feature area
3. **Status.md**: Update with feature parity audit complete, list implemented improvements
4. **register_edit** on all modified files
5. **Final verification**:
```bash
npm run typecheck && npm run test:unit && npm run build
diff /tmp/features-before-tests.txt <(npm run test:unit 2>&1)
```
Zero regressions. Net increase in passing tests.

---

## Hard Constraints (Non-Negotiable)

- ❌ No feature implementation without a failing test first (TDD red-green-refactor)
- ❌ No `any` types in new code
- ❌ No hardcoded model IDs, provider names, or context window sizes
- ❌ No `vscode.window.showInformationMessage` for chat-panel features — use system-message blocks
- ✅ `register_edit` after every file batch
- ✅ If budget_warning appears, stop exploring and implement what you have
- ✅ Fixes touching >5 files → ADR, not immediate implementation
- ✅ Max 5 files per phase
- ✅ Run `npm run typecheck && npm run test:unit` after each phase