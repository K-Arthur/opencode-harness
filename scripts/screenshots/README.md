# Screenshot Pipeline

Automated marketplace screenshot generation for the opencode-harness VS Code extension.

## Quick Start

```bash
# Generate screenshots (builds first, then captures all 8 shots)
npm run screenshots:generate

# Verify against committed baselines (CI gate)
npm run screenshots:verify

# Update baselines after intentional UI changes
npm run screenshots:update

# Validate fixture content accuracy
npm run screenshots:validate

# Regenerate README screenshot block from catalog
npm run screenshots:sync
```

## Architecture

```
scripts/screenshots/
  catalog.ts          # Declarative shot manifest (single source of truth)
  frame.ts            # Synthetic VS Code chrome injector (test-only, not shipped)
  workspace.ts        # Demo workspace data (file tree + sample source)
  capture.ts          # Per-shot orchestration
  verify.ts           # Content-accuracy assertions
  syncReadme.ts       # README embed block regeneration

tests/visual/screenshots/
  generate.spec.ts    # Playwright spec: writes PNGs to media/screenshots/dark/
  verify.spec.ts      # Playwright spec: compares against baselines
  fixture-utils.ts    # Shared fixture loader
  fixtures/sessions/  # 8 init_state JSON payloads
```

## How It Works

1. **Build** — `npm run build` produces `dist/chat/webview/` (the standalone webview bundle)
2. **Serve** — Playwright's `webServer` config serves it at `http://localhost:3000`
3. **For each shot:**
   - Inject a synthetic VS Code frame (activity bar, sidebar, editor, status bar) via `frame.ts`
   - Dispatch an `init_state` host message with a pre-baked conversation from `fixtures/`
   - Wait for rendering assertions (no spinners, no streaming indicators)
   - Capture a PNG at 1600×1000 viewport
4. **Verify** — `toHaveScreenshot` compares against committed baselines (maxDiffPixels: 50)

## Adding a New Screenshot

1. Create a fixture JSON in `tests/visual/screenshots/fixtures/sessions/`
2. Add an entry to `catalog.ts` with name, caption, fixture, wait/absent selectors
3. Run `npm run screenshots:generate` to produce the PNG
4. Run `npm run screenshots:sync` to update the README
5. Commit the new fixture, PNG, and updated README

## Fixture Schema

Each fixture is a complete `init_state` message payload:

```json
{
  "type": "init_state",
  "sessions": [{
    "id": "session-id",
    "name": "Session Name",
    "model": "anthropic/claude-sonnet-4-5",
    "mode": "build",
    "messages": [{
      "role": "user",
      "id": "u1",
      "sessionId": "session-id",
      "blocks": [{ "type": "text", "text": "..." }]
    }, {
      "role": "assistant",
      "id": "a1",
      "sessionId": "session-id",
      "blocks": [
        { "type": "text", "text": "..." },
        { "type": "tool", "id": "t1", "tool": "rg", "state": "completed", "args": {...}, "result": "..." }
      ]
    }],
    "tokenUsage": { "prompt": 0, "completion": 0, "total": 0 }
  }],
  "activeSessionId": "session-id",
  "globalModel": "anthropic/claude-sonnet-4-5",
  "workspaceName": "opencode-harness",
  "maxConcurrentStreams": 5,
  "branch": "master"
}
```

## CI Integration

- **`screenshots-verify`** job runs on every PR/push — fails if baselines drift
- **`screenshots:generate`** runs manually (not in CI) — produces new PNGs
- On failure, Playwright uploads `test-results/` as an artifact for diff review
