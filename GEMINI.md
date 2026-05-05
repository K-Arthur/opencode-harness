# OpenCode Harness

OpenCode Harness is a VS Code extension that brings the power of the [OpenCode](https://opencode.ai) agentic coding experience directly into the editor. It features a rich, multi-tab chat interface, real-time agent visibility, and deep workspace context awareness.

## Project Overview

-   **Purpose:** Provide an integrated AI coding assistant within VS Code.
-   **Main Technologies:** TypeScript, Node.js, VS Code Extension API, `@opencode-ai/sdk`, esbuild.
-   **Key Features:** Multi-tab concurrent AI workers (up to 3), per-tab model selection, token/cost tracking, smart diffs with review workflow, and git worktree checkpoints for safe rollbacks.

## Architecture

OpenCode follows a modular, event-driven Client-Server model:

-   **Server:** Managed `opencode serve` process providing a REST + SSE API.
-   **Client:** VS Code Extension Host communicating via the `@opencode-ai/sdk`.
-   **Multi-Tab Concurrency:** Each tab maps to an independent server session.
-   **Modular Backend:**
    -   `ChatProvider`: Main orchestrator for the webview.
    -   `SessionManager`: Lifecycle management for the `opencode` server.
    -   `TabManager`: Manages per-tab state and concurrency.
    -   `ContextEngine`: Gathers workspace context (runs in a worker thread).
    -   `DiffApplier`: Handles AI-generated code changes via VS Code's edit API.
    -   `CheckpointManager`: Creates git worktree snapshots before AI actions.

## Building and Running

### Development Commands

-   `npm run build`: Production build via esbuild.
-   `npm run watch`: Auto-rebuild on file changes.
-   `npm run typecheck`: TypeScript type checking.
-   `npm run test:unit`: Run unit tests via Node's test runner.
-   `npm run test:visual`: Run Playwright visual tests.

### Extension Lifecycle

1.  Extension activates on view or command (lazy server start).
2.  `SessionManager` finds a free port and spawns `opencode serve`.
3.  `ChatProvider` initializes the webview with bundled JS and CSS.
4.  User interaction flows from Webview → MessageRouter → StreamCoordinator → SessionManager → OpenCode Server.

## Development Conventions

-   **Modular Handlers:** Keep `ChatProvider` lean by delegating to focused handlers in `src/chat/handlers/`.
-   **Non-Blocking Context:** Always use `ContextEngine` (worker thread) for gathering workspace data.
-   **Transactional Writes:** Never apply code changes directly. Use the `DiffApplier` review workflow (Diff → Review → Apply).
-   **Design Token System:** Use CSS custom properties defined in `src/chat/webview/css/tokens.css` for all UI styling (spacing, typography, colors, animations).
-   **Accessibility First:** Adhere to WCAG standards. Use focus-visible rings, ARIA roles, and respect `prefers-reduced-motion`.
-   **Safety First:** Ensure `CheckpointManager` creates a snapshot before any file modifications.

## Project Structure

-   `src/`: Main source code.
    -   `chat/`: Webview provider, tab management, and message handlers.
    -   `session/`: Server lifecycle and persistent session store.
    -   `context/`: Workspace context gathering engine.
    -   `diff/`: AI-generated code diffing and application.
    -   `webview/`: Frontend code for the chat interface.
-   `tests/`: Unit, integration, and visual tests.
-   `media/`: Icons, logos, and branded assets.
-   `docs/`: Architecture specs and SRS documents.
