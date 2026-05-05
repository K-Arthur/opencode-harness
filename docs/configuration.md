# Configuration Reference

Complete reference for all OpenCode Harness configuration options and environment variables.

## VS Code Settings

All settings are under the `opencode.*` namespace and can be configured in VS Code's `settings.json`.

### `opencode.binaryPath`
- **Type**: `string`
- **Default**: `""`
- **Scope**: `machine`
- **Description**: Path to the opencode binary. If not set, the extension will search for `opencode` in your system PATH.
- **Validation**: Must be an absolute path with no shell metacharacters (`;&|`$(){}!#~<>`)
- **Example**:
  ```json
  {
    "opencode.binaryPath": "/usr/local/bin/opencode"
  }
  ```

### `opencode.theme`
- **Type**: `object`
- **Default**: `{ "preset": "cli-default", "overrides": {} }`
- **Scope**: `window`
- **Description**: Theme configuration for the OpenCode chat panel.
- **Properties**:
  - `preset` (string): Base theme preset — one of `"cli-default"`, `"light"`, `"dark"`, `"high-contrast"`
  - `overrides` (object): Individual CSS color overrides (see Theme Customization in README)
- **Example**:
  ```json
  {
    "opencode.theme": {
      "preset": "dark",
      "overrides": {
        "userMessageBg": "#1a1a2e",
        "syntaxKeyword": "#ff79c6"
      }
    }
  }
  ```

### `opencode.model`
- **Type**: `string`
- **Default**: `""`
- **Scope**: `window`
- **Description**: Default model ID in `provider/model` format (e.g., `anthropic/claude-sonnet-4-20250514`). Set via 'OpenCode: Select Model' command.
- **Example**:
  ```json
  {
    "opencode.model": "anthropic/claude-sonnet-4-20250514"
  }
  ```

### `opencode.autoCompact`
- **Type**: `string`
- **Default**: `"ask"`
- **Scope**: `window`
- **Options**:
  | Value | Description |
  |-------|-------------|
  | `"ask"` | Show a prompt before auto-compacting (default) |
  | `"auto"` | Compact automatically without asking |
  | `"off"` | Never auto-compact |
- **Description**: Controls automatic session compaction when context usage reaches 80%.

### `opencode.rateLimits`
- **Type**: `object`
- **Default**: `{}`
- **Scope**: `window`
- **Description**: Fallback rate limit configuration per provider. Used for providers that don't return rate limit headers (e.g., OpenAI, Anthropic).
- **Properties per provider**:
  | Property | Type | Default | Description |
  |-----------|------|---------|-------------|
  | `tokensPerMin` | number | `100000` | Maximum tokens per minute |
  | `requestsPerMin` | number | `50` | Maximum requests per minute |
- **Example**:
  ```json
  {
    "opencode.rateLimits": {
      "openai": { "tokensPerMin": 150000, "requestsPerMin": 60 },
      "anthropic": { "tokensPerMin": 200000, "requestsPerMin": 100 }
    }
  }
  ```

### `opencode.rateLimitWarningThreshold`
- **Type**: `number`
- **Default**: `0.1`
- **Scope**: `window`
- **Description**: Fraction of remaining rate limit that triggers a warning notification (0.0–1.0). Default 0.1 = warning at 10% remaining.

### `opencode.rateLimitCriticalThreshold`
- **Type**: `number`
- **Default**: `0.05`
- **Scope**: `window`
- **Description**: Fraction of remaining rate limit that triggers a critical warning (0.0–1.0). Default 0.05 = critical alert at 5% remaining.

---

## Environment Variables

These environment variables are used by the extension at runtime. They are NOT VS Code settings — they are system environment variables.

### `CI`
- **Used in**: `playwright.config.ts`
- **Purpose**: Controls Playwright test configuration
- **Effect when set** (`CI=true`):
  - `forbidOnly: true` — prevents `test.only()` from running
  - `retries: 2` — retries failed tests twice
  - `workers: 1` — runs tests sequentially
  - `reuseExistingServer: false` — starts fresh server for each test
- **Default behavior** (not set): Playwright runs with parallel workers, no retries, reuses existing server

### `HOME` / `USERPROFILE`
- **Used in**: `src/skills/SkillManager.ts`, `src/theme/ThemeManager.ts`
- **Purpose**: Determines the user's home directory for discovering skills and themes
- **Fallback order**:
  1. `HOME` environment variable
  2. `USERPROFILE` environment variable (Windows)
  3. Empty string (will likely cause errors)
- **Paths resolved**:
  - Skills: `$HOME/.agents/skills/`
  - CLI themes: Linux/macOS: `$HOME/.config/opencode/themes/`, Windows: `$APPDATA/opencode/themes/`

### `XDG_CONFIG_HOME`
- **Used in**: `src/theme/ThemeManager.ts`
- **Purpose**: XDG Base Directory specification config path (Linux)
- **Fallback**: If not set, uses `$HOME/.config/`
- **Resolved path**: `$XDG_CONFIG_HOME/opencode/themes/`

### `APPDATA`
- **Used in**: `src/theme/ThemeManager.ts`, `src/skills/SkillManager.ts`
- **Purpose**: Windows-specific config directory
- **Fallback**: If not set, uses `$HOME/opencode/`
- **Resolved path**: `$APPDATA/opencode/themes/` (Windows only)

---

## Server Configuration

The OpenCode server is spawned automatically by `SessionManager` with these defaults:

| Parameter | Default | Description |
|-----------|---------|-------------|
| Port | Auto-detected via `findFreePort()` | Random free port, persisted to `globalState` |
| Hostname | `127.0.0.1` | Binds to loopback only (not exposed externally) |
| Health endpoint | `http://127.0.0.1:{port}/global/health` | Returns `{ healthy: boolean, version?: string }` |

### Server Environment
The server inherits the extension's environment with these filtered variables:
- Passed through: `PATH`, `HOME`, `LANG`, and other safe variables
- Filtered out: API keys and sensitive credentials (security measure)

---

## Verification

To verify your configuration:
1. Open VS Code Command Palette (`Ctrl+Shift+P`)
2. Run `OpenCode: Check CLI Communication` — verifies server connectivity
3. Run `OpenCode: Show Rate Limits` — displays current rate limit status
4. Check the Output panel → `OpenCode` channel for detailed logs
