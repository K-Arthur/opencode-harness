# PRD: OpenCode Harness

## Background & Context
OpenCode Harness is a VS Code extension that deeply integrates the opencode AI coding agent into the editor. It provides a rich, multi-tab chat interface, real-time agent visibility, and deep workspace context awareness. The extension acts as a client to the opencode HTTP server, communicating via the official `@opencode-ai/sdk` npm package.

## Stakeholders
- **Product Owner**: OpenCode team
- **Users**: Software developers and coders using VS Code
- **Developers**: Extension maintainers, VS Code extension developers

## User Stories
### Core Chat Experience
- **US-001**: As a developer, I want to open a chat panel in VS Code so that I can interact with the opencode AI agent without leaving my editor
- **US-002**: As a developer, I want to open multiple chat tabs so that I can work on different tasks concurrently (max 3 concurrent streams)
- **US-003**: As a developer, I want to see real-time agent state updates via SSE streaming so that I understand what the agent is doing
- **US-004**: As a developer, I want code changes presented as diffs so that I can review before applying them

### Workspace Integration
- **US-005**: As a developer, I want the agent to have deep workspace context awareness so that it understands my project structure
- **US-006**: As a developer, I want inline actions (CodeLens + context menus) so that I can trigger agent actions from within my code
- **US-007**: As a developer, I want to manage skills through a tree view so that I can enable/disable agent capabilities
- **US-008**: As a developer, I want terminal integration so that I can see agent output in a dedicated channel
- **US-009**: As a developer, I want proactive context optimization suggestions so that I can avoid context overflow and reduce costs
- **US-010**: As a developer, I want to see skill performance metrics so that I can identify which skills are most effective for my workflows

### Session Management
- **US-009**: As a developer, I want each tab to maintain its own conversation history so that I can switch between tasks
- **US-010**: As a developer, I want closing a tab to stop the worker but preserve history so that I can resume later
- **US-011**: As a developer, I want model selection per tab so that I can use different models for different tasks
- **US-012**: As a developer, I want a navigation timeline so that I can quickly jump to specific points in a long conversation
- **US-013**: As a developer, I want my session history to be resilient to server-side lag so that I don't lose responses during finalization

## Requirements
### Functional Requirements
- **FR-001**: Extension must start/stop opencode server process (`opencode serve`) on VS Code activation/deactivation
- **FR-002**: Extension must provide a sidebar chat panel with multi-tab support (max 3 concurrent)
- **FR-003**: Extension must communicate with opencode server via `@opencode-ai/sdk` using REST API + SSE streaming
- **FR-004**: Extension must route webview messages through MessageRouter to appropriate handlers
- **FR-005**: Extension must handle diff generation and presentation for code changes (transactional writes only)
- **FR-006**: Extension must provide inline actions via CodeLens and context menus
- **FR-007**: Extension must provide proactive context optimization suggestions when usage is high
- **FR-008**: Extension must register SkillManager tree view for skill management
- **FR-009**: Extension must register ContextMonitor and ModelManager status bar items
- **FR-010**: Extension must track and display skill performance metrics (usage count, effectiveness score)
- **FR-011**: Extension must handle URI scheme `vscode://opencode-harness/open` for deep linking
- **FR-012**: Extension must gracefully degrade when opencode server is unavailable
- **FR-013**: Extension must support keyboard shortcuts for tab and mode management
- **FR-014**: Extension must persist chat history to workspace state

### Non-Functional Requirements
[Generated from active tags: UNIVERSAL, LIBRARY]
- **NFR-001**: Code must follow TypeScript best practices with strict typing
- **NFR-002**: Extension must handle errors gracefully with user-friendly messages
- **NFR-003**: All user-facing strings must be externalized for i18n readiness
- **NFR-004**: Extension must maintain <100ms response time for UI interactions
- **NFR-005**: Tests must achieve >80% code coverage
- **NFR-006**: All public APIs must have JSDoc documentation
- **NFR-007**: Extension must follow VS Code extension best practices
- **NFR-008**: npm package must follow semver with proper versioning

## Out of Scope
- Embedding or spawning opencode CLI directly for chat (extension uses SDK to communicate with server)
- Supporting non-VS Code editors
- Providing the opencode server itself (extension is a client only)
- Mobile/tablet VS Code scenarios

## Success Metrics
- Extension loads without errors in VS Code
- Chat interface works with multiple tabs (up to 3 concurrent)
- opencode agent integration is functional (messages send/receive)
- SSE streaming provides real-time agent visibility
- Diff presentation and apply workflow functions correctly
- All 16 tests pass with >80% coverage
- Extension package size remains under 10MB

## Open Questions
- What is the exact behavior when reaching max 3 concurrent tab limit?
- How should the extension handle opencode server crashes/restarts?
- What telemetry/analytics should be collected (if any)?
