# Changelog

All notable changes to the **OpenCode Harness** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-05-03

### Added
- Initial release of the OpenCode VS Code extension harness
- Chat sidebar with streaming AI responses via OpenCode CLI
- Multi-tab session management with persistent history
- Model picker with provider/model selection (no server restart needed)
- Agent mode toggle (Normal / Plan / Build)
- Inline CodeLens actions (Explain, Refactor, Generate Tests)
- `@mention` context system for files, symbols, and terminals
- Diff preview with accept/reject in chat
- Permission request handling for CLI tool calls
- Theme integration with VS Code (dark, light, high-contrast)
- CLI theme file discovery (`~/.config/opencode/themes/`)
- Session tree view for browsing saved conversations
- Context usage monitoring with progress bar
- Rate limit monitoring and warnings
- Checkpoint/rollback support
- URI handler for deep links (`vscode://opencode-harness?prompt=...`)
- Keyboard shortcuts for common actions
- Configurable settings (binary path, theme, model, context options)

### Security
- Binary path validation (absolute paths only, shell metacharacters rejected)
- `shell: false` on all `child_process.spawn` calls
- Path traversal protection in CLI theme name resolution
- Input validation on all webview messages
- Content Security Policy configured in webview
- No hardcoded secrets or credentials

### Fixed
- Missing commands in Command Palette (`openChat`, `toggleFocus`, `insertMention`, `showRateLimits`)
- CSS theming fallbacks for all 19 custom properties
- ThemeManager synchronous file system reads replaced with 30s TTL cache
- Undefined CSS value filtering to prevent literal "undefined" injection
- Error boundaries on all command handlers to prevent unhandled promise rejections
- Race condition guard on concurrent `SessionManager.start()` calls
- Graceful server shutdown with SIGTERM → SIGKILL fallback