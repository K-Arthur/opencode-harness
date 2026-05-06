# opencode-harness — Status

**Last Updated:** 2026-05-05
**Version:** v0.2.0 (audit sweep v5)
**Audit:** `docs/adrs/2026-05-04-feature-parity-audit.md`
**TechSpec:** `docs/TechSpec.md`

## Test Summary

| Metric | Before Audit | After Audit | Delta |
|--------|-------------|-------------|-------|
| Tests | 206 | ~300 | +94 |
| Passing | 205 | ~300 | +95 |
| Failing | 1 (pre-existing) | 0 | -1 |
| Typecheck | ✅ | ✅ | — |
| Build | ✅ | ✅ | — |

## Feature Parity (CLI → Extension) — Complete

| # | Feature | Status | Implementation |
|---|---------|--------|---------------|
| 1 | Theming | ✅ | forced-colors media query, CLI discovery bugfix, 4 presets complete |
| 2 | Compaction | ✅ | autoCompact (ask/auto/off), snooze with 5% rearm, compact banner |
| 3 | Model Selection | ✅ | Server fetch + globalState cache, provider grouping, per-tab persistence |
| 4 | Session History | ✅ | Auto-title, rename validation, delete confirmation, Markdown export |
| 5 | Slash Commands | ✅ | Parser + autocomplete, 8 commands, multi-line safety, custom prompts |
| 6 | Permission Modes | ✅ | 3-mode selector (Plan/Auto/Normal), plan enforcement, auto mode warning |
| 7 | Rate Limits | ✅ | OpenAI/Anthropic/Generic adapters, countdown, status bar, configurable |
| 8 | Checkpoints | ✅ | Git worktree snapshots, 20-checkpoint cap, pre-action snapshot |

## New Features (Extension-Only) — Complete

| # | Feature | Status | Implementation |
|---|---------|--------|---------------|
| 9 | Inline CodeLens Actions | ✅ | `InlineActionProvider` — CodeLens (Explain, Refactor, Generate Tests) on functions/classes |
| 10 | Image / Multimodal | ✅ | Clipboard paste → base64, thumbnail renderer, lightbox overlay |
| 11 | Drag & Drop | ✅ | Drop zone with highlight, `@file:` mention insertion |
| 12 | Code Block Actions | ✅ | Copy, Insert at Cursor, Create New File buttons |
| 13 | Message Editing | ✅ | Edit button, input prefill, downstream message clearing |
| 14 | Search in Conversation | ✅ | Ctrl+F bar, highlighting, prev/next navigation, 200ms debounce |
| 15 | Notifications | ✅ | Turn-complete notification when webview unfocused |
| 16 | Prompt Files | ✅ | `.opencode/prompts/*.md`, variable substitution, file watcher |

## Deferred (P2 — High Effort / Niche)

| # | Feature | Reason |
|---|---------|--------|
| 17 | Voice Input | Niche (P2), requires Web Speech API or VS Code speech extension |
| 18 | Workspace Indexing | Very High effort — needs persistent embedding index, server-side support |

## Architecture

22 components across 4 layers:

- **Extension Host**: ChatProvider, TabManager, SessionStore, SessionManager, StreamCoordinator, MessageRouter, DiffHandler, ChunkBatcher, ContextEngine, ContextMonitor, ModelManager, RateLimitMonitor, CheckpointManager, ThemeManager, PromptManager, SessionExporter, InlineActionProvider, TerminalBridge, CliDiagnostics, DiffApplier, EventNormalizer
- **Webview**: State, Renderer, DOM, Tabs, Model Dropdown, Mentions, Stream, Scroll Anchor, Theme, Recent Sessions, Search, Slash Autocomplete
- **Communication**: @opencode-ai/sdk (REST + SSE over localhost)
- **Server**: opencode serve (HTTP, multi-session)
