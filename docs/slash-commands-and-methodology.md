# Slash Commands, Skills, and Methodology Guidance

Updated: 2026-06-11. Companion plan: `.opencode/plans/2026-06-11-methodology-skills-slash-overhaul.md`.

## Slash commands

### Where commands come from

| Source | Defined in | Executed by |
|---|---|---|
| Local (built-in) | `src/chat/webview/slash-commands.ts` (`LOCAL_SLASH_COMMANDS`) | Webview dispatcher (`slashCommands.ts`) and/or host (`ChatCommands.ts` via `CommandExecutionService`) |
| Server / MCP / skill | opencode server (`SessionManager.listCommands()`) | Server via `sendCommand` |
| Custom prompts | `.opencode/prompts/*.md` (`PromptManager`) | Resolved to a normal prompt and sent |

`LOCAL_SLASH_COMMANDS` is the single source of truth for local commands. Every
surface derives from it:

- the inline `/` mention dropdown (`toMentionItems()`),
- the commands palette modal (`toCommandEntries()`),
- the `/help` table (`buildHelpTable()` — generated, cannot drift),
- collision filtering of server commands (`dedupServerCommands()`, alias-aware).

To add a local command: add a registry entry (name, description, category,
optional `usage` and `aliases`), add a `case` in
`runSlashCommandText()` (webview-handled) or `handleLocalSlashCommand()`
(host-handled), and a registry test will hold you to declaring usage hints for
argument-taking commands. Commands not in the registry are invisible to users.

### Input routing

`classifyComposerInput(text, isStreaming)` in `slash-commands.ts` is the single
decision point for what happens on send:

| Input | Idle | Streaming |
|---|---|---|
| plain text | normal prompt | steering prompt |
| `/command…` | slash dispatcher | **blocked with an error** (input preserved) |
| empty | no-op | abort stream |

Slash commands are intentionally blocked during streaming: before this guard,
`/clear` typed mid-stream was sent to the model as literal steering text.
A prompt that genuinely starts with a slash can be steered with `/ ` (slash,
space).

### Command reference

Run `/help` for the generated table. Highlights:

- `/methodology [on|off]` — show or toggle automatic methodology guidance for
  the current tab.
- `/export` (alias `/export-md`), `/export-json`, `/export-text`, `/copy`.
- `/diagnose:generation` — dump generation-tracking state to the output
  channel (debug).
- Everything else (server, MCP, skill, custom-prompt commands): browse with
  `/commands` or Ctrl+Shift+/.

## Methodology guidance

When `opencode.methodology.enabled` is on (default), each outgoing prompt is
classified (`TaskClassifier`) and matched to a methodology
(`MethodologyCatalog`). A short addendum (≈1–3 lines, prefixed
`[methodology]`) is attached ahead of the prompt text; the renderer hides it
from the transcript.

Visibility and override:

- The **status strip chip** (`◆ <label>`) shows the selection for the active
  session; its tooltip shows strategy, task type, and the override hint.
- The **VS Code status bar** lightbulb renders the *same* advice that was
  injected (it previously ran an independent second classification, which
  could disagree).
- `/methodology` reports state; `/methodology off` / `on` toggles the per-tab
  opt-out (`TabState.methodologyDisabled`).
- Trivial prompts (< 12 chars), slash commands, and steering are never
  decorated.

The host posts `methodology_selected`
`{sessionId, label, methodology, strategy, confidence, taskType, auto}` to the
webview on every applied advice.

## Skills

Skill discovery and loading is owned by the opencode server (plus a local
`~/.agents/skills` scan). The extension:

- lists skills in the skills modal (`get_skills` → `skills_list`),
- suggests relevant skills to the model by name in the methodology addendum
  (`SkillTriggerEngine` → "Relevant skills: …"),
- exposes server-registered skill commands in the commands palette
  (tagged `skill`).

The modal toggle controls **suggestion only** — the opencode server does not
accept enable/disable, so a disabled skill may still be loaded server-side.
The modal states this; do not present the toggle as a hard disable.

## Known limitations / next steps

Tracked in the plan document (deferred section): deleting the quarantined
cascade pipeline under `src/methodology/`, wiring `OutcomeTracker.record()`
from stream outcomes, forcing a specific methodology id, merging the duplicate
TaskClassifiers, a `destructive: true` registry flag with confirmation for
`/clear`, and generating VS Code palette contributions from the registry.
