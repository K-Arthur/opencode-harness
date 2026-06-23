# ADR: File Status Classification and Deleted-File Diff Handling

**Date:** 2026-06-23
**Status:** Accepted

## Context

The changed-files UI displayed every file as "Modified" (M) regardless of whether the
file was actually added, deleted, or modified. The root cause: the OpenCode SDK's
`file.edited` and `session.diff` events carry file paths and line stats (`added`/
`removed` counts) but NOT the git status letter. The `FileChange` interface already
had an optional `status` field (`"A" | "M" | "D"`), but the host never populated it —
`_inferStatus()` in `changed-files-dropdown.ts` always fell back to `"M"`.

Additionally:

- **Deleted files** caused silent failures in the diff inspector. When a file was
  deleted, `sessionManager.getFileContent()` (SDK) threw, and `get_file_diff`
  responded with an error — the user saw nothing instead of the removed content.
- **CSS typo**: `cf-hunk-line--added`/`--removed` classes referenced
  `--vscode-diffEditor.insertedTextBackground` (with a dot) instead of
  `--vscode-diffEditor-insertedTextBackground` (with a hyphen). The VS Code CSS
  variable namespace uses hyphens, so the dot variant never resolved — the fallback
  custom var was always used.
- **Diff table CSS** used custom `--diff-added-bg`/`--diff-removed-bg` variables
  exclusively, not VS Code's `--vscode-diffEditor-*` variables, meaning diff colors
  didn't adapt to the user's active theme (light/dark/high-contrast) automatically.
- **No boundary checks** on diff payload sizes — a very large diff (e.g. a minified
  file rewrite) could freeze the webview during `postMessage` serialization.

## Decision

### File Status Classification

Create `src/chat/diff/fileStatusClassifier.ts` — a pure, injectable module that
classifies files as A/M/D using a layered strategy:

1. **`git status --porcelain -- <path>`** — authoritative XY status codes.
   Batched into a single call for multi-file events via `classifyFileStatuses()`.
2. **Before/after content inference** (fallback when git status is empty or git is
   unavailable):
   - `git show HEAD:path` succeeds + file exists on disk → M (tracked, modified)
   - `git show HEAD:path` succeeds + file does NOT exist → D (tracked, deleted)
   - `git show HEAD:path` fails + file exists → A (untracked, added)
   - `git show HEAD:path` fails + file doesn't exist → null (unknown)

I/O is injected via `ClassifierDeps` (`execSync` + `existsSync`) for exhaustive
unit-testability without spawning real git.

Wire the classifier into `ChatProvider.ts`'s `file_edited` handler: after
`addChangedFiles`, call `classifyFileStatuses(files)` and include the `status` field
in the `changed_files_update` payload. Persist `status` in
`SessionStore.changedFileStats[path].status`.

### Explicit Message Types

Add `workspace_file_added` and `workspace_file_deleted` host→webview message types.
These are emitted alongside `changed_files_update` for added/deleted files. They are
no-op signals today (the aggregate `changed_files_update` already carries `status`),
reserved for future use (e.g. entrance/exit animations).

### Deleted File Diff Handling

In `WebviewEventRouter.ts` `get_file_diff` handler: when `sessionManager.getFileContent()`
throws, check if the file exists in git HEAD via `git show HEAD:path`. If it does,
construct `DiffLine[]` with all lines as `type: "removed"` and respond with
`deleted: true`. The webview renders a "File deleted — all lines removed" banner
above the all-red diff.

### CSS Fixes

1. Fix the dot→hyphen typo in `components.css`:
   `--vscode-diffEditor.insertedTextBackground` → `--vscode-diffEditor-insertedTextBackground`
   (and the removed-text equivalent).
2. Switch `blocks.css` diff line backgrounds to VS Code variables with custom var
   fallback: `var(--vscode-diffEditor-insertedTextBackground, var(--diff-added-bg))`.
3. Add strikethrough + reduced opacity for deleted files:
   `.cf-file-row[data-status="D"] .cf-file-name { text-decoration: line-through; opacity: 0.6; }`
4. Add `data-status` attribute to file rows in the dropdown panel.

### Boundary Checks

Cap `file_diff_response` payload at 5MB. If exceeded, truncate to 500 lines and
respond with `truncated: true`. The webview directs the user to the full VS Code
diff editor for the complete diff.

## Public Contracts

- `changed_files_update`: `{ type, sessionId, files: Array<{ path; added; removed; status?: "A"|"M"|"D"; isPlanDocument? }> }`
- `workspace_file_added`: `{ type, sessionId, path }`
- `workspace_file_deleted`: `{ type, sessionId, path }`
- `file_diff_response`: `{ type, path, sessionId?, lines: DiffLine[], error?, deleted?, truncated? }`
- `SessionStore.changedFileStats[path]`: `{ added: number; removed: number; status?: "A"|"M"|"D" }`

## Consequences

- Added files now show a green "A" badge; deleted files show a red "D" badge with
  strikethrough; modified files show an orange "M" badge — matching VS Code's git
  decoration conventions.
- Deleted files are visible in the diff inspector (all lines shown as removed with
  a banner) instead of failing silently.
- Diff colors adapt to the user's active VS Code theme (light/dark/high-contrast)
  via `--vscode-diffEditor-*` variables, with custom vars as fallback.
- Large diffs no longer risk freezing the webview — they are truncated with a
  clear path to the full diff editor.
- The classifier adds one `git status --porcelain` call per `file_edited` event
  (batched for multi-file events). This is bounded by a 10s timeout and 10MB
  maxBuffer. When git is unavailable, the before/after inference fallback adds
  one `git show HEAD:path` call per file.
- No new runtime dependencies added — the classifier uses only `child_process.execSync`
  and `fs.existsSync`, both already used elsewhere in the extension.
