# ADR-004: Transactional Code Changes via Diff Review

**Status:** Accepted

## Context

AI agents can generate code changes that users need to review before applying. We need a safe mechanism to present changes and apply them only after user approval.

## Decision

We will use **Transactional Writes** for all code changes:
- Agent generates code changes as **diffs** (not direct file writes)
- `DiffHandler` tracks and presents diffs in the webview UI
- User reviews diff → clicks "Apply" or "Reject"
- Apply uses **VS Code's undoable edit API** (`workspace.applyEdit`)
- Changes are never applied directly without user review

## Alternatives Considered

1. **Direct file writes by agent**: Rejected because users lose review capability and can't undo easily.

2. **Apply with undo-only (no review)**: Rejected because users need to see WHAT will change before it happens.

3. **Auto-apply with notification**: Rejected because agent changes can be destructive; explicit consent is required.

## Consequences

**Positive:**
- Users maintain full control over code changes
- VS Code's undo stack allows easy revert
- Diff review UI provides clear visibility into changes
- Transactional semantics: all-or-nothing apply

**Negative:**
- Additional UI complexity (diff presentation, accept/reject buttons)
- `DiffHandler` must parse and track diffs per message
- Two-step process (generate → review → apply) is slower than direct writes

**Mitigations:**
- `DiffHandler` integrates with webview for seamless diff presentation
- "Accept Diff" and "Reject Diff" messages routed via `MessageRouter`
- Progress indicators during diff apply (VS Code progress API)

## Flow

```
Agent generates code → DiffHandler creates diff → Webview shows diff
     ↓
User clicks "Apply" → MessageRouter routes to DiffHandler → workspace.applyEdit()
     ↓
VS Code applies changes → Changes appear in files → User can undo via Ctrl+Z
```

## References

- Architecture Spec Section 1.2: Design Principles (Transactional writes)
- `DiffHandler.ts`: Diff tracking and presentation
- VS Code API: `workspace.applyEdit()`
