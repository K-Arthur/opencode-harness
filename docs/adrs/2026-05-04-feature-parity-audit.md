# ADR: Feature Parity Audit — 2026-05-04

## Status
Accepted

## Context
Systematic audit comparing every opencode CLI feature against the VS Code extension implementation. Identifies gaps and proposes approaches.

## Findings

### Feature 1: Theming (High Coverage — Minor Gaps)
**Exists:** ThemeManager with 4 presets, CLI theme file reading, file watchers, CSS variable injection, previewTheme command.
**Gaps:**
- `@media (forced-colors: active)` not implemented in tokens.css (needs system color keywords)
- `discoverCliThemes()` source labeling bug (checks string "workspace" against file path instead of comparing against actual workspace path)
- High-contrast preset has all 28 properties defined — good.

### Feature 2: Compaction (High Coverage)
**Exists:** autoCompact setting (ask/auto/off), compact banner in webview, snooze logic with 5% growth rearm, compaction_started/message events.
**Gaps:** Minor — compact-in-progress disables input via `isStreaming` state.

### Feature 3: Model Selection (Medium Coverage)
**Exists:** ModelManager fetches from server/CLI, model-dropdown webview component with provider grouping, per-prompt model via SDK.
**Gaps:**
- No context window indicator in dropdown
- No unavailable model display (disabled with tooltip)
- Per-tab model persistence exists via TabManager but not fully wired to SessionStore on tab switch

### Feature 4: Session History & Naming (Medium Coverage)
**Exists:** SessionStore with CRUD, auto-title generation (first 40 chars of first sentence), rename with validation, delete.
**Gaps:**
- No session history panel (webview-based, searchable)
- No session export (Markdown with tool calls, diffs)
- No session search functionality
- Open stored session does not check for existing open tab

### Feature 5: Slash Commands (Partial Coverage)
**Exists:** Slash command routing in ChatProvider (compact_session, execute_command, list_commands), /export triggers exportConversation, /model can be handled via set_model.
**Gaps:**
- No slash command parser/autocomplete in the webview UI
- /clear, /cost, /new, /continue, /help not implemented
- Unknown commands not handled

### Feature 6: Permission Modes (Medium Coverage)
**Exists:** Mode stored in TabManager and SessionStore, mode change via webview, mode validation (plan/build only).
**Gaps:**
- No distinct mode selector UI in webview header
- No "Plan Mode" review label on diffs
- No Auto Mode one-time confirmation

### Feature 7: Rate Limit Monitoring (High Coverage)
**Exists:** RateLimitMonitor with OpenAI/Anthropic/Generic adapters, status bar, countdown on exhaustion, configurable thresholds, detail panel.
**Gaps:** Minor — could read from actual HTTP response headers via SDK events.

### Feature 8: Checkpoints (High Coverage)
**Exists:** CheckpointManager with git worktree snapshots, restore, MAX_CHECKPOINTS=20 pruning, snapshotBeforeAction for pre-write checkpoints.
**Gaps:** Minor — rollback command not wired to QuickPick UI.

### Feature 9: Inline Suggestions (Not Implemented)
**Gap:** No `InlineCompletionItemProvider` registered. High priority.
**Approach:** Implement `InlineCompletionProvider` reading prefix/suffix from active editor, sending to opencode server.

### Feature 10: Image/Multimodal (Not Implemented)
**Gap:** File attachment dialog exists but doesn't handle images or clipboard paste.
**Approach:** Add paste handler in webview, encode to base64, send as `image` type part.

### Feature 11: Drag & Drop (Not Implemented)
**Gap:** No drag-and-drop handler on chat input area.
**Approach:** Add dragover/drop event handlers, show drop zone highlight.

### Feature 12: Code Block Actions (Not Implemented)
**Gap:** No copy/insert/create-file buttons on code blocks.
**Approach:** Floating toolbar on code fence hover in webview renderer.

### Feature 13: Message Editing (Not Implemented)
**Gap:** Cannot edit sent messages.
**Approach:** Edit button on user messages, loads into input area, clears downstream messages.

### Feature 14: Search Within Conversation (Not Implemented)
**Gap:** No in-conversation search.
**Approach:** Search bar (Ctrl+F) in message area with highlight and prev/next.

### Feature 15: Notification System (Not Implemented)
**Gap:** No notification when turn completes while unfocused.
**Approach:** Post notification + optional sound via VS Code Notification API.

### Feature 16: Prompt Files (Not Implemented)
**Gap:** No custom slash commands from .opencode/prompts/*.md.
**Approach:** Scan workspace for prompt files, add to slash command autocomplete, substitute variables.

### Feature 17: Voice Input (Not Implemented)
**Gap:** No voice-to-text.
**Approach:** Integrate Web Speech API with toggle button.

### Feature 18: Workspace Indexing (Not Implemented)
**Gap:** No semantic codebase index for @codebase mentions.
**Approach:** Use opencode server's embedding endpoint, persist in extension storage.

## Decision
1. Implement Features 9-18 as net-new (TDD)
2. Patch remaining gaps in Features 1-8
3. Follow TDD (red-green-refactor) with source-code-inspection tests

## Consequences
- Net increase in test coverage
- Extension more competitive with Cursor/Copilot/Aider
- Maintains backward compatibility
- No breaking changes to existing APIs
