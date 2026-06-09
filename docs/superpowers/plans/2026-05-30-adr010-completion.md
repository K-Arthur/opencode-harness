# ADR-010 Completion Plan

> **Goal:** Wire SessionManagerRegistry into the runtime, add processStrategy config, support per-process OPENCODE_DATA_DIR.

**Architecture:** The registry sits between ChatProvider/StreamCoordinator and the SessionManager. In "shared" mode (default), all tabs route to the same SessionManager. In "per-tab" mode, each tab gets its own process. The registry resolves the correct SessionManager per tab.

**Remaining Tasks:**
1. Add `processStrategy` config to package.json
2. Wire `SessionManagerRegistry` into extension.ts
3. Accept registry in ChatProvider constructor
4. Resolve per-tab SessionManager in StreamCoordinator.startPrompt
5. Per-process OPENCODE_DATA_DIR support in LocalSessionProcessManager
6. Structural tests
7. Update ADR-010 status
8. Build, verify, install, reindex, docs
