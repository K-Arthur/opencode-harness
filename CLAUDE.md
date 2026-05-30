<!-- ForgeCraft sentinel: constitution | 2026-05-04 | npx forgecraft-mcp refresh . --apply to update -->

# OpenCode Harness — Project Constitution

## Identity
- **Project**: OpenCode Harness — VS Code extension integrating opencode AI agent
- **Type**: VS Code extension (library/package for VS Code marketplace)
- **Runtime**: TypeScript / Node.js with VS Code Extension API ^1.98.0
- **Server**: Client to opencode HTTP server (localhost:4096) via @opencode-ai/sdk
- **Version**: 0.2.19
- **Status**: Production audit complete — typecheck clean, 2197 unit tests passing (+9 message-contract, +7 roundtrip), 0 failing, noUncheckedIndexedAccess enforced

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
