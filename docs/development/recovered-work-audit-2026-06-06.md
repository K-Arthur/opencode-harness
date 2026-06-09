# Recovered Work Audit - 2026-06-06

This note records the June 6 recovery pass after several UI and agent-workflow
changes appeared to be missing from the running extension.

## What Was Checked

- Recent commits on `master`, especially the 0.3.2/0.3.3 UI recovery commits.
- Recent stashes from June 6:
  - `stash@{0}` from `505f6cf`
  - `stash@{1}` from `bdc8f16`
  - `stash@{2}` from `4e4bc80`
- The installed VS Code extension directory under
  `~/.vscode/extensions/kevinoarthur.opencode-harness-*`.
- The workspace debug config in `.vscode/launch.json`.
- Voice/STT source, subagent source, shortcut source, and status-strip context
  usage source.

## Findings

- The log path `/home/.../opencode-harness/dist/extension.js` means the window was
  using the workspace Extension Development Host, not the installed VSIX.
- Voice/STT source and docs were present. The message "No local speech-to-text
  engine found" means no local transcriber binary/config was available at
  runtime, not that the voice UI was lost.
- The topbar reduction was present in a June 6 stash but not fully reflected in
  current `index.html`.
- The subagent panel UI existed, but the live run-activity bridge and the
  `oc:open-subagent-panel` listener were missing.
- Shortcut help listed `Ctrl+Shift+Alt+A`, but the key handler did not wire it.
  The help table also duplicated the `Ctrl/Cmd+F` row.
- The context usage element defaulted to the wide status-strip progress bar
  instead of the existing minimal mode.

## Restored

- Secondary topbar controls moved back into Settings overflow.
- Status-strip context usage defaults to minimal mode so it does not appear as a
  second usage/quota progress bar.
- Subagent toggle, badge, panel open/listener path, per-session state merge, and
  live `run_activity_update` handling restored.
- `StreamCoordinator` now starts and publishes `RunActivityTracker` snapshots,
  including bridged `task` tool subagent activity.
- `Ctrl/Cmd+Shift+Alt+A` toggles the subagent panel and shortcut help matches it.
- Activation logs now include extension id, version, mode, path, and main entry.

See [rebuild-and-reinstall.md](./rebuild-and-reinstall.md) for the dev-host vs
installed-VSIX distinction and the required reinstall/reload workflow.
