# Contributing to OpenCode Harness

Thank you for your interest in contributing to OpenCode Harness! This guide will help you get set up and follow our development workflow.

## Development Setup

### Prerequisites
- **VS Code**: 1.98.0 or higher
- **Node.js**: 20.x or later
- **opencode CLI**: Install from [opencode.ai](https://opencode.ai)
- **Linux only**: `libsecret` required for VS Code credential store (`sudo pacman -S libsecret` on Arch, `sudo dnf install libsecret-devel` on Fedora)

### Initial Setup
```bash
# Clone the repository
git clone https://github.com/K-Arthur/opencode-harness
cd opencode-harness

# Install dependencies
npm install
```

## Build & Development

```bash
# Production build (esbuild)
npm run build

# TypeScript type checking
npm run typecheck

# Watch mode (auto-rebuild on file changes)
npm run watch
```

## Testing

The project has four test layers:

### 1. Behavioral Unit Tests (61 tests)
Real function-calling tests for SessionStore, EventNormalizer, DiffApplier, mode normalization, and map size limiting.
```bash
node --test tests/unit/*.test.mjs
```

### 2. Structural Unit Tests (356 tests)
Text-grep source code pattern checks (being migrated to behavioral).
```bash
npx tsx --test "src/**/*.test.ts"
```

### 3. Integration Tests
Requires VS Code Extension Dev Host with Xvfb on Linux.
```bash
npm run test:integration
```

### 4. Visual Regression Tests (Playwright)
Screenshot-based UI testing.
```bash
npm run test:visual

# Update snapshots
npm run test:visual:update
```

### Full Verification Pipeline
```bash
npm run typecheck && npm run build && npm run test:unit
```

### Coverage
```bash
npm run coverage
```

## Code Standards

See [CONVENTIONS.md](CONVENTIONS.md) for full details. Key rules:
- Maximum function/method length: 50 lines
- Maximum function parameters: 5 (use parameter objects beyond that)
- No circular imports (enforced by pre-commit hook)
- `tsconfig.json` must have `"strict": true` AND `"noUncheckedIndexedAccess": true`
- Every public function/method must have JSDoc with typed params and returns
- No abbreviations except universally understood ones (id, url, http, db, api)

## Pre-Commit Hooks

The project uses Husky with the following pre-commit hooks in `.opencode/hooks/`:
- `pre-commit-branch-check.sh` — Branch naming validation
- `pre-commit-compile.sh` — Compilation check
- `pre-commit-coverage.sh` — Coverage threshold check
- `pre-commit-format.sh` — Formatting check
- `pre-commit-function-length.sh` — Function length limit
- `pre-commit-import-cycles.sh` — Circular dependency check
- `pre-commit-prod-quality.sh` — Production code quality
- `pre-commit-review.sh` — Review status check
- `pre-commit-test.sh` — Unit tests must pass
- `pre-commit-tdd-check.sh` — Test-driven development check
- `pre-commit-clippy.sh` — Rust-style linting (for relevant code)

## CI/CD Pipeline

GitHub Actions (`.github/workflows/ci.yml`) with 3 jobs:
1. **typecheck-and-unit**: Runs on Node 20.x & 22.x, runs typecheck, build, unit tests, architecture checks, ESLint
2. **integration**: Runs VS Code integration tests with Xvfb
3. **visual**: Runs Playwright visual regression tests

Triggers: push to `main`/`master`, pull requests to `main`/`master`

## Pull Request Process

1. Create a feature branch from `main`/`master`
2. Make your changes following the code standards
3. Ensure all tests pass (`npm run test:unit`)
4. Update documentation if needed
5. Submit PR with clear description of changes

## Packaging

Build a `.vsix` installable file:
```bash
# Install the VS Code packaging tool
npm install -g @vscode/vsce

# Package the extension
npx @vscode/vsce package --no-dependencies --allow-missing-repository

# Install the packaged extension
code --install-extension opencode-harness-*.vsix --force
```

The `.vsix` file contains:
- `dist/extension.js` — bundled extension
- `dist/chat/webview/main.js` — bundled webview JS
- `dist/chat/webview/styles.css` — bundled webview CSS
- `package.json` — manifest and configuration
- `README.md` — documentation

## Architecture Overview

See [TechSpec.md](docs/TechSpec.md) and [architecture spec](docs/specs/2026-05-02-opencode-harness-architecture.md) for full details.

Key modules:
- `src/chat/` — ChatProvider, TabManager, WebviewContent, handlers
- `src/session/` — SessionManager (server lifecycle), SessionStore
- `src/model/` — ModelManager
- `src/theme/` — ThemeManager
- `src/skills/` — SkillManager
- `src/utils/` — outputChannel, portFinder, tokenCounter

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
