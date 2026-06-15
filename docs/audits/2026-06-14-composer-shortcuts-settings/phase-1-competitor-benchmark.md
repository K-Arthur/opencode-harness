# Competitor Research Report — Phase 1

**Date:** 2026-06-14
**Sources:** WebFetch (Anthropic Claude Code docs, Cursor docs index, GitHub opencode-ai/opencode README), internal knowledge

## Claude Code (Anthropic)

**Surface:** Terminal CLI (primary), VS Code extension, Desktop app, Web, JetBrains
**Architecture:** Go-based TUI (Bubble Tea) for terminal; JS-based webview for VS Code
**Composer:** Terminal — bottom-anchored input line; VS Code — sidebar webview with textarea
**Keybindings:**
- `Ctrl+C` — quit
- `Ctrl+?` or `?` — help dialog
- `Ctrl+L` — view logs
- `Ctrl+K` — command dialog
- `Ctrl+O` — model selection
- `Ctrl+N` — new session
- `Ctrl+X` — cancel operation
- `i` — focus editor
- `Esc` — close overlay / exit write mode
- `Ctrl+S` / `Enter` — send
- `Ctrl+E` — open external editor
- Vim-style navigation (j/k/↑/↓) in lists

**Settings:** JSON config file (`~/.claude.json`), environment variables, CLI flags
**Message counting:** Per-turn (1 user + 1 assistant), server-authoritative
**Accessibility:** TTY partial. No high-contrast themes. Screen-reader via TTY only.
**Key differentiator:** Agentic architecture with sub-agents, MCP server support, desktop app, scheduled tasks

## Cursor

**Surface:** VS Code fork (proprietary)
**Composer:** Sidebar webview + inline editor ("Tab" for inline completion)
**Keybindings:** VS Code-native. `Cmd/Ctrl+L` focus chat. `Cmd/Ctrl+Shift+L` add selection. `Cmd/Ctrl+K` inline edit.
**Settings:** JSON file + UI panel within VS Code settings
**Message counting:** Per-message
**Accessibility:** Good — inherits VS Code accessibility features. High-contrast supported via VS Code themes.
**Key differentiator:** Custom VS Code fork with deep editor integration, inline AI suggestions, "Apply" workflow

## Continue.dev

**Surface:** VS Code extension (also JetBrains)
**Composer:** Sidebar webview with chat panel
**Keybindings:** `Cmd/Ctrl+L` selection→chat, `Cmd/Ctrl+I` inline edit, `Cmd/Ctrl+Shift+L` add context
**Settings:** `config.json` file-first (in project root) with UI sidebar
**Message counting:** Per-message
**Accessibility:** Good — well-audited, proper ARIA
**Key differentiator:** Open-source, config-file-in-project pattern, hub-and-spoke model selection

## Cline

**Surface:** VS Code extension
**Composer:** Editor panel (not sidebar)
**Keybindings:** Minimal VS Code commands; mostly mouse-driven with VS Code standard shortcuts
**Settings:** VS Code settings (`cline.*` namespace)
**Message counting:** Per-message
**Accessibility:** Partial. Inherits VS Code but no custom webview a11y.
**Key differentiator:** Open-source, Act (agentic agent), checkpoints, fork of Continue

## Roo Code

**Surface:** VS Code extension
**Composer:** Editor panel
**Keybindings:** Minimal; similar to Cline
**Settings:** VS Code settings (`roo.*` namespace)
**Message counting:** Per-message
**Accessibility:** Partial
**Key differentiator:** Custom modes (Architect, Ask), task decomposition

## OpenCode CLI (opencode-ai/opencode)

**Surface:** TUI (terminal), Go-based CLI
**Composer:** Bottom-anchored terminal input line with vim-like editor mode
**Keybindings:**
- `Ctrl+N` — new session
- `Ctrl+X` — cancel
- `Ctrl+K` — command dialog
- `Ctrl+O` — model selection
- `Ctrl+S` / Enter — send
- `Ctrl+E` — external editor
- `Esc` — close overlay
- Vim-style j/k/↑/↓ navigation

**Settings:** JSON config file (`~/.opencode.json`, `$XDG_CONFIG_HOME/opencode/`, `./.opencode.json`)
**Message counting:** Server-authoritative (via SDK)
**Architecture:** Go, Bubble Tea TUI, SQLite persistence, LSP integration, MCP support
**Note:** Archived — project moved to Crush (charmbracelet/crush)

## Competitive benchmark vs our extension

| Feature | Us | Claude Code | Cursor | Continue | Cline | Roo |
|---|---|---|---|---|---|---|
| Composer placement | Sidebar | Terminal/Sidebar | Sidebar | Sidebar | Editor | Editor |
| `Ctrl+L` focus compose | ✅ (webview only) | ✅ (CLI logs) | ✅ (VS Code) | ✅ (VS Code) | ❌ | ❌ |
| `Ctrl+K` command palette | ✅ (webview) | ✅ (CLI) | ✅ (inline) | ✅ (VS Code) | ✅ | ❌ |
| `Ctrl+N` new tab | ✅ (webview) | ✅ (CLI) | ❌ | ❌ | ❌ | ❌ |
| Keyboard shortcuts in VS Code picker | ❌ (13/21 are suppressKey) | ❌ (TTY only) | ✅ (fork) | ✅ (commands) | ✅ (commands) | ✅ (commands) |
| Model picker | ✅ (dropdown) | ✅ (Ctrl+O) | ✅ (dropdown) | ✅ (sidebar) | ✅ (dropdown) | ✅ (dropdown) |
| Mode picker (plan/build/auto) | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ (Architect/Ask) |
| Queue while streaming | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| High-contrast theme | ✅ (VS Code + custom) | ❌ (TTY) | ✅ (inherits) | ✅ | ✅ (inherits) | ✅ (inherits) |
| Screen reader support | Partial | ❌ (TTY) | Partial | Good | Partial | Partial |
| Skip link | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| WCAG 2.5.8 24px targets | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `prefers-reduced-motion` | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Message dedup (upsertById) | ✅ | N/A (server) | N/A | N/A | N/A | N/A |
| Draft persistence | ✅ (tab-switch) | ❌ | ❌ | ❌ | ❌ | ❌ |
| Draft on page reload | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

**Key finding:** Our extension leads on several accessibility features (skip-link, 24px targets, reduced-motion, high-contrast forced-colors mode) and unique UX (queue-while-streaming, plan/build/auto modes, draft persistence). The biggest gap is **keyboard shortcut discoverability** — our webview shortcuts are invisible to VS Code's Keyboard Shortcuts editor, while Cursor/Continue/Cline/Roo all register theirs as proper VS Code commands.
