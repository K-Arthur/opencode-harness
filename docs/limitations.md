# Limitations, SDK Constraints, and Beta Status

> **This extension is an independent, unofficial, beta project.** It is **not
> developed by, affiliated with, or endorsed by the OpenCode team.** It is a
> community-built VS Code client for the [opencode](https://opencode.ai) CLI
> agent. Features are actively evolving.

This document records the hard constraints that shape what the extension can
and cannot do, verified against `@opencode-ai/sdk` v1.17.7 + the v2 client
(`node_modules/@opencode-ai/sdk/dist/v2/gen/*.d.ts`).

## How the extension relates to opencode

The extension is a **client** over the opencode HTTP server (default
`localhost:4096`) via `@opencode-ai/sdk/v2`. It starts `opencode serve` for
you and talks to it over HTTP + SSE. It does not embed or spawn the CLI for
chat. **It can only do what the SDK and server expose.** When the opencode
server adds a capability, this extension can adopt it; when the SDK is silent
on something, the extension either builds a client-side approximation or does
not offer it.

## SDK capability summary

Almost every feature the extension ships is SDK-backed. The full matrix lives
in `docs/research/2026-06-15-agent-visibility-ux-audit-and-roadmap.md` §3.
Highlights:

- **Session lifecycle** — `create/list/get/delete/update/revert/unrevert` are
  fully supported and used. `fork`/`share`/`unshare` exist on the SDK; `fork`
  is implemented client-side (clone up to a turn), `share`/`unshare` are not
  yet wired.
- **Messages** — `prompt`/`promptAsync`/`messages`/`message`/`deleteMessage`/
  `command`/`shell` are fully supported. There is **no explicit edit or
  regenerate API**; the canonical pattern is `session.revert` + a new prompt.
- **Streaming** — 70+ SSE event types are normalized into the extension's
  ~25 event types. The v2 `session.next.*` fine-grained protocol (tool input
  deltas, `tool.progress`, reasoning deltas, step lifecycle) is available but
  not yet the activity model's source of truth.
- **Diffs** — `session.diff` + `SnapshotFileDiff { file, before, after, patch,
  additions, deletions, status }` are fully supported and consumed. Hunk-level
  staging is computed client-side from `before`/`after`.
- **Terminal** — The SDK exposes a full PTY API (`pty.create/connect/remove/
  get/update` + `pty.{created,updated,exited,deleted}` events) and
  `session.shell()`. The extension uses PTY when the server advertises it and
  falls back to a polling approximation on older servers.
- **Permissions** — `permission.reply` supports `"once" | "always" | "reject"`.
- **MCP** — `mcp.status/add/connect/disconnect` + auth flow are fully wired.
- **Token/cost** — Exposed at session, message, and step granularity
  (input/output/reasoning/cache).

## Hard constraints (things the extension cannot do without SDK/server changes)

### Temperature / effort / reasoning-level

Not exposed as prompt parameters by the SDK. The `session.prompt` body accepts
`parts`, `model`, `agent`, `tools`, `format`, `variant`, `messageID` — no
temperature, effort, or reasoning-level field. These are server-side only and
not adjustable from any client. The extension's reasoning-level handling is
limited to what the model/agent emits in `providerMetadata`.

### Rate-limit headers / quota

Not surfaced in the SDK types. Rate-limit and quota information lives at the
HTTP layer (headers like `retry-after`, `anthropic-ratelimit-*-set`) and is
not exposed through the typed SDK client. The extension infers remaining quota
from observed token/cost usage when a provider doesn't expose quota headers,
and surfaces a best-effort quota bar.

### Session modes (Plan / Build / Auto)

Server-determined. The client requests a mode, but the server enforces the
policy (e.g. Plan mode blocks mutating actions except direct writes to
`.opencode/plans/*.md`). The extension cannot override server-side mode
policy.

### Message edit / regenerate

No dedicated SDK API. The extension implements:
- **Regenerate response** — `session.revert` to the last user message, then
  re-send the prompt.
- **Branch conversation** — `session.fork({ sessionID, messageID })` (server-
  side fork at a message) where available; client-side clone as a fallback.
- **Edit previous prompt** — `session.revert` to the user message, then send
  the edited text.

These are "rewind + resend" semantics, not in-place mutation.

### Live terminal stdout structure

The SDK's `session.next.shell.ended` event returns `output` as a single
string, not a structured `{ stdout, stderr, exitCode }` triple. The PTY
WebSocket stream carries raw bytes (stdout); stderr is not separately
demarcated. The extension renders combined output with ANSI handling.

## Soft constraints (extension-side choices, not SDK limits)

- **Bundle size** — The webview `main.js` is ~743 KB (CI limit 780 KB). Some
  features are lazy-loaded or ride consolidation to stay within budget. The
  paydown target is 600 KB.
- **Concurrent streams** — Default cap 5 (`opencode.sessions.maxConcurrentStreams`,
  configurable 1-10). Going over warns and names the busy tabs.
- **Offline session history** — When the opencode server isn't running,
  session history is read directly from its SQLite database via a Python3
  subprocess (no native SQLite binding). This is a fallback; the server is the
  source of truth when available.

## Beta status

This extension is **beta**. Specifically:

- **Features are actively evolving.** New capabilities are added as the
  opencode SDK/server exposes them; existing features may change.
- **Experimental features** (e.g. PTY live terminal, snapshot/restore
  timeline, v2 `session.next.*` activity model) may change or be withdrawn.
- **Bug reports and feedback** are welcome via
  [GitHub Issues](https://github.com/K-Arthur/opencode-harness/issues).

## Future roadmap

Prioritized gaps (full detail in the implementation plan):
1. Wire SDK `session.fork` (replace client-side clone) and `session.share`/
   `unshare`.
2. Cline-style snapshot/restore timeline via `session.revert{snapshot}`.
3. In-webview side-by-side diff (from `FileDiff.before/after`).
4. Unified "Agent Activity" side region (IA consolidation).
5. Re-point the activity model at the v2 `session.next.*` protocol.
6. Conversation editing UX (regenerate / branch / edit-previous-prompt).

## References

- SDK types: `node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts`
- SDK client: `node_modules/@opencode-ai/sdk/dist/v2/gen/sdk.gen.d.ts`
- Capability matrix: `docs/research/2026-06-15-agent-visibility-ux-audit-and-roadmap.md` §3
- v1→v2 migration ADR: `docs/adrs/2026-06-15-v1-to-v2-sdk-migration.md`
- Architecture: `docs/TechSpec.md`
