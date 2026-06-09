# Project-Specific Rules
<!-- This file is owned by YOU. ForgeCraft will never overwrite it. -->
<!-- Add project-specific rules, framework choices, conventions, and corrections here. -->

## Framework & Stack Choices
- **Runtime**: VS Code Extension API (^1.98.0)
- **Language**: TypeScript with strict mode
- **SDK**: @opencode-ai/sdk for opencode server communication
- **UI**: Webview (HTML/CSS/TypeScript embedded in VS Code extension)
- **Testing**: Playwright (E2E for webview), ts-jest (unit tests)
- **Build**: esbuild, npm
- **Deploy target**: VS Code Marketplace (.vsix package)

## VS Code Extension Specific Rules
### Extension Architecture
- Follow Client-Server model: extension is a client to opencode HTTP server
- Do NOT embed or spawn opencode CLI directly for chat
- Manage server process lifecycle in `SessionManager`
- Each tab = independent worker (server session) with own model, mode, and conversation history
- Max 3 concurrent streams (enforced by `TabManager`)

### Webview Guidelines
- Webview content in `src/webview/` directory
- Use `MessageRouter` to route messages between extension host and webview
- SSE streaming for real-time agent visibility (no polling)
- Transactional writes only: Diff → Review → Apply via VS Code's undoable edit API
- Never apply code changes directly without user review

### Event-Driven Architecture
- Use SSE (Server-Sent Events) streaming for real-time agent state updates
- Event-based communication between components (no polling)
- `StreamCoordinator` manages per-tab SSE streams

### Non-Blocking Design
- All intensive work (context gathering, diff generation) runs in worker threads
- Use `vscode.workspace.createFileSystemWatcher` for file system events
- Long-running operations must report progress via `vscode.Progress`

### Graceful Degradation
- Every component handles the case where opencode server is unavailable
- Show user-friendly error messages with actionable next steps
- Extension must remain functional (with limited features) when server is down

### Inline Actions
- CodeLens providers for inline actions
- Context menu contributions for right-click actions
- Register in `extension.ts` activate()

### Tree Views
- `SkillManager` as tree view for skill management
- Follow VS Code tree data provider pattern
- Refresh tree view on skill changes

### Status Bar Items
- `ContextMonitor` status bar item for context awareness
- `ModelManager` status bar item for model selection per tab
- Update status bar based on current tab/session state

### URI Handling
- Register URI handler for `vscode://opencode-harness/open`
- Parse URI to extract session/tab parameters
- Handle deep linking to specific tabs or conversations

### Keyboard Shortcuts
- Register all commands with `vscode.commands.registerCommand`
- Add keyboard shortcuts in `package.json` contributes.keybindings
- Tab management shortcuts (new tab, close tab, switch tab)

### Terminal Integration
- `TerminalBridge` for agent output channel
- Use `vscode.window.createOutputChannel` for logging
- Bridge extension logs to terminal for debugging

## Custom Corrections Log
<!-- Log AI corrections so the pattern isn't repeated. -->
<!-- Format: - YYYY-MM-DD: [description of correction] -->
- 2026-05-04: Renamed .claude/ to .opencode/ for opencode compatibility
- 2026-05-04: Filled in PRD.md and TechSpec.md with actual project requirements
- 2026-05-04: Added VS Code extension specific rules to project-specific.md

## Project-Specific Gates
<!-- Add quality rules specific to this project that don't belong in universal standards. -->

### Extension Gates
- **EXT-001**: Extension must activate without errors in VS Code
- **EXT-002**: All user-facing strings must be externalized (i18n ready)
- **EXT-003**: No hardcoded opencode server port (use config/defaults)
- **EXT-004**: All public APIs in extension must have JSDoc documentation
- **EXT-005**: Webview HTML must not contain inline event handlers (CSP compliant)
- **EXT-006**: Extension context (vscode.ExtensionContext) must be stored for subscriptions cleanup
- **EXT-007**: All disposables must be pushed to context.subscriptions for cleanup
- **EXT-008**: Error messages must be user-actionable (not raw error strings)

### Performance Gates
- **PERF-001**: Extension activation time < 500ms
- **PERF-002**: Webview render time < 100ms
- **PERF-003**: SSE stream reconnect < 1 second on disconnect
- **PERF-004**: Tab switch time < 200ms

### Security Gates
- **SEC-001**: No API keys/secrets in extension code
- **SEC-002**: Webview communication must validate message origin
- **SEC-003**: User input sanitization before sending to opencode server
- **SEC-004**: No eval() or dynamic code execution in webview
