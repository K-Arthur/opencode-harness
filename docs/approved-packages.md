# Approved Packages

## Criteria
- All runtime dependencies must be necessary and actively maintained
- Dev dependencies must support the build, test, or development workflow
- Transitive dependencies with known vulnerabilities must be overridden or patched

## Runtime Dependencies
| Package | Purpose | Version |
|---------|---------|---------|
| `@opencode-ai/sdk` | SDK client for OpenCode server | ^latest |

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
