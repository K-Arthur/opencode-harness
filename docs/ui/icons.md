# Icons

The extension uses an inline-SVG icon system — no Codicon font, no emoji.
All icons follow the same 1.5px stroke, rounded caps/joins style
(Phosphor/Tabler-inspired). Source: `src/chat/webview/icons.ts`.

## Per-tool-name resolver

`toolIconFor(toolName, toolClass)` looks up a per-name SVG, then falls
back to the four-class system (read/write/exec/meta) for everything else.

| Tool name(s)                       | Class fallback | Used by                                    |
|------------------------------------|----------------|--------------------------------------------|
| `grep`                             | read           | content search inside files                |
| `glob`, `list`                     | read           | filesystem enumeration                     |
| `ls`                               | read           | alias for read                             |
| `task`                             | meta           | subagent dispatch                          |
| `todowrite`, `todo_write`          | write          | plan/task list authoring                    |
| `websearch`, `web_search`          | read           | search the web                             |
| `webfetch`, `web_fetch`            | read           | fetch + extract a URL                      |
| `plan`                             | write          | plan authoring                             |
| `question`                         | meta           | interactive Q&A                            |
| `skill`                            | meta           | skill invocation                           |
| `lsp`                              | read           | LSP symbol lookup                          |
| `git_commit`, `git_diff`, `git_log`, `git_status` | meta | git operations                  |
| `memory`                           | read           | persistent memory                          |
| `checkpoint`                       | meta           | checkpoint save/restore                    |
| `edit`                             | write          | targeted file edit                         |
| _anything else_                    | read/write/exec/meta | uses the four-class switch         |

Names are case-insensitive and non-alphanumeric characters are normalized
to underscore (so `web-search` matches `websearch`).

## State overlays

`toolStateOverlayFor(state)` returns a small SVG that overlays the tool
icon for the current state. Used by `appendToolStatusBadge()` in
`toolCallRenderer.ts`.

| State        | Visual                         |
|--------------|--------------------------------|
| `pending`    | clock outline                  |
| `running`    | animated spinner               |
| `completed` / `succeeded` | filled check-circle |
| `failed` / `error`        | filled alert       |
| `cancelled`  | X in circle                    |
| `timed_out` / `timeout`   | clock with strikethrough |

## Activity-kind icons

`KIND_ICON` in `activity-panel.ts` maps `ActivityKind` to SVG:

| Kind         | Icon (was)        | Icon (now)                |
|--------------|-------------------|---------------------------|
| message      | 💬                | speech-bubble outline     |
| thinking     | 💭                | brain lobes               |
| plan         | 📋                | checkbox list             |
| tool         | 🔧                | terminal/wrench           |
| command      | ⌘                 | angle-bracket chevron     |
| file-read    | 📖                | open book                 |
| file-edit    | ✎                 | pencil-on-doc             |
| approval     | ❓                | speech-question           |
| checkpoint   | 🏁                | flag                      |
| error        | ⚠                 | warning triangle          |
| completion   | ✓                 | filled check-circle       |

The chip renders `<span class="activity-item-icon">[SVG]</span>` and
sets `aria-hidden="true"` so the screen reader reads the activity
label, not the icon.

## Subagent domain icons

`DOMAIN_ICONS` in `subagent-panel.ts` maps domain to SVG:

| Domain    | Icon (was)    | Icon (now)                |
|-----------|---------------|---------------------------|
| frontend  | 🎨            | window/sidebar layout     |
| backend   | ⚙️            | server rack               |
| database  | 🗄️            | cylinder stack            |
| api       | 🔌            | plug/connect              |
| shared    | 📦            | cube outline              |

The domain badge renders as two spans:
`<span class="subagent-domain-icon">[SVG aria-hidden]</span><span class="subagent-domain-label">name</span>`.

## Tasks panel status icons

`STATUS_ICON` in `tasks-panel.ts` uses Unicode geometric glyphs (not
emoji — they render the same in any font without color-emoji fallback):

| Status     | Glyph |
|------------|-------|
| pending    | ○     |
| running    | ▷     |
| succeeded  | ✓     |
| failed     | ✗     |
| cancelled  | ⊘     |
| unknown    | •     |

These are stable across terminals and font stacks; switching to SVG
would add bundle size for no readability gain.

## Adding a new icon

1. Append a new `SVG(`…`)` to `icons.ts` with the standard 1.5px stroke
   style.
2. If the icon is per-tool-name, add the entry to `TOOL_NAME_ICONS`.
3. Run `npx tsx --test src/chat/webview/icons.test.ts` to verify the
   structural test still passes (it checks all known exports).
4. If the icon replaces a literal character (emoji, ASCII), update
   the corresponding test that grep'd for the old character.

## Why no emoji

- Emoji render with the system color-emoji font, which violates
  theme tokens (`--color-muted`, `--color-success`, etc.) and renders
  inconsistently across light/dark/HC themes.
- Some emoji (e.g. 🏁) are vendor-specific glyphs that don't render
  in headless test environments.
- Unicode geometric glyphs (○▷✓✗⊘) render in any monospace font
  without font fallback; SVG is the next step up.
