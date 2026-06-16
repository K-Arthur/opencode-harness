# Configuration Reference

Complete reference for all OpenCode Harness configuration options and environment variables.

## VS Code Settings

All settings are under the `opencode.*` namespace and can be configured in VS Code's `settings.json`.

### `opencode.binaryPath`
- **Type**: `string`
- **Default**: `""`
- **Scope**: `machine`
- **Description**: Path to the opencode binary. If not set, the extension searches for `opencode` in your system PATH **and** in the default install locations (e.g. `~/.opencode/bin/opencode`, common npm-global and Homebrew dirs). The known-location fallback matters because the official installer appends `~/.opencode/bin` to your shell rc files, which a GUI-launched VS Code does not see until restart.
- **Validation**: Must be an absolute path with no shell metacharacters (`;&|`$(){}!#~<>`)
- **Example**:
  ```json
  {
    "opencode.binaryPath": "/usr/local/bin/opencode"
  }
  ```

### `opencode.autoInstall`
- **Type**: `string` (enum)
- **Values**: `"prompt"` | `"auto"` | `"off"`
- **Default**: `"prompt"`
- **Scope**: `machine`
- **Description**: Controls how the extension installs the required opencode CLI when it is not found on activation. VS Code has no install-time hook, so this runs the first time the extension activates without a binary present.
  - **`prompt`** (default): Ask before installing. The prompt offers **Install / Manual Instructions / Not Now** and is shown **once** — if you decline, the choice is remembered (in `globalState`) so you aren't asked again on every reload. Re-trigger any time with the `OpenCode: Install CLI` command.
  - **`auto`**: Install automatically and silently (behind a progress notification) whenever the binary is missing.
  - **`off`**: Never install automatically. Use the `OpenCode: Install CLI` command to install on demand.
- **Install mechanism**: macOS/Linux use the official install script (`https://opencode.ai/install`), which installs to `~/.opencode/bin` without sudo. For safety the script is downloaded, content-validated, written to a `0o700` temp file, and run as `bash <file>` with `shell: false` (no `curl | bash` pipe). Windows uses `npm install -g opencode-ai` when npm is available, otherwise shows manual instructions (npm / scoop / choco).
- **Note**: Remote-attach mode (`opencode.serverUrl` set) does not require a local binary, so the install check is skipped there.
- **Example**:
  ```json
  {
    "opencode.autoInstall": "prompt"
  }
  ```

### `opencode.theme`
- **Type**: `object`
- **Default**: `{ "preset": "cli-default", "overrides": {} }`
- **Scope**: `window`
- **Description**: Theme configuration for the OpenCode chat panel.
- **Properties**:
  - `preset` (string): Base theme preset — one of `"cli-default"`, `"light"`, `"dark"`, `"high-contrast"`
  - `overrides` (object): Individual CSS color overrides. The schema includes OpenCode CLI-style fields for primary/secondary/accent colors, panel/editor backgrounds, borders, semantic colors, syntax colors, diff colors, and Markdown colors.
- **UI**: The chat header settings menu includes **Customize theme**, a webview modal for common overrides. The QuickPick preview remains available for presets and discovered CLI themes.
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

### `opencode.voice.*`
- **Description**: Controls the microphone button in the chat composer. Recording
  and transcription happen **locally in the extension host** — no cloud service and
  no API key. A VS Code webview cannot access the microphone (sandboxed iframe), so
  the host records the default mic with a local CLI tool and transcribes it with a
  local speech-to-text engine. The transcript is inserted into the prompt for review.
- **Behavior settings** (scope `window`):
  | Setting | Type | Default | Description |
  |---------|------|---------|-------------|
  | `opencode.voice.enabled` | boolean | `true` | Show and enable the voice-input control. |
  | `opencode.voice.autoSend` | boolean | `false` | Send the prompt automatically once a transcript is inserted. |
  | `opencode.voice.language` | string | `"auto"` | Spoken language passed to the engine (e.g. `en-US`); `auto` lets it detect. |
  | `opencode.voice.insertMode` | `"append"` \| `"replace"` | `"append"` | Append the transcript to the prompt or replace its contents. |
  | `opencode.voice.maxRecordingSeconds` | number | `60` | Maximum recording length, clamped to 1–300 seconds. |
- **Engine settings** (scope `machine` — cannot be set by a workspace, for security):
  | Setting | Type | Default | Description |
  |---------|------|---------|-------------|
  | `opencode.voice.model` | string | `""` | Whisper model: a size for openai-whisper (e.g. `base`), or a `.bin` path for whisper.cpp. |
  | `opencode.voice.localCommand` | string | `""` | Override transcription command. Placeholders `{input}`, `{output}`, `{language}`. |
  | `opencode.voice.recordCommand` | string | `""` | Override recorder command. Placeholders `{output}`, `{duration}`. |
- **Auto-detection**: with no overrides, the recorder is `rec` (sox) → `arecord` →
  `ffmpeg`, and the engine is openai-whisper (`whisper`) or whisper.cpp when a model
  is set. If neither is found, the button shows a graceful "not available" state.
- **Security**: `model`, `localCommand`, and `recordCommand` are machine-scoped so an
  untrusted workspace cannot inject a command for the host to run.
- **Privacy**: Audio is written to a temp WAV, transcribed locally, and deleted. No
  audio or transcript is uploaded, persisted, or logged.
  Transcripts are not logged and are never sent as prompts until the user presses
  Send.

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

## OpenCode MCP Configuration

MCP servers are now read from OpenCode config files first, not only from VS Code settings.
The extension checks these locations, later entries overlaying earlier ones by server name:

1. `OPENCODE_CONFIG`, when set.
2. `$XDG_CONFIG_HOME/opencode/opencode.json`, or `~/.config/opencode/opencode.json`.
3. Workspace `opencode.json`.
4. Workspace `.opencode/opencode.json`.

The MCP modal reads and writes the primary OpenCode config file. If the file does not exist,
opening MCP settings creates:

```json
{
  "mcp": {}
}
```

Legacy `opencode.mcpServers` VS Code settings are still loaded as a fallback for older
installations, but OpenCode config entries take precedence.

MCP entries are validated before they are loaded or saved. Server names may only use
letters, numbers, dot, underscore, and dash. Stdio commands reject shell metacharacters
and path traversal. Args/env/header values reject control characters. Remote MCP URLs
must use HTTPS unless they target localhost/loopback. Tool names reported by MCP
servers are also sanitized before they are shown or routed.

### `opencode.mcpServers`
- **Type**: `object`
- **Default**: `{}`
- **Scope**: `window`
- **Description**: Legacy fallback MCP server map. Each entry may describe a stdio, HTTP, or SSE server.
- **Per-server properties**:
  | Property | Type | Description |
  |----------|------|-------------|
  | `type` | `"stdio" \| "http" \| "sse"` | Transport type |
  | `command` | `string` | Stdio command |
  | `args` | `string[]` | Stdio command arguments |
  | `env` | `object` | Stdio environment variables |
  | `url` | `string` | HTTP/SSE endpoint |
  | `headers` | `object` | Remote request headers |
  | `disabled` | `boolean` | Disable this server |
  | `enabled` | `boolean` | Enable this server; `false` is treated like `disabled: true` |

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

### `opencode.sessions.emptySessionTtlMinutes`
- **Type**: `number`
- **Default**: `60`
- **Scope**: `window`
- **Description**: Completely empty inactive sessions are removed after this many minutes. Sessions waiting for server backfill or server-link promotion are exempt.

### `opencode.sessions.cleanupIntervalMinutes`
- **Type**: `number`
- **Default**: `15`
- **Scope**: `window`
- **Description**: How often the extension prunes completely empty sessions.

### `opencode.sessions.restoreOpenTabs`
- **Type**: `boolean`
- **Default**: `true`
- **Scope**: `window`
- **Description**: Restores previously open, non-empty tabs for the current workspace when the webview is recreated.

### `opencode.sessions.maxConcurrentStreams`
- **Type**: `number`
- **Default**: `5`
- **Range**: `1`-`10`
- **Scope**: `window`
- **Description**: Maximum number of concurrent AI streams across all tabs. Exceeding it shows a warning naming the currently streaming tabs instead of starting a new one.

### `opencode.rateLimits`
- **Type**: `object`
- **Default**: `{}`
- **Scope**: `window`
- **Description**: Fallback per-minute quota configuration by provider id. Used when the provider/server does not expose remaining/limit headers. OpenCode Zen uses provider id `opencode`; because Zen is pay-as-you-go with optional monthly limits, the extension only shows exact remaining quota when headers are available, otherwise it shows observed token/cost usage or this configured fallback estimate.
- **Persistence**: Observed input/output tokens and cost are persisted in VS Code `globalState` by provider, so window reloads do not reset the visible usage picture.
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
      "anthropic": { "tokensPerMin": 200000, "requestsPerMin": 100 },
      "opencode": { "tokensPerMin": 100000, "requestsPerMin": 50 }
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

### `opencode.debugLogging`
- **Type**: `boolean`
- **Default**: `false`
- **Scope**: `window`
- **Description**: Enable verbose debug logging to the OpenCode Harness output channel. When enabled, `debug()` level messages are emitted alongside info/warn/error output. All log messages are scrubbed of sensitive patterns (API keys, tokens, passwords) regardless of this setting.

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

### Remote Server URLs
When `opencode.serverUrl` is set, `SessionManager` validates the URL before enabling remote attach.
Invalid URLs are rejected. Non-HTTPS URLs are allowed only for localhost or loopback development
servers. Remote hosts must use HTTPS.

Remote auth secrets should be set through `OpenCode: Attach Remote Server`, which stores the token in
VS Code SecretStorage. Legacy `opencode.serverAuthToken` settings are migrated once into SecretStorage
and cleared from settings to avoid keeping plaintext credentials in shared workspace files.

---

## Verification

To verify your configuration:
1. Open VS Code Command Palette (`Ctrl+Shift+P`)
2. Run `OpenCode: Check CLI Communication` — verifies server connectivity
3. Run `OpenCode: Show Rate Limits` — displays current rate limit status
4. Check the Output panel → `OpenCode` channel for detailed logs
