# Approved Packages

## Criteria
- All runtime dependencies must be necessary and actively maintained
- Dev dependencies must support the build, test, or development workflow
- Transitive dependencies with known vulnerabilities must be overridden or patched

## Runtime Dependencies
| Package | Purpose | Version |
|---------|---------|---------|
| `@opencode-ai/sdk` | SDK client for OpenCode server | ^1.17.9 |
| `diff-match-patch` | Text diffing for DiffApplier | ^1.0.5 |
| `dompurify` | HTML sanitizer for webview | ^3.4.11 |
| `highlight.js` | Syntax highlighting for code blocks | ^11.11.1 |
| `jsonc-parser` | JSONC parser (comments + trailing commas) for opencode.jsonc config | ^3.3.1 |
| `katex` | LaTeX math rendering | ^0.17.0 |
| `markdown-it` | Markdown parser | ^14.2.0 |
| `markdown-it-task-lists` | Task list plugin for markdown-it | ^2.1.1 |
| `mermaid` | Diagram rendering | ^11.15.0 |
| `minimatch` | Glob pattern matching for workspace file index exclusions | ^10.0.1 |

Checkpoint snapshots use VS Code `workspace.fs` and `WorkspaceEdit`; no runtime git helper is approved for checkpoint rollback.

## Dev Dependencies
| Package | Purpose |
|---------|---------|
| `@types/vscode` | VS Code API type definitions |
| `@vscode/vsce` | Extension packaging |
| `@vscode/test-electron` | Integration test runner |
| `esbuild` | Build bundler |
| `typescript` | TypeScript compiler |
| `tsx` | TypeScript execution for tests |
| `mocha` | Test framework |
| `@types/mocha` | Mocha type definitions |
| `eslint` | Linting |
| `@typescript-eslint/parser` | TypeScript ESLint parser |
| `@typescript-eslint/eslint-plugin` | TypeScript ESLint rules |
| `eslint-config-prettier` | Prettier ESLint integration |
| `playwright` | End-to-end browser tests |
| `@playwright/test` | Playwright test framework |
| `jsdom` | DOM implementation for webview tests |
| `@types/jsdom` | TypeScript definitions for jsdom |

## Audit Log

| Date | Packages bumped | Audit status |
|------|----------------|--------------|
| 2026-06-22 | `@opencode-ai/sdk` 1.17.7→1.17.9, `dompurify` 3.4.10→3.4.11, `@playwright/test` 1.60→1.61, `@typescript-eslint/*` 8.61.0→8.61.1, `mocha` 11.7.6 (floor) | 0 HIGH/CRITICAL from direct deps; 2 pre-existing transitive HIGH (`form-data`, `undici` via stryker) unchanged |
| 2026-06-23 | `jsonc-parser` ^3.3.1 added (JSONC config parsing), `minimatch` ^10.0.1 added (glob exclusion patterns) | 0 HIGH/CRITICAL |
