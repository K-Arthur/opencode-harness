<!-- ForgeCraft sentinel: constitution | 2026-05-04 | npx forgecraft-mcp refresh . --apply to update -->

# OpenCode Harness — Project Constitution

## ⚠️ Working Tree Is Ephemeral — Commit To Preserve Work
An external checkpoint process (opencode `oc-ckp-*` checkpoints + other agent
harnesses) periodically runs `git stash` / `git reset → HEAD` in this workspace,
**discarding all uncommitted changes** (they land in `git stash list`, not the
tree — see the recurring `reset: moving to HEAD` in `git reflog`). Only commits
survive. Therefore, every agent/model and human MUST:
1. **Commit completed, verified work before yielding the turn** — never leave
   finished work uncommitted; prefer small, frequent commits.
2. **Never** run `git reset --hard`, `git checkout -- <live edits>`, or
   `git stash` against the working tree.
3. If edits vanished, recover from `git stash list` (`git checkout "stash@{0}" -- <files>`).
4. Rebuild/reinstall the extension only via `npm run reinstall` (see
   `docs/development/rebuild-and-reinstall.md`) — never hand-install a same-version
   `.vsix` (it ships a stale build).

## Identity
- **Project**: OpenCode Harness — VS Code extension integrating opencode AI agent
- **Type**: VS Code extension (library/package for VS Code marketplace)
- **Runtime**: TypeScript / Node.js with VS Code Extension API ^1.98.0
- **Server**: Client to opencode HTTP server (localhost:4096) via @opencode-ai/sdk
- **Version**: 0.4.7
- **Status**: Production audit complete — typecheck clean, full unit suite green (tsx 4237 + mjs 1004 passing, 0 failing), noUncheckedIndexedAccess enforced

## Hardening Milestone (2026-05-04)
- Full production-readiness audit completed: **151 issues identified across 5 phases**
- **Critical fixes applied**: compilation errors, security holes, data corruption risks, global lock removal
- **Type safety**: `noUncheckedIndexedAccess` enabled — fixed 40 potential undefined crashes
- **Security**: `process.env` filtered to allowlist, `.env` in `.gitignore`, CSS injection blocked, CSP nonces cryptographically secure
- **Concurrency**: per-tab lock replaces global `promptInFlight`, stream slot reserved synchronously
- **All @vscode-elements replaced**: `vscode-tabs`, `vscode-button`, `vscode-tab-header`, `vscode-tab-panel`, `vscode-progress-ring` replaced with plain HTML elements — no Shadow DOM conflicts
- **Custom tab bar**: plain HTML buttons with left-to-right ordering, active tab accent border, streaming tab pulsing dot
- **Empty session filtering**: sessions with zero messages are not persisted to globalState
- **61 behavioral tests**: real function-calling tests for SessionStore, EventNormalizer, DiffApplier, mode normalization, map limiting

## Non-Negotiable Rules

### Architecture
1. **Client-Server only**: Extension is a client to opencode server. Never embed/spawn CLI directly for chat.
2. **Event-driven**: SSE streaming for real-time agent visibility. No polling.
3. **Transactional writes**: Code changes = Diff → Review → Apply via VS Code undoable edit API.
4. **Multi-tab**: Max 3 concurrent streams enforced by TabManager.
5. **Non-blocking**: Intensive work (context gathering, diff generation) runs in worker threads.
6. **Graceful degradation**: Every component handles opencode server unavailable.

### Code Quality
7. **TDD mandatory**: Write failing test first (RED), implement (GREEN), refactor (REFACTOR). Never skip phases.
8. **No mocks in source**: Mocks only in test files. Use dependency injection.
9. **Interfaces first**: Define interface → write tests → implement. Never skip.
10. **SOLID**: Single responsibility, open/closed, Liskov substitution, interface segregation, dependency inversion.
11. **Pure functions**: Domain logic, validation, transformations = pure. Side effects at edges.
12. **Immutability by default**: `const` over `let`, `readonly` on properties.

### Testing
13. **Coverage**: ≥80% overall, ≥90% new/changed code, ≥65% mutation score (MSI).
14. **TDD gates**: `test:` commit before `feat:` commit. Red phase evidence required.
15. **Test naming**: `rejects_expired_tokens` not `test_auth`. One behavior per test.
16. **Property-based**: Add fast-check tests for pure functions with wide input ranges.

### Security
17. **Zero secrets in code**: API keys, tokens → environment variables only.
18. **CSP compliant**: Webview HTML no inline event handlers.
19. **Input sanitization**: User input sanitized before sending to opencode server.
20. **Webview validation**: Validate all message origins from webview.

### VS Code Specific
21. **Cleanup required**: All disposables pushed to `context.subscriptions`.
22. **Activation <500ms**: Extension activation must be fast.
23. **User-actionable errors**: No raw error strings shown to users.
24. **Internationalization ready**: No hardcoded user-facing strings (i18n ready).

## Forbidden Patterns
- ❌ Direct file writes without diff review
- ❌ Mock objects in source code (only in tests)
- ❌ Circular imports (enforced by hook)
- ❌ `any` type without explicit justification
- ❌ Hardcoded ports, URLs, credentials
- ❌ Skipping TDD red phase (must show failing test)
- ❌ `tsc --strict: false` or `noUncheckedIndexedAccess: false`
- ❌ @ts-ignore or @ts-nocheck without ADR approval

## Deliverables Per Feature
1. ADR if architectural decision made
2. Tests (RED → GREEN → REFACTOR)
3. Update docs/TechSpec.md
4. Update relevant diagram (docs/diagrams/)
5. Update Status.md

## References
- Architecture: docs/specs/2026-05-02-opencode-harness-architecture.md
- Tech Spec: docs/TechSpec.md
- PRD: docs/PRD.md
- ADRs: docs/adrs/
- Standards: .opencode/standards/


## Code Exploration Policy

Always use jCodemunch-MCP tools for code navigation. Never fall back to Read, Grep, Glob, or Bash for code exploration.
**Exception:** Use `Read` when you need to edit a file — the agent harness requires a `Read` before `Edit`/`Write` will succeed. Use jCodemunch tools to *find and understand* code, then `Read` only the specific file you're about to modify.

**Start any session:**
1. `resolve_repo { "path": "." }` — confirm the project is indexed. If not: `index_folder { "path": "." }`
2. `suggest_queries` — when the repo is unfamiliar

**Finding code:**
- symbol by name → `search_symbols` (add `kind=`, `language=`, `file_pattern=`, `decorator=` to narrow)
- decorator-aware queries → `search_symbols(decorator="X")` to find symbols with a specific decorator (e.g. `@property`, `@route`); combine with set-difference to find symbols *lacking* a decorator (e.g. "which endpoints lack CSRF protection?")
- string, comment, config value → `search_text` (supports regex, `context_lines`)
- database columns (dbt/SQLMesh) → `search_columns`

**Reading code:**
- before opening any file → `get_file_outline` first
- one or more symbols → `get_symbol_source` (single ID → flat object; array → batch)
- symbol + its imports → `get_context_bundle`
- specific line range only → `get_file_content` (last resort)

**Repo structure:**
- `get_repo_outline` → dirs, languages, symbol counts
- `get_file_tree` → file layout, filter with `path_prefix`

**Relationships & impact:**
- what imports this file → `find_importers`
- where is this name used → `find_references`
- is this identifier used anywhere → `check_references`
- file dependency graph → `get_dependency_graph`
- what breaks if I change X → `get_blast_radius`
- what symbols actually changed since last commit → `get_changed_symbols`
- find unreachable/dead code → `find_dead_code`
- class hierarchy → `get_class_hierarchy`

## Session-Aware Routing

**Opening move for any task:**
1. `plan_turn { "repo": "...", "query": "your task description", "model": "<your-model-id>" }` — get confidence + recommended files; the `model` parameter narrows the exposed tool list to match your capabilities at zero extra requests.
2. Obey the confidence level:
   - `high` → go directly to recommended symbols, max 2 supplementary reads
   - `medium` → explore recommended files, max 5 supplementary reads
   - `low` → the feature likely doesn't exist. Report the gap to the user. Do NOT search further hoping to find it.

**Interpreting search results:**
- If `search_symbols` returns `negative_evidence` with `verdict: "no_implementation_found"`:
  - Do NOT re-search with different terms hoping to find it
  - Do NOT assume a related file (e.g. auth middleware) implements the missing feature (e.g. CSRF)
  - DO report: "No existing implementation found for X. This would need to be created."
  - DO check `related_existing` files — they show what's nearby, not what exists
- If `verdict: "low_confidence_matches"`: examine the matches critically before assuming they implement the feature

**After editing files:**
- If PostToolUse hooks are installed (Claude Code only), edited files are auto-reindexed
- Otherwise, call `register_edit` with edited file paths to invalidate caches and keep the index fresh
- For bulk edits (5+ files), always use `register_edit` with all paths to batch-invalidate

**Token efficiency:**
- If `_meta` contains `budget_warning`: stop exploring and work with what you have
- If `auto_compacted: true` appears: results were automatically compressed due to turn budget
- Use `get_session_context` to check what you've already read — avoid re-reading the same files

## Model-Driven Tool Tiering

Your jcodemunch-mcp server narrows the exposed tool list based on the model you are running as. To avoid wasting requests on primitives when a composite would do, always include `model="<your-model-id>"` in your opening `plan_turn` call.

Replace `<your-model-id>` with your active model:
- Claude Opus variants → `claude-opus-4-7` (or any `claude-opus-*`)
- Claude Sonnet variants → `claude-sonnet-4-6`
- Claude Haiku variants → `claude-haiku-4-5`
- GPT-4o / GPT-5 / o1 / Llama → use the model id as printed by your runner

The `model=` parameter rides on the existing `plan_turn` call — it does **not** add a separate tool invocation. If `plan_turn` is not appropriate for a non-code task, call `announce_model(model="...")` once instead.

## Agent skills

### Issue tracker

GitHub Issues in `K-Arthur/opencode-harness`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo. See `docs/agents/domain.md`.
