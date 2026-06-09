# ADR: P3 Technical Debt from 2026-05-04 Codebase Audit

## Context

During the systematic codebase audit of OpenCode Harness, several architectural and configuration issues were identified that do not affect runtime correctness but degrade maintainability, testability, and type safety. These are classified as P3 (deferred) per the audit protocol.

## Decisions

### 1. ESLint Configuration Migration

**Status:** Deferred  
**Owner:** TBD  
**Proposal:**
- Migrate from `.eslintrc.json` (legacy) to `eslint.config.js` (flat config, ESLint 9 compatible)
- Add rules:
  - `@typescript-eslint/no-floating-promises: error`
  - `no-console: warn` (enforce `OutputChannelService` usage)
- Remove `skipLibCheck: true` from `tsconfig.json` after validating all dependency types

**Rationale:** Current config is functional but hides unhandled promise bugs and allows `console.log` leakage. Migration is non-breaking but touches many files.

### 2. ChatProvider Single Responsibility Extraction

**Status:** Deferred  
**Owner:** TBD  
**Proposal:** Extract the following responsibilities from `ChatProvider` (currently 26 methods):

| Responsibility | New Class | Interface |
|----------------|-----------|-----------|
| Message persistence | `MessageStore` | `append(sessionId, msg)`, `getHistory(sessionId)` |
| Command registration | `CommandRegistry` | `register(scope, handler)`, `dispatch(msg)` |
| Config reading | `ConfigReader` | `get<T>(key)`, `onChange(key, cb)` |
| Webview HTML generation | Already `WebviewContent` — verify full extraction | — |

**Rationale:** `ChatProvider` violates SRP. Extraction improves unit testability (each class mockable independently) but requires updating all call sites and tests.

### 3. Dependency Injection for Core Classes

**Status:** Deferred  
**Owner:** TBD  
**Proposal:** Convert inline `new` instantiations in `ChatProvider` constructor to factory parameters:

```typescript
// Current
this.tabManager = new TabManager()
this.streamCoordinator = new StreamCoordinator(...)

// Proposed
constructor(
  ...,
  tabManagerFactory: () => TabManager,
  streamCoordinatorFactory: (...) => StreamCoordinator,
)
```

**Rationale:** Enables true unit testing of `ChatProvider` without module-level mocking. Breaking change to constructor signature.

### 4. Structural Tests → Behavioral Tests

**Status:** Deferred  
**Owner:** TBD  
**Proposal:** Convert text-grep tests (e.g., `main.test.ts`, `tabs.test.ts`) to real DOM or mocked VS Code API tests. Target files:
- `src/chat/webview/main.test.ts`
- `src/chat/webview/tabs.test.ts`
- `src/chat/webview/state.test.ts`

**Rationale:** Text-grep tests verify syntax but not behavior. They give false confidence and break on benign refactoring.

## Consequences

- **Positive:** Clear roadmap for maintainability improvements
- **Negative:** Deferred work accumulates; `ChatProvider` will continue to grow until extracted
- **Risk:** Low — these are non-breaking architectural improvements

## Action Items

| # | Item | Priority | Est. Effort |
|---|------|----------|-------------|
| 1 | ESLint migration | High | 2h |
| 2 | ChatProvider SRP extraction | Medium | 4h |
| 3 | DI factory params | Medium | 2h |
| 4 | Behavioral test conversion | Low | 6h |
