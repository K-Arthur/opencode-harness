# ADR: Checkpoint, Diff, and Changed-File Tracking Repair

**Date:** 2026-05-17
**Status:** Accepted

## Context

The extension previously described checkpoints as git worktree or stash snapshots. That is unsafe for a VS Code command because branch or stash mutation can surprise the user, disrupt unrelated work, and behave poorly in multi-root or dirty workspaces.

Changed-file tracking also had two competing paths: live `file_edited` events updated parts of the webview, while backend persistence and the todos-panel changed-file view could drift. Diff previews and revert flows likewise needed to align with VS Code extension capabilities.

## Decision

- Extension-managed diff accepts create local file snapshots for explicit file paths before applying the edit.
- Snapshots are stored in extension storage and restored with VS Code `workspace.fs` plus `WorkspaceEdit`; restore must not call git checkout, stash, or branch commands.
- Server-managed OpenCode tool edits are reverted through the native OpenCode SDK `session.revert(messageID)` flow.
- Diff previews use a read-only virtual document provider and the `vscode.diff` command.
- Diff applies use `WorkspaceEdit`, and accepted diff metadata is retained so `revert_diff` can restore the correct edit.
- Backend `SessionStore.addChangedFiles(sessionId, files)` is the canonical changed-file registration API.
- The host posts `changed_files_update` as canonical frontend state and keeps `file_edited` only as a live incremental compatibility event.
- File opening is resolved in the extension host against the session workspace first, then VS Code workspace folders, with `#L12` support and clear errors for missing or out-of-workspace files.

## Public Contracts

- `changed_files_update`: `{ type, sessionId, files: Array<{ path: string; added: number; removed: number }> }`
- `file_edited`: `{ type, sessionId, file }`
- `checkpoint_list`: checkpoint objects include `id`, `sessionId`, `messageId`, `createdAt`, `filesChanged`, and optional `action`
- `checkpoint_restored`: `{ type, sessionId, checkpointId, ok, error? }`
- `diff_result`: `{ type, sessionId, blockId, ok, message?, checkpointCreated? }`

## Consequences

- The extension no longer depends on `simple-git` for checkpoint rollback.
- Extension checkpoints are intentionally scoped: they cover files the extension itself is about to edit through diff acceptance.
- Full rollback of OpenCode server-side tool edits remains delegated to OpenCode's server-side session history.
- The changed-files chip bar, todos panel, and Open buttons now share one backend/frontend contract.

