# Software Requirements Specification — OpenCode Harness

**Version:** 1.0  
**Date:** 2026-05-02  
**Status:** Draft

---

## 1. Introduction

### 1.1 Purpose

OpenCode Harness is a VS Code extension that deeply integrates the opencode AI coding agent into the IDE, providing a graphical chat interface, real-time agent visibility, intelligent context gathering, and keyboard-driven workflows. It is not a wrapper around the opencode terminal UI — it is a purpose-built client that communicates with opencode's HTTP server via the official SDK.

### 1.2 Scope

This SRS covers the MVP (v1.0) feature set. Post-MVP features are explicitly marked.

### 1.3 Definitions

| Term | Definition |
|------|-----------|
| **opencode** | The open-source AI coding agent CLI, serving as the backend |
| **opencode server** | The HTTP API server started via `opencode serve` |
| **SDK** | The `@opencode-ai/sdk` npm package for type-safe server communication |
| **SSE** | Server-Sent Events — the streaming protocol for real-time agent events |
| **Session** | An opencode conversation, managed via the server's `/session` API |
| **Part** | A typed content block within a message (text, tool_call, skill_load, etc.) |
| **Context package** | A structured bundle of workspace intelligence sent with each prompt |
| **Webview** | VS Code's embedded browser panel for rich UI rendering |
| **Skill** | An opencode agent skill (`.md` file loaded at runtime) |

### 1.4 References

- opencode SDK documentation: https://opencode.ai/docs/sdk/
- opencode Server documentation: https://opencode.ai/docs/server/
- VS Code Extension API: https://code.visualstudio.com/api
- Claude Code for VS Code marketplace page (competitive reference)
- Cline GitHub repository (competitive reference)

---

## 2. Functional Requirements

### 2.1 Agent-Aware Chat Interface (FR-CHAT)

**Priority:** P0 (Core)

The primary interaction point is a rich webview chat panel. It must display:

| FR-ID | Requirement |
|-------|------------|
| FR-CHAT-01 | Display conversation history with timestamps and speaker roles (user, assistant, system) |
| FR-CHAT-02 | Render **skill usage cards**: when the agent loads a skill, show name, duration, and activation output |
| FR-CHAT-03 | Render **tool call timeline**: each tool call (read_file, edit_file, bash, etc.) is an expandable card showing input arguments and result |
| FR-CHAT-04 | Render **thinking/planning blocks**: collapsible reasoning text from the model |
| FR-CHAT-05 | Render **inline diff previews**: for code suggestions, present a unified diff with per-line accept/reject controls |
| FR-CHAT-06 | Support **@-mention system**: typing `@` triggers fuzzy file/path completion. Support `@file`, `@folder`, `@problems`, `@url`, `@terminal` |
| FR-CHAT-07 | Support **permission mode selector**: normal (ask per action), plan (read-only with markdown plan review), auto-accept (skip approval) |
| FR-CHAT-08 | Support **multi-line input** via Shift+Enter, single-line submit via Enter |
| FR-CHAT-09 | Support **session history**: searchable list of past conversations, resume with full context |
| FR-CHAT-10 | Support **multiple parallel sessions** via separate editor tabs or windows |
| FR-CHAT-11 | Support **image paste/drag** into the chat input |

### 2.2 Intelligent Context Engine (FR-CTX)

**Priority:** P0

| FR-ID | Requirement |
|-------|------------|
| FR-CTX-01 | Always include content of all open editor tabs (capped at 8KB per file) |
| FR-CTX-02 | Include active text selection with file path and line range |
| FR-CTX-03 | Include workspace diagnostic errors and warnings (Problems panel) |
| FR-CTX-04 | Include project directory tree (depth-limited to 3 levels) |
| FR-CTX-05 | Include relevant project config files (package.json, tsconfig.json, etc.) |
| FR-CTX-06 | Include active git branch and recent git diff |
| FR-CTX-07 | Support **terminal capture**: user selects terminal output block → sent as context |
| FR-CTX-08 | Support **@url context**: fetch URL content, convert to markdown, inject |
| FR-CTX-09 | Support **@problems context**: inject workspace errors/warnings on demand |
| FR-CTX-10 | Support **@folder context**: inject entire folder contents on demand |
| FR-CTX-11 | Context gathering must run in a worker thread — never block the UI |
| FR-CTX-12 | Offer two modes: **Basic** (<10ms, always on) and **Deep** (<50ms, includes AST + full git diff, optional) |

### 2.3 Keyboard-Driven Workflow (FR-KEY)

**Priority:** P1

| FR-ID | Requirement |
|-------|------------|
| FR-KEY-01 | All major commands must have customizable keyboard shortcuts |
| FR-KEY-02 | Default shortcuts: `Ctrl+Esc` toggle chat focus, `Ctrl+Shift+Esc` new session, `Alt+K` insert @-mention reference |
| FR-KEY-03 | All actions accessible via Command Palette (`Ctrl+Shift+P`) |
| FR-KEY-04 | Keyboard navigation within the chat webview (arrow keys, Tab for @-mention cycling) |

### 2.4 Inline Code Actions (FR-INLINE)

**Priority:** P1

| FR-ID | Requirement |
|-------|------------|
| FR-INLINE-01 | CodeLens annotations on functions/classes: "Explain", "Refactor", "Generate Tests", "Optimize" |
| FR-INLINE-02 | Right-click context menu: "Send to OpenCode → Explain/Refactor/Test..." |
| FR-INLINE-03 | Generated code displayed as a diff for approval before application |
| FR-INLINE-04 | Apply via `workspace.applyEdit()` — native VS Code undo stack |

### 2.5 Terminal Integration (FR-TERM)

**Priority:** P1

| FR-ID | Requirement |
|-------|------------|
| FR-TERM-01 | Dedicated output channel showing raw opencode server logs |
| FR-TERM-02 | Terminal capture: user selects output block, sends as context (see FR-CTX-07) |
| FR-TERM-03 | Shell command execution: agent can propose terminal commands; user approves; results stream back |

### 2.6 Skill Manager (FR-SKILL)

**Priority:** P2

| FR-ID | Requirement |
|-------|------------|
| FR-SKILL-01 | Tree view listing all available opencode skills |
| FR-SKILL-02 | Toggle to enable/disable individual skills |
| FR-SKILL-03 | Visual indicator (status bar icon or badge) when a skill is currently active |
| FR-SKILL-04 | Skill metadata display: name, description, file path |

### 2.7 Context Window Monitor (FR-MON)

**Priority:** P2

| FR-ID | Requirement |
|-------|------------|
| FR-MON-01 | Status bar progress ring showing estimated context usage (percentage) |
| FR-MON-02 | Color-coded thresholds: green (<50%), yellow (50-75%), red (>75%) |
| FR-MON-03 | Warning toast when approaching model context limit |
| FR-MON-04 | Token estimation must take <10ms |

### 2.8 Checkpoint & Rollback (FR-CKP)

**Priority:** P2

| FR-ID | Requirement |
|-------|------------|
| FR-CKP-01 | Before any AI-initiated file write, take a git worktree snapshot |
| FR-CKP-02 | Provide `/rollback` command to restore to any checkpoint |
| FR-CKP-03 | Checkpoint list UI: show snapshot timestamp, triggering message, files changed |
| FR-CKP-04 | Support "Restore Workspace Only" and "Restore Task and Workspace" |

### 2.9 Deep Linking (FR-LINK)

**Priority:** P2

| FR-ID | Requirement |
|-------|------------|
| FR-LINK-01 | Register `vscode://opencode-harness/open` URI handler |
| FR-LINK-02 | Support `?prompt=` parameter for pre-filled prompt text |
| FR-LINK-03 | Support `?session=` parameter to resume a specific session |

---

## 3. Non-Functional Requirements

### 3.1 Performance

| NFR-ID | Requirement | Target |
|--------|------------|--------|
| NFR-PERF-01 | Extension activation time overhead | <50ms |
| NFR-PERF-02 | Chat input responsiveness during AI generation | No >16ms UI blocks |
| NFR-PERF-03 | Context gathering time (basic mode) | <10ms |
| NFR-PERF-04 | Context gathering time (deep mode) | <50ms |
| NFR-PERF-05 | Token estimation time | <10ms |
| NFR-PERF-06 | All AI operations are non-blocking (async) | — |

### 3.2 Reliability

| NFR-ID | Requirement |
|--------|------------|
| NFR-REL-01 | Graceful recovery if opencode server crashes: auto-restart, preserve chat history |
| NFR-REL-02 | All file operations are transactional: diff → review → apply (never direct write) |
| NFR-REL-03 | Extension must not lose chat history on unexpected VS Code close |

### 3.3 Platform Support

| NFR-ID | Requirement |
|--------|------------|
| NFR-PLAT-01 | First-class support on Arch Linux |
| NFR-PLAT-02 | First-class support on Fedora/RHEL (RPM-based distros) |
| NFR-PLAT-03 | Packaged as standard `.vsix` |
| NFR-PLAT-04 | Publishable on VS Code Marketplace |
| NFR-PLAT-05 | Requires VS Code 1.98.0 or higher |
| NFR-PLAT-06 | Respects `XDG_CONFIG_HOME` and standard Linux paths for opencode binary discovery |

### 3.4 Security

| NFR-ID | Requirement |
|--------|------------|
| NFR-SEC-01 | Extension never stores or transmits LLM API keys |
| NFR-SEC-02 | All opencode server communication is localhost-only (127.0.0.1) |
| NFR-SEC-03 | Port allocation uses dynamic high ports (49152-65535) |
| NFR-SEC-04 | Workspace trust: extension respects VS Code Restricted Mode |

### 3.5 Extensibility

| NFR-ID | Requirement |
|--------|------------|
| NFR-EXT-01 | Provider-agnostic: extension does not hardcode any LLM provider |
| NFR-EXT-02 | All opencode communication goes through the SDK, not direct API calls |
| NFR-EXT-03 | Customizable keyboard shortcuts via VS Code's keybindings.json |

---

## 4. User Interface Layout

| Location | Component | Description |
|----------|-----------|-------------|
| Activity Bar (left sidebar) | OpenCode activity icon | Opens the primary OpenCode chat view |
| Primary sidebar | Chat panel | Rich webview with branded welcome state, conversation history, tool cards, skill cards |
| Editor toolbar | Spark icon | Quick-launch chat for current file context |
| Editor gutter | CodeLens | Inline action triggers on functions/classes |
| Context menu | "Send to OpenCode" | Submenu for code actions |
| Status bar | Context ring + status indicator | Token usage percentage + idle/thinking/busy indicator |
| Command Palette | All commands | Keyboard-accessible command list |

---

## 5. Development Phases

### Phase 1: Foundation (Week 1-2)
- Project scaffolding (yo code + TypeScript + esbuild)
- SessionManager: server lifecycle, SDK client, health check, port management
- Basic output channel for raw server logs
- Extension activate/deactivate lifecycle
- Port auto-discovery and auto-reconnect

### Phase 2: Interactive Features (Week 3-4)
- ChatProvider webview with message history
- SSE event integration: tool call cards, skill usage cards, thinking blocks
- DiffApplier: parse AI output, show unified diff, accept/reject
- @-mention system: @file, @folder, @problems, @url
- Permission mode selector
- Dev server running extension for manual testing

### Phase 3: Context & Control (Week 5-6)
- ContextEngine: open tabs, diagnostics, git status, workspace tree
- Basic and Deep context modes
- Keyboard shortcuts for all major commands
- Status bar context monitor (ring indicator)
- InlineActionProvider: CodeLens + context menu actions
- TerminalBridge: output channel + terminal capture

### Phase 4: Advanced & Polish (Week 7-8)
- CheckpointManager: git worktree snapshots + rollback UI
- SkillManager: tree view, enable/disable, visual indicator
- Session history with search
- URI handler for deep linking
- Platform testing on Arch Linux and Fedora
- `.vsix` packaging, Marketplace publishing prep
- Performance audit and error recovery

---

## 6. Success Metrics

| Metric | Target |
|--------|--------|
| Extension startup overhead | <50ms |
| Chat input responsiveness | No perceptible lag during AI generation |
| Context gathering completeness | All open tabs + diagnostics + git status included |
| Keyboard accessibility | All core actions have working shortcuts |
| Platform compatibility | Runs on Arch Linux, Fedora, and stock VS Code |
| Session recovery | 100% chat history preserved after server crash + restart |
