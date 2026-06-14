# Slash Commands, Skills, and Methodology Guidance

Updated: 2026-06-13. Companion plan: `.opencode/plans/2026-06-11-methodology-skills-slash-overhaul.md`.

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

### MCP namespace resolution (`/server:tool` and `/server tool`)

Users naturally type the namespace they see in the UI, but the opencode server
registers every command (MCP tool, skill, built-in) as a flat top-level name.
The slash dispatcher detects two namespace patterns and rewrites them before
forwarding:

**Colon syntax** (`/prefix:command`):

- `/jcodemunch:triage` → executes `/triage`
- `/jcodemunch:triage my-issue` → executes `/triage` with args `my-issue`
- `/wrongprefix:triage` → executes `/triage` (broad match on suffix)

**Space syntax** (`/server tool`):

- `/jcodemunch triage` → executes `/triage`
- `/jcodemunch triage my-issue` → executes `/triage` with args `my-issue`

The colon case uses a two-tier match: first an exact MCP origin+tool match,
then a broad match where the suffix matches any remote command name (skill,
server, or MCP) — the prefix is discarded because the server ignores it. The
space case requires the prefix to be a known MCP `origin` (to avoid ambiguity
with commands like `/cost` that take arguments).

If neither pattern matches, the command is forwarded as-is so the server can
still attempt it. If a command is also not in the cached server list, a
**non-blocking tip** is shown pointing to `/commands`.

Implementation: `resolveMcpNamespace()` in `slash-commands.ts` (pure, tested).
The cached remote command list is populated from `command_list` messages and
passed to the handler via `getServerCommands()` in `SlashCommandDeps`.

### Command list fetch failures

When the opencode server is unreachable, `handleListCommands` falls back to
showing only custom prompts and sets `partial: true` on the `command_list`
message. The webview surfaces a system message so users understand why
server/MCP commands are missing from the palette and inline dropdown.

### Searching commands and skills (fuzzy)

All three search surfaces share one matcher, `fuzzyMatch.ts`
(`fuzzyScore` / `scoreCommandMatch` / `rankByFuzzy`):

- the inline `/` mention dropdown (`mentions.ts`),
- the commands palette modal (`commands-modal.ts`),
- the skills modal's search (`search_skills` in `WebviewEventRouter.ts`).

It matches the **name** by *subsequence* (the query characters appear in
order, not necessarily adjacent) and the **description** by *substring*, then
ranks best-first (exact › contiguous prefix › word-boundary › scattered;
name matches always tier above description-only). This is why typing
`/review` surfaces a custom `/code-review` command and `/cr` surfaces it too.

Before this, the dropdown filtered with `startsWith` and the palette/skills
search with `includes`, so any command whose name didn't *begin* with the
typed characters looked missing — most visible with custom and MCP/skill
commands. The matcher is pure and DOM-free so the extension host (skill
search) and the webview share it without duplication. Descriptions are kept
to substring matching on purpose: a 2-char query is a subsequence of almost
any sentence, which would flood the palette.

The inline `/` dropdown also shows a per-command **origin badge**
(`Built-in` / `Server` / `MCP` / `Skill` / `Custom`, with a per-source icon)
so you can tell command sources apart without opening the palette
(`MentionItem.badge`, derived in `updateServerCommands`). It caps at
`MAX_COMMAND_RESULTS` (50) fuzzy-ranked rows and appends a non-interactive
`.dropdown-more` "+N more" hint — kept off `.dropdown-item` so keyboard
navigation never lands on it.

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
  (tagged `skill`),
- fuzzy-searches the skills modal via `search_skills` (shared `fuzzyMatch.ts`;
  see "Searching commands and skills" above).

The modal toggle controls **suggestion only** — the opencode server does not
accept enable/disable, so a disabled skill may still be loaded server-side.
The modal states this; do not present the toggle as a hard disable.

Server agents and local skills are deduplicated by a composite key
(`server:<name>` vs `local:<id>`), so a local skill with the same display name
as a server agent is **not** silently dropped — both appear in the modal with
independent toggle state.

## Known limitations / next steps

Tracked in the plan document (deferred section): deleting the quarantined
cascade pipeline under `src/methodology/`, wiring `OutcomeTracker.record()`
from stream outcomes, forcing a specific methodology id, merging the duplicate
TaskClassifiers, a `destructive: true` registry flag with confirmation for
`/clear`, and generating VS Code palette contributions from the registry.
