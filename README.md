# OpenCode

AI coding agent for your editor — write, refactor, test, and debug with natural language commands.

OpenCode brings the [opencode](https://opencode.ai) agentic coding experience directly into VS Code with a rich chat interface, real-time agent visibility, and deep workspace context awareness.

![OpenCode chat panel](https://opencode.ai/_astro/screenshot.CQjBbRyJ_1dLadc.webp)

## Features

- **Rich Chat Interface** — Message bubbles, typing indicators, skill badges, and expandable tool call timelines
- **Agent Visibility** — See exactly what the agent is doing in real-time (reading files, running commands, loading skills)
- **Context-Aware** — Automatically includes open files, diagnostics, git status, and workspace structure
- **Inline Code Actions** — CodeLens on functions for Explain, Refactor, and Generate Tests
- **Smart Diffs** — AI-suggested code changes shown as unified diffs with Accept/Discard controls
- **Checkpoints** — Git worktree snapshots before each AI action for instant rollback
- **Skill Manager** — Browse, enable, and disable opencode agent skills
- **Session History** — Searchable conversation history with resume support
- **@-Mentions** — Reference files, folders, problems, URLs, and terminal output in your prompts
- **Permission Modes** — Normal (ask per action), Plan (review-only), Auto (apply without asking)

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

### Commands

| Command | Action |
|---------|--------|
| `OpenCode: Show Rate Limits` | Opens QuickPick with detailed limits and reset times |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Alt+O` | Toggle OpenCode chat focus |
| `Ctrl+Alt+N` | Start a new conversation |
| `Alt+K` | Insert file reference (@-mention) |

All commands are also available via the Command Palette (`Ctrl+Shift+P`).

## Requirements

- VS Code 1.98.0 or higher
- [opencode CLI](https://opencode.ai) installed on your system

```bash
# Install opencode CLI
curl -fsSL https://opencode.ai/install | bash
# Or via npm
npm install -g opencode-ai
```

## Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `opencode.theme` | `{ "preset": "cli-default" }` | Theme configuration (see above) |

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

## TypeScript Interface

```typescript
interface OpencodeTheme {
  userMessageBg?: string
  userMessageFg?: string
  assistantMessageBg?: string
  assistantMessageFg?: string
  toolCallColor?: string
  toolReadColor?: string
  toolWriteColor?: string
  toolExecColor?: string
  skillBadgeBg?: string
  skillBadgeFg?: string
  thinkingBg?: string
  thinkingBorder?: string
  warningColor?: string
  errorColor?: string
  successColor?: string
  accentColor?: string
  diffAdded?: string
  diffRemoved?: string
  syntaxComment?: string
  syntaxKeyword?: string
  syntaxString?: string
  syntaxNumber?: string
  syntaxFunction?: string
  syntaxType?: string
  syntaxOperator?: string
}
```

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

### Debugging

Press `F5` in VS Code to launch an Extension Development Host with the extension loaded.

### Packaging

Build a `.vsix` installable file:

```bash
# Install the VS Code packaging tool
npm install -g @vscode/vsce

# Package the extension
npx @vscode/vsce package --no-dependencies --allow-missing-repository

# Install the packaged extension
code --install-extension opencode-harness-0.0.1.vsix --force
```

The `.vsix` file will be created in the project root. It contains:
- `dist/extension.js` — the bundled extension
- `src/chat/webview/` — chat UI (HTML, CSS, JS)
- `package.json` — manifest and configuration
- `README.md` — documentation

### Platform Requirements

- **VS Code**: 1.98.0 or higher
- **Node.js**: 20.x or later
- **opencode CLI**: Install from [opencode.ai](https://opencode.ai)
- **Linux**: `libsecret` required for vsce credential store (`sudo pacman -S libsecret` on Arch, `sudo dnf install libsecret-devel` on Fedora)

## License

MIT
