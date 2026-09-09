# ADR: OpenCode runtime selection and coexistence

- Date: 2026-09-08
- Status: Accepted for the compatibility checkpoint
- Scope: local and remote connections managed by SessionManager

## Context

The stable opencode executable and the preview opencode2 executable have
different health, session, prompt, and event contracts. The SDK import path is
not sufficient evidence of runtime identity. OpenCode 2 can also share default
configuration/data roots with the stable runtime. Concurrently mutating those
roots can migrate a database and make the other runtime fail, as documented by
[upstream issue #42260](https://github.com/anomalyco/opencode/issues/42260).

The extension already has one session/event orchestration graph. Giving each
runtime a second partially independent graph would multiply stale callbacks,
SSE subscriptions, caches, and prompt-retry risks.

## Decision

1. Keep a shared semantic client surface with runtime-specific transport and
   response adapters at the session boundary.
2. Identify a server by verified health route, version, API surface, runtime,
   and connection generation. Unknown or malformed responses remain unknown.
3. Add opencode.runtime = auto | opencode | opencode2. auto checks OpenCode 2
   first; explicit choices are strict.
4. Allow both executables to be installed, but maintain one active runtime per
   extension connection. Switching is serialized, allowed only when no tab is
   streaming/waiting, and reconnects the client/event subscription before
   rehydrating sessions.
5. Preserve drafts and queued prompts during switching. Never replay a prompt
   whose server admission is uncertain onto a different runtime.
6. Do not silently invent XDG data/config isolation. Users who need true
   simultaneous external use must configure isolated roots themselves.

## Alternatives rejected

### Two active runtimes in one panel

Rejected. It would require namespacing every session, event, stream, model,
permission, question, usage, and reconnect callback, while the upstream
default database may still be shared. A future design could add explicit
multi-connection workspaces after a verified isolation contract exists.

### Automatically create per-runtime data directories

Rejected for now. The extension cannot safely infer the user's existing
OpenCode data ownership across local, Remote SSH, WSL, containers, and shared
services. Silent relocation could hide history or cause users to mutate a
different project database than intended.

### Treat every /api/health response as OpenCode 2 support

Rejected. Health identifies a route/runtime candidate, not the complete feature
contract. The compatibility probe validates response shape and session access;
individual unsupported operations remain explicit.

## Consequences

- Users can keep both binaries installed and choose the runtime from Settings
  or the chat header.
- Switching is understandable and recoverable, but it is not live migration;
  active server work must settle first and histories are rehydrated per server.
- OpenCode 2 gets useful core chat/session support while unsupported preview
  operations fail clearly.
- Simultaneous use is supported only when the user independently isolates the
  runtimes' data/config/state/cache roots; the extension does not claim to
  manage that isolation.

## Revisit when

Reconsider multi-connection support after OpenCode documents stable runtime
profiles/data ownership, session migration semantics, and event/replay
guarantees, and after the extension has a connection-scoped state container.
