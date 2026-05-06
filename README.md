# OpenCode

AI coding agent for your editor — write, refactor, test, and debug with natural language commands.

OpenCode brings the [opencode](https://opencode.ai) agentic coding experience directly into VS Code with a rich chat interface, real-time agent visibility, and deep workspace context awareness.

## Features

- **Multi-Tab Workers** — Run multiple AI sessions concurrently. Each tab is an independent worker with its own model, mode, and conversation history. Up to 3 concurrent streams.
- **Per-Tab Model Selection** — Each conversation can use a different AI model. Switch models without restarting the server.
- **Token & Cost Tracking** — Real-time token usage indicator in the header with color-coded progress (green/yellow/red).
- **Task Completion Banners** — Visual success/error/warning banners for completed operations.
- **Rich Chat Interface** — Premium message bubbles with tail accents, typing indicators, skill badges, and expandable tool call timelines with status pills
- **Model Manager Panel** — Searchable model list with per-model toggle switches, provider grouping, and "Connect provider" integration
- **Branded Welcome Screen** — OpenCode wordmark with workspace-oriented prompt starter cards featuring icon + label + description layout
- **Agent Visibility** — See exactly what the agent is doing in real-time (reading files, running commands, loading skills)
- **Context-Aware** — Automatically includes open files, diagnostics, git status, and workspace structure
- **Inline Code Actions** — CodeLens on functions for Explain, Refactor, and Generate Tests
- **Smart Diffs** — AI-suggested code changes shown as unified diffs with Accept/Discard controls
- **Checkpoints** — Git worktree snapshots before each AI action for instant rollback
- **Slash Commands** — `/clear`, `/model`, `/cost`, `/new`, `/export`, `/compact`, `/continue`, `/help`, `/queue`
- **Export Conversation** — Save current session as Markdown file
- **Session History** — Searchable conversation history with resume support in the chat surface
- **@-Mentions** — Reference files, folders, problems, URLs, and terminal output in your prompts
- **Permission Modes** — Normal (ask per action), Plan (review-only), Auto (apply without asking)

## Multi-Tab Interface

OpenCode now supports multiple concurrent AI workers through a tabbed interface:

### Tab Management
- Click **+** in the tab bar or press `Ctrl+T` to create a new worker
- Each tab has its own conversation history, model, and mode
- Tabs show a **streaming indicator** (pulsing dot) when actively generating
- Close a tab with the **×** button or `Ctrl+W`
- Closing a tab **stops the AI worker** but **preserves the chat history** for resume flows

### Concurrent Stream Limit
- Maximum **3 concurrent AI streams** at once
- Attempting to start a 4th shows a warning with the names of currently streaming tabs
- This prevents rate limit exhaustion and keeps the UI responsive

### Per-Tab Model Selection
- Click the **model dropdown** in the header to select a different model for the active tab
- Models are grouped by provider (Anthropic, OpenAI, etc.)
- Changing a model only affects the active tab — other tabs continue with their own models

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+T` | New tab |
| `Ctrl+W` | Close active tab |
| `Ctrl+Tab` | Next tab |
| `Ctrl+Shift+Tab` | Previous tab |
| `Ctrl+Alt+O` | Toggle OpenCode chat focus |
| `Ctrl+Alt+N` | Start a new conversation |
| `Alt+K` | Insert file reference (@-mention) |
| `Escape` | Close dropdowns/modals |

All commands are also available via the Command Palette (`Ctrl+Shift+P`).

## Design System

OpenCode uses a **token-based design system** for consistent spacing, typography, colors, and animations across the entire interface.

### Spacing Scale (4px baseline)
All padding, margins, and gaps use a consistent scale:
- `--space-1: 4px`, `--space-2: 8px`, `--space-3: 12px`, `--space-4: 16px`, `--space-5: 20px`, etc.

### Typography Scale
- `--text-xs: 11px` (labels, timestamps)
- `--text-sm: 12px` (buttons, metadata)
- `--text-base: 13px` (body text, matches VS Code)
- `--text-md: 14px` (headings)
- `--text-lg: 16px` (section titles)

### Border Radius Scale
- `--radius-sm: 3px` (small badges, tags)
- `--radius-md: 6px` (buttons, inputs)
- `--radius-lg: 8px` (cards, message bubbles)
- `--radius-xl: 10px` (modals, panels)

### Animation Tokens
- `--duration-fast: 150ms` (button hovers, toggles)
- `--duration-normal: 250ms` (dropdowns, panels)
- `--duration-slow: 350ms` (message entrance)
- `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)` (primary easing)

## Theme Customization

OpenCode supports a flexible theme system that mirrors the [opencode CLI theme system](https://opencode.ai/docs/themes/).

### Built-in Presets

| Preset | Description |
|--------|-------------|
| `cli-default` | Matches the default opencode terminal theme (dark) |
| `light` | Light theme with high-contrast text |
| `dark` | Dark theme optimized for code |
| `high-contrast` | Maximum contrast for accessibility |

### Configuration

Set your theme in VS Code `settings.json`:

```json
{
  "opencode.theme": {
    "preset": "cli-default",
    "overrides": {}
  }
}
```

### Available Override Properties

#### UI Colors
- `userMessageBg` — User message bubble background
- `userMessageFg` — User message text color
- `assistantMessageBg` — Assistant message bubble background
- `assistantMessageFg` — Assistant message text color
- `toolReadColor` — "Read" tool calls (file reads, search)
- `toolWriteColor` — "Write" tool calls (file edits, creation)
- `toolExecColor` — "Execute" tool calls (terminal commands)
- `skillBadgeBg` — Skill indicator badge background
- `skillBadgeFg` — Skill indicator badge text
- `thinkingBg` — Thinking/reasoning block background
- `thinkingBorder` — Thinking block left border
- `accentColor` — Primary accent color
- `errorColor` — Error/destructive actions
- `successColor` — Success indicators
- `warningColor` — Warning indicators
- `diffAdded` — Diff added lines color
- `diffRemoved` — Diff removed lines color

#### Syntax Highlighting Colors
- `syntaxComment` — Code comments
- `syntaxKeyword` — Keywords (function, return, if, etc.)
- `syntaxString` — String literals
- `syntaxNumber` — Numeric literals
- `syntaxFunction` — Function names
- `syntaxType` — Type annotations
- `syntaxOperator` — Operators

### Example: Custom Theme

```json
{
  "opencode.theme": {
    "preset": "dark",
    "overrides": {
      "userMessageBg": "#1a1a2e",
      "syntaxKeyword": "#ff79c6",
      "syntaxString": "#50fa7b",
      "accentColor": "#8be9fd"
    }
  }
}
```

### CLI Theme Parity

OpenCode automatically discovers the active theme installed for the `opencode` CLI. It reads your `tui.json` to find the active theme name and loads the corresponding theme `.json` file from your workspace or global config. 

The resolution order is:
1. **Workspace Config**: `<project-root>/.opencode/tui.json` and `<project-root>/.opencode/themes/<theme>.json`
2. **Global Config**: `~/.config/opencode/tui.json` and `~/.config/opencode/themes/<theme>.json` (or `$XDG_CONFIG_HOME`)

Colors are merged in this order (later overrides earlier):
1. Built-in VS Code dynamic tokens
2. OpenCode preset (if specified)
3. Active CLI theme file (resolved from `tui.json`)
4. VS Code Settings `opencode.theme.overrides`

## Rate Limit Monitoring

OpenCode tracks your LLM provider's rate limits in real time and surfaces them in the UI.

### Status Bar Indicator

A status bar entry shows your remaining rate limit as a percentage:

- ◔ 85% — Healthy (>50% remaining)
- ◕ 30% — Warning (10–50% remaining)
- ◗ 5%  — Critical (<10% remaining)

Hover to see a tooltip with detailed breakdown (tokens, requests, reset time). Click to open the rate limit detail panel.

### Proactive Warnings

The extension warns you before you hit limits:
- **Warning** at 10% remaining: "Low rate limit — X% tokens remaining"
- **Critical** at 5% remaining: "Rate limit nearly exhausted. Consider reducing context size."
- **Exhausted**: Send button is disabled, a banner shows when limits reset

### Configuration

```json
{
  "opencode.rateLimits": {
    "openai": { "tokensPerMin": 150000, "requestsPerMin": 60 },
    "anthropic": { "tokensPerMin": 200000, "requestsPerMin": 100 }
  },
  "opencode.rateLimitWarningThreshold": 0.1,
  "opencode.rateLimitCriticalThreshold": 0.05
}
```

## Requirements

- **VS Code** 1.98.0 or higher
- **Node.js** 20.x or later
- **opencode CLI** — the agent runtime (see Setup below)

## Quick Start

```bash
# 1. Install the opencode CLI (agent runtime)
curl -fsSL https://opencode.ai/install | bash
# Verify:
opencode --version   # should show 1.14.x or later

# 2. Clone and build the extension
git clone https://github.com/K-Arthur/opencode-harness
cd opencode-harness
npm install

# 3. Build
npm run build

# 4. Open in VS Code and press F5 to launch Extension Dev Host
code .
# In the new window, click the OpenCode icon in the Activity Bar
```

## Detailed Installation

### Prerequisites

1. **opencode CLI** — The agent backend that this extension connects to.

   ```bash
   # Official install:
   curl -fsSL https://opencode.ai/install | bash

   # Or via npm:
   npm install -g opencode-ai

   # Or via Homebrew (macOS):
   brew install opencode-ai/tap/opencode

   # Verify:
   opencode --version
   opencode doctor   # checks API keys, config, and connectivity
   ```

   You must also configure at least one LLM provider (see `opencode provider --help` or [opencode.ai/docs/providers](https://opencode.ai/docs/providers)).

2. **VS Code 1.98+** with Node.js 20+.
3. **Linux users:** Some setups require `libsecret` for credential storage:
   ```bash
   # Arch
   sudo pacman -S libsecret
   # Ubuntu/Debian
   sudo apt install libsecret-1-dev
   # Fedora
   sudo dnf install libsecret-devel
   ```

### Install via VSIX (packaged release)

```bash
# Build the extension package
npm install
npm run build

# Install vsce (VS Code packaging tool)
npm install -g @vscode/vsce

# Package
npx @vscode/vsce package --no-dependencies --allow-missing-repository

# Install in VS Code
code --install-extension opencode-harness-*.vsix --force
```

### Install via VSIX (pre-built from CI)

If you have a `.vsix` file (e.g. from a CI artifact):

```bash
code --install-extension path/to/opencode-harness-0.2.0.vsix --force
```

After installing, **reload the window** (`Ctrl+Shift+P` → `Developer: Reload Window`).

### Run in Development Mode (F5)

This is the fastest way to develop and test changes without repackaging:

```bash
npm install
npm run build
```

Then in VS Code:
1. Open the `opencode-harness` folder
2. Press **F5** (or `Ctrl+Shift+D` → "Run Extension" dropdown → "Extension" launch config)
3. A new **Extension Development Host** window opens
4. Click the OpenCode icon in the Activity Bar (or `Ctrl+Alt+O`)
5. Select a model from the dropdown and start chatting

**After code changes**, rebuild and reload:

```bash
npm run build
# Then in the Dev Host window: Ctrl+Shift+P → Developer: Reload Window
```

Or use watch mode for auto-rebuild:

```bash
npm run watch    # rebuilds on every save; reload the Dev Host manually
```

### Verify the Extension is Running

Open the **OUTPUT** panel in VS Code (`Ctrl+Shift+U`) and select **"OpenCode Harness"** from the dropdown. You should see:

```
[INFO] OpenCode Harness extension activating…
[INFO] Terminal bridge initialized
[INFO] OpenCode Harness extension activated
[INFO] Chat webview resolved
[INFO] Starting opencode server on port XXXXX (/home/.../opencode)
[INFO] OpenCode server healthy (version 1.14.39)
[INFO] Subscribed to OpenCode event stream
```

If you see these logs, the extension is connected and ready.

## Troubleshooting Common Issues

### "No response" — model sends nothing

**Check the "OpenCode Harness" output channel.** Look for:

```
[stream:session-XXXX] idle → sending {"model":""}
```

If `model` is empty (`""`), the server doesn't know which model to use. **Select a model from the dropdown** in the webview header before sending a message. If the dropdown is empty, wait for the model list to load (check the output channel for `Refreshed models from server: N models available`).

If `model` shows a valid name (e.g. `"opencode/big-pickle"`), check for:

```
[WARN] TTFB timeout for tab session-XXXX — no chunk received within 30000ms
```

This means the model is configured but not responding. Verify your API keys with `opencode doctor`.

### "No response" — chunks arrive but nothing renders

If the output channel shows:

```
[INFO] TTFB: first chunk received for tab session-XXXX
[INFO] [Webview] handleStreamEnd: Ending stream for session-XXXX
```

But the assistant bubble stays empty or invisible, the issue is in the webview render path. Look for diagnostic lines:

```
[INFO] [ChunkBatcher] flush #1 sessionId=XXXX len=123
[INFO] DeltaHandler: emitted text_chunk sessionId=XXXX messageId=XXXX deltaLen=...
[INFO] [Webview] handleStreamChunk: chunk for XXXX len=123 streamingMessageId=resp-...
[INFO] [Webview] handleStreamEnd: removed empty placeholder for XXXX
```

- **Missing `[ChunkBatcher]` lines**: chunks are not reaching the webview. Reload the window.
- **Missing `[Webview] handleStreamChunk` lines** but present `[ChunkBatcher]` lines: the webview's message handler is not processing `stream_chunk` events. This indicates a webview initialization problem — reload the window.
- **Present `[Webview] handleStreamEnd: removed empty placeholder`**: The fallback renderer is active and should display the response. If you still see nothing, check the Developer Tools console (`Ctrl+Shift+I` in the Dev Host) for JavaScript errors.

### "Message shows up after I click history"

This was caused by the stream handler's internal `messages` array being replaced by a new array during session resume, orphaning the active streaming reference. The `addMessage` fallback in `handleStreamEnd` now handles this — if you still see this behavior, check the output channel for `handleStreamEnd: removed empty placeholder`.

### "Model dropdown is empty"

The extension fetches models from the opencode server on startup. If the dropdown is empty:
1. Check the output channel — look for `Refreshed models from server: N models available`
2. Verify the opencode CLI is installed: `opencode --version`
3. Verify at least one provider is configured: `opencode provider list`
4. If models load but the dropdown doesn't update, press `Ctrl+Shift+P` → `Developer: Reload Window`

### TTFB timeout

If every message times out:
1. Run `opencode doctor` from the terminal — checks API keys and connectivity
2. Try a different model from the dropdown
3. Check the output channel for server errors (`[opencode:stderr]`)
4. If using a custom binary path via `opencode.binaryPath`, verify the path is correct

## Development

```bash
# Clone and install dependencies
git clone https://github.com/K-Arthur/opencode-harness
cd opencode-harness
npm install

# Build the extension
npm run build          # bundles extension + webview via esbuild
npm run typecheck      # TypeScript type checking (run before committing)

# Watch mode for development
npm run watch          # auto-rebuild on file changes (reload Dev Host after)

# Run tests
npm run test:unit      # behavioral + structural unit tests
npm run test:lint      # lint with tsc --noEmit
```

| Setting | Default | Scope | Description |
|---------|---------|-------|-------------|
| `opencode.binaryPath` | `""` | machine | Path to the opencode binary. If not set, the extension will search for 'opencode' in your PATH |
| `opencode.theme` | `{ "preset": "cli-default" }` | window | Theme configuration (see Theme Customization below) |
| `opencode.model` | `""` | window | Default model ID in provider/model format (e.g. anthropic/claude-sonnet-4-20250514) |
| `opencode.autoCompact` | `"ask"` | window | Auto-compact behavior: `"ask"` (prompt before compacting), `"auto"` (compact without asking), `"off"` (never auto-compact) |
| `opencode.rateLimits` | `{}` | window | Per-provider rate limit configuration (tokensPerMin, requestsPerMin) |
| `opencode.rateLimitWarningThreshold` | `0.1` | window | Fraction of remaining rate limit that triggers a warning notification (0.0-1.0) |
| `opencode.rateLimitCriticalThreshold` | `0.05` | window | Fraction of remaining rate limit that triggers a critical warning (0.0-1.0) |

## Commands

| Command ID | Title |
|-----------|-------|
| `opencode-harness.openChat` | OpenCode: Open Chat |
| `opencode-harness.newSession` | OpenCode: New Session |
| `opencode-harness.toggleFocus` | OpenCode: Toggle Chat Focus |
| `opencode-harness.explainCode` | OpenCode: Explain Code |
| `opencode-harness.refactorCode` | OpenCode: Refactor Code |
| `opencode-harness.generateTests` | OpenCode: Generate Tests |
| `opencode-harness.insertMention` | OpenCode: Insert File Reference |
| `opencode-harness.captureTerminal` | OpenCode: Capture Terminal Output |
| `opencode-harness.rollback` | OpenCode: Rollback Changes |
| `opencode-harness.selectModel` | OpenCode: Select Model |
| `opencode-harness.showRateLimits` | OpenCode: Show Rate Limits |
| `opencode-harness.checkCli` | OpenCode: Check CLI Communication |
| `opencode-harness.listSessions` | OpenCode: List Sessions |
| `opencode-harness.deleteSession` | OpenCode: Delete Session |
| `opencode-harness.renameSession` | OpenCode: Rename Session |
| `opencode-harness.exportConversation` | OpenCode: Export Conversation |

## Architecture

OpenCode follows a modular, event-driven architecture. Key design decisions:

- **Multi-tab concurrency**: Each tab maps to an independent server session. A single `opencode serve` instance hosts all sessions.
- **Design token system**: All UI values (spacing, typography, colors, animation) are CSS custom properties for consistency.
- **Modular backend**: `ChatProvider` delegates to focused handlers (`TabManager`, `StreamCoordinator`, `MessageRouter`, `DiffHandler`).
- **Soft tab close**: Closing a tab aborts the active stream but preserves chat history for resume flows.
- **CSS bundling**: esbuild bundles 8 modular CSS files into a single stylesheet.
- **Brand assets**: the Activity Bar uses `media/opencode-activity.svg`; the welcome screen uses `media/opencode-wordmark-dark.svg` copied into the webview bundle for standalone tests and packaged VSIX installs.

See [`docs/specs/2026-05-02-opencode-harness-architecture.md`](docs/specs/2026-05-02-opencode-harness-architecture.md) for full system design.

## Development

```bash
# Clone and install dependencies
git clone https://github.com/YOUR_USER/opencode-harness
cd opencode-harness
npm install

# Build the extension
npm run build          # production build via esbuild
npm run typecheck      # TypeScript type checking

# Watch mode for development
npm run watch          # auto-rebuild on file changes
```

### Project Structure

```
src/
├── chat/
│   ├── ChatProvider.ts          # Main webview provider (orchestrator)
│   ├── TabManager.ts            # Per-tab state & concurrency limit
│   ├── ChunkBatcher.ts          # Streaming text chunk batching (50ms flush)
│   ├── WebviewContent.ts        # HTML/CSS injection for webview
│   ├── handlers/
│   │   ├── StreamCoordinator.ts # Per-tab streaming lifecycle
│   │   ├── MessageRouter.ts     # Webview message routing
│   │   └── DiffHandler.ts       # Diff apply/reject tracking
│   └── webview/
│       ├── index.html           # Webview HTML structure
│       ├── main.ts              # Webview entry point (multi-tab)
│       ├── state.ts             # Multi-session state management
│       ├── dom.ts               # DOM element references
│       ├── renderer.ts          # Message block rendering
│       ├── stream.ts            # Streaming message handlers
│       ├── tabs.ts              # Tab bar UI & logic
│       ├── model-dropdown.ts    # Model picker dropdown
│       ├── mentions.ts          # @-mention autocomplete
│       ├── theme.ts             # Context chips & usage bar
│       ├── types.ts             # TypeScript interfaces
│       └── css/
│           ├── tokens.css       # Design tokens (spacing, type, color)
│           ├── base.css         # Reset & utilities
│           ├── layout.css       # Header, tab bar, input
│           ├── components.css   # Buttons, chips, badges
│           ├── messages.css     # Message bubbles, banners
│           ├── blocks.css       # Code, tools, diffs
│           ├── animations.css   # Keyframes & transitions
│           ├── accessibility.css # Focus rings, reduced-motion
│           └── styles.css       # Entry point (imports all)
├── session/
│   ├── SessionManager.ts        # opencode server lifecycle
│   └── SessionStore.ts          # Persistent session storage
├── context/
│   └── ContextEngine.ts         # Workspace context gathering
├── diff/
│   └── DiffApplier.ts           # Diff parsing & application
├── monitor/
│   ├── ContextMonitor.ts        # Context usage status bar
│   └── RateLimitMonitor.ts      # Rate limit tracking
├── model/
│   └── ModelManager.ts          # Model selection & status bar
├── theme/
│   └── ThemeManager.ts          # Theme variable resolution
├── inline/
│   └── InlineActionProvider.ts  # CodeLens actions (Explain, Refactor, Generate Tests)
├── terminal/
│   └── TerminalBridge.ts        # Terminal output capture
├── checkpoint/
│   └── CheckpointManager.ts     # Git snapshots
├── utils/
│   ├── outputChannel.ts         # Logging utility
│   ├── tokenCounter.ts          # Token estimation
│   └── portFinder.ts            # Free port discovery
└── extension.ts                 # Extension entry point
```

### Debugging

Press `F5` in VS Code to launch an Extension Development Host with the extension loaded.

### Testing

```bash
# Run all tests (behavioral + structural)
npm run test:unit

# Run integration tests (requires VS Code Extension Dev Host with Xvfb on Linux)
npm run test:integration

# Run visual regression tests (Playwright)
npm run test:visual

# Run full verification pipeline
npm run typecheck && npm run build && npm run test:unit
```

The project has four test layers:

1. **Behavioral unit tests** (`tests/unit/*.test.mjs`, **61 tests**) — real function-calling tests for SessionStore, EventNormalizer, DiffApplier, mode normalization, and map size limiting
2. **Structural unit tests** (`src/**/*.test.ts`, **356 tests**) — text-grep source code pattern checks (being migrated to behavioral)
3. **Integration tests** (`tests/integration/`, VS Code Extension Dev Host) — verifies activation, commands, configuration, mode switching, and webview message handling
4. **Visual tests** (`tests/visual/`, Playwright) — screenshot-based UI regression testing

### Packaging

Build a `.vsix` installable file:

```bash
# Install the VS Code packaging tool
npm install -g @vscode/vsce

# Package the extension
npx @vscode/vsce package --no-dependencies --allow-missing-repository

# Install the packaged extension
code --install-extension opencode-harness-*.vsix --force
```

The `.vsix` file will be created in the project root. It contains:
- `dist/extension.js` — the bundled extension
- `dist/chat/webview/main.js` — bundled webview JS
- `dist/chat/webview/styles.css` — bundled webview CSS
- `package.json` — manifest and configuration
- `README.md` — documentation

### Platform Requirements

- **VS Code**: 1.98.0 or higher
- **Node.js**: 20.x or later
- **opencode CLI**: Install from [opencode.ai](https://opencode.ai)
- **Linux**: `libsecret` required for vsce credential store (`sudo pacman -S libsecret` on Arch, `sudo dnf install libsecret-devel` on Fedora)

## Accessibility

OpenCode is built with accessibility as a first-class concern:

- **Keyboard navigation**: Full support for Tab, Enter, Escape, arrow keys, and shortcuts
- **Focus management**: Visible `focus-visible` rings on all interactive elements (2px solid, offset 2px)
- **Touch targets**: All interactive elements meet WCAG 2.5.5 minimum (24×24px)
- **Reduced motion**: Respects `prefers-reduced-motion` — animations become instant fades
- **High contrast**: `forced-colors: active` media query ensures borders and focus states are visible
- **ARIA roles**: Tab bar uses `tablist`/`tab`/`tabpanel`, mode selector uses `radiogroup`/`radio`
- **Screen reader support**: Skip link, aria-labels on icon buttons, live regions for status updates

## License

MIT
