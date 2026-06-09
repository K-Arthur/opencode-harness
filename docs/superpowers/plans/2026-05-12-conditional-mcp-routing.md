# Conditional MCP Tool Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the integration of conditional MCP tool routing using `when` conditions in the opencode-harness VSCode extension.

**Architecture:**
- MCP servers can have `when` conditions in their config
- `McpServerManager` evaluates these conditions against the current model
- When a model doesn't match a server's `when` condition, tools from that server are disabled
- `SessionManager.sendPrompt()` and `sendPromptAsync()` apply the filtering before sending to the server

**Tech Stack:**
- TypeScript
- Node.js `node:test` (for tests)
- VSCode Extension API

---

## Current State (Already Implemented)

These components are already implemented in `src/mcp/McpServerManager.ts`:
- `McpServerWhenCondition` interface with `provider` and `model` fields
- `patternsToRegex()` helper - converts glob patterns to RegExp
- `matchesPatterns()` helper - checks if value matches any glob pattern
- `isEnabledForModel()` function - evaluates a server's `when` condition
- `McpServerManager.isServerEnabledForModel()` - public method
- `McpServerManager.getFilteredTools()` - filters tools map based on model
- `McpServerManager.getServersForModel()` - returns servers with enabledForModel flag

**What's missing:**
1. `McpServerManager` reference in `SessionManager` constructor
2. `getFilteredTools()` applied in `sendPrompt()` and `sendPromptAsync()`
3. `McpServerManager` wired up in `extension.ts`
4. Tests for all new functionality

---

## Task 1: Add McpServerManager reference to SessionManager

**Files:**
- Modify: `src/session/SessionManager.ts`
- Test: `src/session/SessionManager.test.ts`

**Current state check:**
```typescript
// In SessionManager constructor - check if mcpServerManager is already passed
// Currently: constructor has no mcpServerManager parameter
```

- [ ] **Step 1: Write the failing test**

Add to `src/session/SessionManager.test.ts`:

```typescript
describe("SessionManager - MCP filtering", () => {
  it("accepts McpServerManager in constructor", () => {
    // Verify source has import for McpServerManager
    assert.ok(
      source.includes("McpServerManager"),
      "SessionManager must import McpServerManager"
    );
    // Verify constructor accepts mcpServerManager parameter
    assert.ok(
      source.includes("mcpServerManager") && source.includes("constructor"),
      "constructor must accept mcpServerManager parameter"
    );
  });

  it("stores McpServerManager reference", () => {
    assert.ok(
      source.includes("private mcpServerManager") || 
      source.includes("private readonly mcpServerManager"),
      "must store mcpServerManager as private property"
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/session/SessionManager.test.ts`
Expected: FAIL (tests check for code that doesn't exist yet)

- [ ] **Step 3: Write minimal implementation**

In `src/session/SessionManager.ts`:

1. Add import:
```typescript
import { type McpServerManager } from "../mcp/McpServerManager"
```

2. Add private property:
```typescript
export class SessionManager {
  // ... existing properties ...
  private mcpServerManager: McpServerManager | null = null
```

3. Add parameter to constructor (find the constructor and add):
```typescript
constructor(
  context: vscode.ExtensionContext,
  mcpServerManager?: McpServerManager
) {
  this.mcpServerManager = mcpServerManager ?? null
  // ... rest of constructor
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/session/SessionManager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/session/SessionManager.ts src/session/SessionManager.test.ts
git commit -m "feat: add McpServerManager reference to SessionManager"
```

---

## Task 2: Apply getFilteredTools in sendPrompt()

**Files:**
- Modify: `src/session/SessionManager.ts` (around line 1021)
- Test: `src/session/SessionManager.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/session/SessionManager.test.ts`:

```typescript
describe("sendPrompt - MCP tool filtering", () => {
  it("applies getFilteredTools when mcpServerManager is available", () => {
    // Check that sendPrompt calls getFilteredTools
    const sendPromptSection = source.substring(
      source.indexOf("async sendPrompt("),
      source.indexOf("async sendPromptAsync(")
    );
    
    assert.ok(
      sendPromptSection.includes("getFilteredTools"),
      "sendPrompt must call getFilteredTools when mcpServerManager exists"
    );
    
    // Check that modelRef is extracted and passed
    assert.ok(
      sendPromptSection.includes("modelRef") && 
      (sendPromptSection.includes("providerID") || sendPromptSection.includes("modelID")),
      "sendPrompt must extract modelRef providerID and modelID"
    );
  });

  it("merges filtered tools with existing options.tools", () => {
    const sendPromptSection = source.substring(
      source.indexOf("async sendPrompt("),
      source.indexOf("async sendPromptAsync(")
    );
    
    // Should handle case where options.tools already exists
    assert.ok(
      sendPromptSection.includes("options?.tools") || 
      sendPromptSection.includes("...options?.tools"),
      "sendPrompt must preserve existing options.tools"
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/session/SessionManager.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Modify `sendPrompt()` in `src/session/SessionManager.ts`:

```typescript
async sendPrompt(
    sessionId: string,
    parts: (TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput)[],
    options?: PromptOptions
  ): Promise<{ info: Message; parts: Part[] }> {
    if (this.disposed) throw new Error("SessionManager has been disposed")
    if (!this.client) throw new Error("Server not running")

    const modelRef = options?.model ?? this.currentModel ?? undefined
    const variant = options?.variant
    const idempotencyKey = `${sessionId}-${randomUUID()}`
    
    // Apply MCP tool filtering based on model
    let tools = options?.tools
    if (this.mcpServerManager && modelRef) {
      tools = this.mcpServerManager.getFilteredTools(
        modelRef.providerID,
        modelRef.modelID,
        tools ?? {},
      )
    }
    
    log.info(`Sending prompt to session ${sessionId} (idempotency: ${idempotencyKey.slice(0, 16)}..., model=${modelRef ? `${modelRef.providerID}/${modelRef.modelID}` : "default"}, variant=${variant ?? "none"}, tools=${JSON.stringify(tools ?? {})})`)

    const resp = await this.client.session.prompt({
      path: { id: sessionId },
      headers: {
        "Idempotency-Key": idempotencyKey,
      },
      body: {
        parts,
        ...(modelRef ? { model: modelRef } : {}),
        ...(variant ? { variant } : {}),
        ...(tools ? { tools } : {}),
      },
    })

    // ... rest of method
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/session/SessionManager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/session/SessionManager.ts src/session/SessionManager.test.ts
git commit -m "feat: apply MCP tool filtering in sendPrompt()"
```

---

## Task 3: Apply getFilteredTools in sendPromptAsync()

**Files:**
- Modify: `src/session/SessionManager.ts` (around line 1065)
- Test: `src/session/SessionManager.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/session/SessionManager.test.ts`:

```typescript
describe("sendPromptAsync - MCP tool filtering", () => {
  it("applies getFilteredTools when mcpServerManager is available", () => {
    // Find sendPromptAsync section
    const sendPromptAsyncStart = source.indexOf("async sendPromptAsync(");
    const nextMethodStart = Math.max(
      source.indexOf("private ", sendPromptAsyncStart + 1),
      source.indexOf("  dispose():", sendPromptAsyncStart + 1),
      source.length
    );
    const sendPromptAsyncSection = source.substring(
      sendPromptAsyncStart,
      nextMethodStart
    );
    
    assert.ok(
      sendPromptAsyncSection.includes("getFilteredTools"),
      "sendPromptAsync must call getFilteredTools when mcpServerManager exists"
    );
  });

  it("uses same filtering logic as sendPrompt", () => {
    // Both should extract modelRef the same way
    const sendPromptSection = source.substring(
      source.indexOf("async sendPrompt("),
      source.indexOf("async sendPromptAsync(")
    );
    const sendPromptAsyncStart = source.indexOf("async sendPromptAsync(");
    const nextMethodStart = Math.max(
      source.indexOf("private ", sendPromptAsyncStart + 1),
      source.indexOf("  dispose():", sendPromptAsyncStart + 1),
      source.length
    );
    const sendPromptAsyncSection = source.substring(
      sendPromptAsyncStart,
      nextMethodStart
    );
    
    // Both should check for mcpServerManager && modelRef
    assert.ok(
      sendPromptSection.includes("this.mcpServerManager && modelRef"),
      "sendPrompt must check mcpServerManager && modelRef"
    );
    assert.ok(
      sendPromptAsyncSection.includes("this.mcpServerManager && modelRef"),
      "sendPromptAsync must check mcpServerManager && modelRef"
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/session/SessionManager.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Modify `sendPromptAsync()` in `src/session/SessionManager.ts`:

```typescript
async sendPromptAsync(
    sessionId: string,
    parts: (TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput)[],
    options?: PromptOptions
  ): Promise<void> {
    if (this.disposed) throw new Error("SessionManager has been disposed")
    if (!this.client) throw new Error("Server not running")

    const modelRef = options?.model ?? this.currentModel ?? undefined
    const variant = options?.variant
    const idempotencyKey = `${sessionId}-${randomUUID()}`
    
    // Apply MCP tool filtering based on model
    let tools = options?.tools
    if (this.mcpServerManager && modelRef) {
      tools = this.mcpServerManager.getFilteredTools(
        modelRef.providerID,
        modelRef.modelID,
        tools ?? {},
      )
    }
    
    log.info(`Sending async prompt to session ${sessionId} (idempotency: ${idempotencyKey.slice(0, 16)}..., model=${modelRef ? `${modelRef.providerID}/${modelRef.modelID}` : "default"}, variant=${variant ?? "none"}, tools=${JSON.stringify(tools ?? {})}, eventStream=${this.eventStreamState}, lastRaw=${this.lastRawEventType || "none"})`)

    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const resp = await this.client.session.promptAsync({
          path: { id: sessionId },
          body: {
            parts,
            ...(modelRef ? { model: modelRef } : {}),
            ...(variant ? { variant } : {}),
            ...(tools ? { tools } : {}),
          },
          headers: {
            "Idempotency-Key": idempotencyKey,
          },
        })

        // ... rest of method
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/session/SessionManager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/session/SessionManager.ts src/session/SessionManager.test.ts
git commit -m "feat: apply MCP tool filtering in sendPromptAsync()"
```

---

## Task 4: Wire up McpServerManager in extension.ts

**Files:**
- Modify: `src/extension.ts`
- Test: `src/extension.test.ts`

**First, find where SessionManager is instantiated in extension.ts**

- [ ] **Step 1: Write the failing test**

Add to `src/extension.test.ts`:

```typescript
describe("Extension - MCP wiring", () => {
  it("passes McpServerManager to SessionManager", () => {
    const source = readFileSync(path.join(__dirname, "extension.ts"), "utf8");
    
    // Check that SessionManager is created with mcpServerManager
    assert.ok(
      source.includes("new SessionManager") && source.includes("mcpServerManager"),
      "SessionManager must be instantiated with mcpServerManager"
    );
    
    // Check that McpServerManager is created first
    const mcpManagerCreate = source.indexOf("new McpServerManager");
    const sessionManagerCreate = source.indexOf("new SessionManager");
    
    assert.ok(
      mcpManagerCreate >= 0 && sessionManagerCreate >= 0,
      "both McpServerManager and SessionManager must be instantiated"
    );
    assert.ok(
      mcpManagerCreate < sessionManagerCreate,
      "McpServerManager must be created before SessionManager"
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/extension.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

First, read the current extension.ts to understand the structure, then:

1. Ensure `McpServerManager` is imported:
```typescript
import { McpServerManager } from "./mcp/McpServerManager"
```

2. Find where `SessionManager` is instantiated and update:
```typescript
// Create McpServerManager first
const mcpServerManager = new McpServerManager(context)

// Pass to SessionManager
const sessionManager = new SessionManager(context, mcpServerManager)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/extension.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/extension.ts src/extension.test.ts
git commit -m "feat: wire up McpServerManager in extension.ts"
```

---

## Task 5: Add comprehensive unit tests for McpServerManager

**Files:**
- Test: `src/mcp/McpServerManager.test.ts`
- Code: `src/mcp/McpServerManager.ts` (already exists)

**Note:** Since `McpServerManager` depends on VSCode APIs and file system, we'll test the pure logic functions that are already extracted.

- [ ] **Step 1: Write the failing tests**

Replace content of `src/mcp/McpServerManager.test.ts`:

```typescript
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import vm from "node:vm"

const source = readFileSync(path.join(__dirname, "McpServerManager.ts"), "utf8")

describe("McpServerManager.ts", () => {
  it("loads MCP servers from OpenCode config paths", () => {
    assert.ok(source.includes("OPENCODE_CONFIG"), "must respect OPENCODE_CONFIG")
    assert.ok(source.includes(".config"), "must read the default XDG config location")
    assert.ok(source.includes("opencode.json"), "must use OpenCode config files")
    assert.ok(source.includes("config.mcp"), "must read the OpenCode mcp object")
  })

  it("falls back to the legacy VS Code mcpServers setting", () => {
    assert.ok(source.includes("getLegacyVsCodeServers"), "must keep legacy setting fallback")
    assert.ok(source.includes("opencode.mcpServers"), "must know the legacy setting key")
  })
})

describe("patternsToRegex - pattern matching", () => {
  it("converts glob patterns to regex correctly", () => {
    // Extract and test the patternsToRegex function
    // We can test by checking the implementation details in source
    
    // Should escape special regex chars first
    assert.ok(
      source.includes(".replace(/[.*+?^${}()|[\\]\\\\]/g"),
      "must escape regex special characters"
    )
    
    // Should convert * to .*
    assert.ok(
      source.includes(".replace(/\\\\\\*/g, \".*\""),
      "must convert * to .* after escaping"
    )
    
    // Should convert ? to .
    assert.ok(
      source.includes(".replace(/\\\\\\?/g, \".\""),
      "must convert ? to . after escaping"
    )
  })
})

describe("isEnabledForModel - condition evaluation", () => {
  it("returns true when no when condition exists", () => {
    // Find isEnabledForModel function
    const fnStart = source.indexOf("function isEnabledForModel");
    const fnSection = source.substring(fnStart, fnStart + 500);
    
    assert.ok(
      fnSection.includes("if (!condition) return true"),
      "isEnabledForModel must return true when no condition"
    )
  })

  it("checks provider match when provider is specified", () => {
    const fnStart = source.indexOf("function isEnabledForModel");
    const fnSection = source.substring(fnStart, fnStart + 500);
    
    assert.ok(
      fnSection.includes("condition.provider && condition.provider.length > 0"),
      "must check if provider condition exists"
    )
    assert.ok(
      fnSection.includes("condition.provider.includes(modelProviderID)"),
      "must check if providerID is in condition.provider"
    )
  })

  it("checks model pattern match when model is specified", () => {
    const fnStart = source.indexOf("function isEnabledForModel");
    const fnSection = source.substring(fnStart, fnStart + 500);
    
    assert.ok(
      fnSection.includes("condition.model && condition.model.length > 0"),
      "must check if model condition exists"
    )
    assert.ok(
      fnSection.includes("matchesPatterns(modelID, condition.model)"),
      "must call matchesPatterns for model patterns"
    )
  })
})

describe("getFilteredTools - tool filtering", () => {
  it("disables tools from servers that don't match when condition", () => {
    const fnStart = source.indexOf("getFilteredTools(");
    const fnSection = source.substring(fnStart, fnStart + 600);
    
    assert.ok(
      fnSection.includes("disabledServers"),
      "must track disabled servers"
    )
    assert.ok(
      fnSection.includes("!this.isServerEnabledForModel"),
      "must check isServerEnabledForModel for each server"
    )
  })

  it("uses sanitized server name as tool prefix", () => {
    const fnStart = source.indexOf("getFilteredTools(");
    const fnSection = source.substring(fnStart, fnStart + 600);
    
    // MCP tools are typically prefixed with "serverName_" where special chars become "_"
    assert.ok(
      fnSection.includes("serverName.replace(/[^a-zA-Z0-9_-]/g, \"_\")"),
      "must sanitize server name for tool prefix matching"
    )
    assert.ok(
      fnSection.includes("toolName.startsWith(prefix)"),
      "must check if tool name starts with server prefix"
    )
  })
})

describe("isServerEnabledForModel - public API", () => {
  it("exposes public method for checking server enablement", () => {
    assert.ok(
      source.includes("isServerEnabledForModel(") && 
      source.includes("serverName: string"),
      "must have public isServerEnabledForModel method"
    )
  })
})

describe("getServersForModel - UI support", () => {
  it("returns servers with enabledForModel flag", () => {
    assert.ok(
      source.includes("getServersForModel("),
      "must have getServersForModel method"
    )
    assert.ok(
      source.includes("enabledForModel: this.isServerEnabledForModel"),
      "must include enabledForModel flag in result"
    )
  })
})
```

- [ ] **Step 2: Run test to verify it works with existing code**

Run: `npm test -- src/mcp/McpServerManager.test.ts`
Expected: PASS (these tests verify existing code structure)

- [ ] **Step 3: Verify implementation is complete**

Check that all methods are properly implemented by running all tests:

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/mcp/McpServerManager.test.ts
git commit -m "test: add comprehensive tests for McpServerManager"
```

---

## Task 6: Run full test suite and typecheck

**Files:**
- All files

- [ ] **Step 1: Run typecheck**

Run: `npm run typecheck`
Expected: No TypeScript errors

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: No lint errors

- [ ] **Step 4: Commit verification**

```bash
git status
```
Verify all changes are committed.

---

## Integration Verification

### Example Configuration

Users can now configure MCP servers with `when` conditions in their `opencode.json`:

```json
{
  "mcp": {
    "clipboard-vision": {
      "type": "local",
      "command": ["npx", "clipboard-vision-mcp"],
      "when": {
        "provider": ["anthropic", "openai"],
        "model": ["*vision*", "gpt-4o*"]
      }
    },
    "web-search": {
      "type": "local",
      "command": ["uvx", "web-search-mcp"],
      "when": {
        "provider": ["minimax", "openrouter"]
      }
    }
  }
}
```

### Expected Behavior

1. When using `anthropic/claude-sonnet-4-vision`:
   - `clipboard-vision` tools are ENABLED (matches both provider "anthropic" and pattern "*vision*")
   - `web-search` tools are DISABLED (provider "anthropic" not in ["minimax", "openrouter"])

2. When using `minimax/m2.5`:
   - `clipboard-vision` tools are DISABLED (provider "minimax" not in ["anthropic", "openai"])
   - `web-search` tools are ENABLED (provider "minimax" matches)

---

## Self-Review

**1. Spec coverage:**
- [x] McpServerWhenCondition interface with provider and model filters
- [x] Pattern matching with glob-style wildcards
- [x] isEnabledForModel evaluation logic
- [x] getFilteredTools for filtering tools map
- [x] Integration with SessionManager.sendPrompt() and sendPromptAsync()
- [x] Wiring in extension.ts

**2. Placeholder scan:**
- No TODOs or placeholders in the plan

**3. Type consistency:**
- All type names match existing codebase patterns
- Method signatures are consistent with existing code

**Plan complete. Ready for execution.**
