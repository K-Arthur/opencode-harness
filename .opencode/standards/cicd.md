<!-- ForgeCraft sentinel: cicd | 2026-05-04 | npx forgecraft-mcp refresh . --apply to update -->

## Dev Environment Hygiene

AI-assisted development can silently fill disk space. These rules are non-negotiable.
A full disk kills every running tool simultaneously — VS Code, Docker, the terminal, the DB.

### VS Code Extensions
- Before installing any extension: `code --list-extensions | grep -i <name>`.
- Only install if no version in the required major range is already present.
- Never run `code --install-extension` unconditionally in scripts or setup steps.
- Installing the same extension twice on the same day = a bug in your script.

### Docker Containers & Volumes
- Check before creating: `docker ps -a --filter name=<service>` — if it exists, start it, don't create it.
- Prefer `docker compose up` (reuse) over bare `docker run` (always creates new).
- One Compose file per project. Split files for the same project = tech debt.
- Log pruning: run `docker system prune -f` periodically. Never let container logs exceed 500 MB total.
- Time-series or synthetic data volumes: before writing >100 MB, ask whether raw retention,
  statistical condensation, or deletion after the run is preferred.
- Synthetic datasets older than 7 days with no code reference: ask to delete.

### Python Virtual Environments
- One `.venv` per project root, one per standalone package subdirectory — never more.
- Before creating: check if `.venv/` exists and `python --version` matches the required major.minor.
  Recreate only on major version mismatch or explicit user request.
- Never create a venv in a subdirectory unless that directory is a standalone installable package.
- Sanitize dependencies: if `pip list --not-required` reveals packages not in requirements, flag them.

### General Install Hygiene
- Before any install/download: check version already installed. Skip if within the required range.
- If project directory disk usage outside of `node_modules/`, `.venv/`, `dist/`, `.next/`
  exceeds 2 GB: surface a warning and ask before continuing any file-generating operation.
- Never silently grow the workspace. When uncertain about retention, ask.

## CI/CD & Deployment

### Pipeline
- Every push triggers: lint → type-check → unit tests → build → integration tests.
- Merges to main additionally run: security scan → deploy to staging → smoke tests → promote.
- Pipeline must complete in under 10 minutes. Parallelize test suites, cache dependencies.
- Failed pipelines block merge. No exceptions.

### Environments
- Minimum three environments: **development** (local), **staging** (mirrors prod), **production**.
- Environment config is injected — same artifact runs everywhere with different env vars.
- Staging is a faithful replica of production (same provider, same DB engine, same services).

### Deployment Strategy
- Default: **rolling deployment** with health checks (zero downtime).
- For critical services: **blue-green** or **canary** with automated rollback on error rate spike.
- Every deploy is tagged with git SHA. Rollback = redeploy a previous SHA.
- Deployment must be one command or one button. No multi-step manual runbooks.

### Preview Environments
- Pull requests get ephemeral preview deployments where feasible (Vercel, Netlify, Railway).
- Preview URLs in PR comments for stakeholder review before merge.

## Commit Protocol

A commit is a **verified state** of the system — not a save point, not a checkpoint.
A valid commit requires all three: test suite passes, delta is bounded and coherent,
no new anti-patterns introduced.

- Conventional commits: `feat|fix|refactor|docs|test|chore(scope): description`
- Commits must pass: compilation, lint, tests, coverage gate, mutation score gate (Stryker on changed modules), anti-pattern scan.
- Keep commits atomic — one logical change per commit.
- Commit BEFORE any risky refactor. Tag stable states.
- Update Status.md at the end of every session.

### Commit Hooks — Emit, Don't Reference
Commit hooks, commit-message linting, and the CI pipeline must be **emitted as fenced
code blocks** in the first session response — not merely referenced in prose or README
text. A hook that exists only as "you should add a pre-commit hook" in documentation
provides zero enforcement. If the file is not written to disk, the gate does not exist.

The following files must be emitted for any new project:

**`package.json`** — add to `scripts` and `devDependencies`:
```json
"scripts": { "prepare": "husky install" },
"devDependencies": {
  "husky": "^9.0.0",
  "@commitlint/cli": "^19.0.0",
  "@commitlint/config-conventional": "^19.0.0"
}
```

**`.husky/pre-commit`**:
```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"
npx tsc --noEmit && npm run lint && npm test -- --passWithNoTests
```

**`.husky/commit-msg`**:
```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"
npx commitlint --edit "$1"
```

**`commitlint.config.js`**:
```js
module.exports = { extends: ['@commitlint/config-conventional'] };
```

### Linter Config — Emit in P0, Don't Reference
Linter configuration is infrastructure, not application code. It must be committed to the
repo root in the **first response** (P0) alongside hooks and CI config — not added post-hoc.
A linter mentioned only in documentation does not enforce anything.

**TypeScript / JavaScript** — emit `.eslintrc.json` (or `eslint.config.js` for flat config):
```json
{
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint"],
  "rules": {
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": "error",
    "@typescript-eslint/no-explicit-any": "error"
  }
}
```

**Python** — emit `ruff.toml` (or `[tool.ruff]` section in `pyproject.toml`):
```toml
[tool.ruff]
select = ["E", "F", "I"]
ignore = []
line-length = 100
```

**Go** — emit `.golangci.yaml`:
```yaml
linters:
  enable:
    - unused
    - govet
    - errcheck
```

The correct linter config for **this project's language** must be committed to the repo root
in the same response that emits hooks and CI. Discovering lint errors at code review is too late.

### CI Pipeline — Emit, Don't Reference
`.github/workflows/ci.yml` must be emitted as a fenced code block in the first response.
A CI configuration described only in documentation does not enforce anything.
Adapt service blocks, branch names, and language-specific commands to the project stack.
The mutation gate step (`npx stryker run` for JS/TS, `mutmut run` for Python, `pitest` for
Java) is non-negotiable — it is the only gate that verifies test quality, not just
test execution. Line coverage at 80% can coexist with 58% mutation score; the mutation
gate catches the difference.

Minimum CI for a Node.js/TypeScript project:
```yaml
name: CI
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm run lint
      - run: npm test -- --coverage --passWithNoTests
      - name: Mutation gate
        run: npx stryker run
```

### Commit Message Precision
The commit message is the sentence describing this state in the project's typed corpus.
- ❌ `fix bug` — not a sentence; not queryable; useless as episodic memory.
- ✅ `fix(auth): reject expired tokens at middleware boundary before service layer invocation`
The AI uses commit history as context in future sessions. Typed, scoped conventional
messages are a queryable episodic record. `wip` and `changes` are not.

### What Constitutes One Logical Change
- A new feature and its tests: one commit.
- A refactor of an existing module that does not change behavior: one commit.
- A spec update (constitution change + the code change it governs): one commit.
- A bug fix with the reproducing test included: one commit.
Never combine a behavior change with a refactor in the same commit.
