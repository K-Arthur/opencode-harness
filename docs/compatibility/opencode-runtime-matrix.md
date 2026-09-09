# OpenCode runtime compatibility matrix

Status: implementation checkpoint, 2026-09-08. This document separates the
runtime executable from the client SDK and from the server API surface. It is
deliberately conservative: an adapter test or a successful health request does
not make every feature available.

## Evidence used

- Harness baseline: master at 5cee3a133105d69b21562edd3f60685644a2129e.
- OpenCode 2 protocol snapshot: f3128fa241dc25d486154f8e1b57a046f80a88c7.
- Harness SDK dependency: @opencode-ai/sdk 1.18.10, imported through
  @opencode-ai/sdk/v2.
- Verification date: 2026-09-08, Linux x86_64, Node.js 20+.
- Local runtime versions observed: opencode 1.18.29; opencode2
  v0.0.0-next-17430. Both were launched with isolated temporary storage.
- Protocol references: the [OpenCode 2 health contract](https://github.com/anomalyco/opencode/blob/f3128fa241dc25d486154f8e1b57a046f80a88c7/packages/protocol/src/groups/health.ts), [session contract](https://github.com/anomalyco/opencode/blob/f3128fa241dc25d486154f8e1b57a046f80a88c7/packages/protocol/src/groups/session.ts), and [volatile event contract](https://github.com/anomalyco/opencode/blob/f3128fa241dc25d486154f8e1b57a046f80a88c7/packages/protocol/src/groups/event.ts).

## Matrix

| Area | OpenCode (opencode) | OpenCode 2 preview (opencode2) |
|---|---|---|
| Channel / identity | Stable 1.x runtime; identity is verified from /global/health and the returned version. | Preview/next runtime; identity is verified from /api/health and the returned version/PID. |
| Discovery | PATH, known install directories, or an explicit absolute opencode.binaryPath. | PATH, known install directories, or an explicit absolute opencode.binaryPath; auto detection checks opencode2 first. |
| Install | Official installer on macOS/Linux; opencode-ai on npm or Windows package-manager/manual paths. | @opencode-ai/cli@next exposes the opencode2 binary. The legacy shell installer is not used for an explicit OpenCode 2 install. |
| Authentication | Basic auth with the extension-generated password; legacy environment name is retained. | Basic auth with the extension-generated password; both OPENCODE_PASSWORD and legacy OPENCODE_SERVER_PASSWORD are supplied to support the transition. |
| Sessions | Legacy session API through the existing v2 SDK client. | Session list/get/create/messages and pagination envelopes are adapted from {data, cursor} / {data}. Delete is used only when the installed client exposes it; otherwise the UI gets an explicit unsupported-operation error. |
| Prompt / completion | Existing synchronous and asynchronous prompt paths remain active. | Prompt admission, model/agent switching, interrupt, compact, and event normalization are adapted. promptAsync is not retried after admission because a retry could duplicate work. |
| Event stream | /global/event; Last-Event-ID and existing reconnect/reconciliation behavior remain available. | /api/event; no Last-Event-ID is sent because the preview stream is volatile. Reconnect relies on the extension's snapshot/recovery path, not replay guarantees. |
| Permissions / questions | Existing supported flows. | Permission reply and question routes are adapted where the installed SDK exposes them; account/workspace authorization is still server-owned. |
| Models / agents | Existing provider/model and agent APIs. | Model and agent selection is adapted through the v2 client, with workspace location passed when known. |
| Diffs, shell, fork/share, archive/revert, todos, child sessions, slash commands | Supported according to the existing capability matrix. | Not claimed by this checkpoint where the preview contract or installed SDK does not preserve semantics; the client returns an actionable unsupported error instead of guessing. |
| Remote attach | Supported with the existing remote URL/auth flow, subject to the server's base-path behavior. | The same flow is used, but base-path routing remains unverified against the preview. |
| Status | Stable support retained; source-level and local lifecycle tests pass. | Preview adapter and local health/session smoke pass; full provider-backed prompt, permission/question, and every platform combination remain unverified. |

## Runtime selection and coexistence policy

Both executables may remain installed. This extension intentionally maintains
one active backend connection per SessionManager: one HTTP client, one event
subscription, one compatibility result, and one connection generation. The
header selector changes the persisted opencode.runtime preference and, when
idle, cleanly disconnects the current client/server before reconnecting to the
selected runtime. Drafts and queued prompts stay in the extension; accepted
server work is never silently resent to a different runtime.

auto is deterministic: it looks for opencode2 first, verifies /api/health, and
then tries opencode with /global/health only when the OpenCode 2 endpoint is
unavailable or unsupported. Explicit selections do not downgrade after
authentication or malformed-response failures.

The extension does not promise simultaneous local use of both runtimes against
their default data directories. Upstream issue [#42260](https://github.com/anomalyco/opencode/issues/42260)
reports that OpenCode 2 can migrate the shared V1 database and break stable
OpenCode paths; issue [#46757](https://github.com/anomalyco/opencode/issues/46757)
also tracks shared V1/V2 configuration roots. A second independent extension
connection is therefore not a supported isolation mechanism. Users who need
external concurrent processes must supply separately isolated XDG
config/data/state/cache roots and accept responsibility for migration and
backup. Sequential switching through this extension remains the supported
workflow.

There is no automatic V1-to-V2 session migration. Matching server session IDs
are scoped to the current verified connection, and the extension rehydrates
from the selected server after a switch. Export/import is the deliberate path
for moving conversation content when a runtime supports the required fields.

## Issue and workaround ledger

| Source | Boundary | Disposition and evidence |
|---|---|---|
| [OpenCode #42260](https://github.com/anomalyco/opencode/issues/42260) | Upstream shared DB/schema migration | Extension mitigation: one active runtime, deterministic switching, no concurrent-default-root promise, and explicit documentation. Removal condition: upstream provides safe default data isolation or a verified profile contract. |
| [OpenCode #42839](https://github.com/anomalyco/opencode/issues/42839) | OpenCode 2 event persistence is volatile | Extension mitigation: do not send a false replay cursor; reconnect and rehydrate from server snapshots. Lossless replay/exactly-once delivery remains unclaimed. |
| [OpenCode #46757](https://github.com/anomalyco/opencode/issues/46757) | Shared V1/V2 config roots | Upstream-only limitation. The extension preserves the selected runtime but does not rewrite or isolate user config directories implicitly. |
| [OpenCode #46498](https://github.com/anomalyco/opencode/issues/46498) | Preview URL base-path routing | Unverified/preview limitation. Remote base-path deployments need a real-server test before being claimed supported. |
| [Harness #18](https://github.com/K-Arthur/opencode-harness/issues/18) | Stale tool state after reconnect/compaction | Existing reconnect/convergence coverage remains part of the unit and integration surface; this checkpoint does not claim a new upstream fix. |
| [OpenCode #41696](https://github.com/anomalyco/opencode/issues/41696) | Port conflict hidden by readiness timeout | Unverified follow-up. The lifecycle distinguishes owned-process startup from reused-port health, but a dedicated port-conflict diagnostic and cross-platform reproduction remain backlog work. |

## Test evidence

The adapter tests use sanitized protocol-shaped responses and verify envelope
mapping, prompt admission, model/agent switching, unsupported-operation errors,
runtime detection, and strict fallback behavior. On the local Linux host,
opencode serve and opencode2 serve were started with isolated XDG directories;
their health responses were verified, and the OpenCode 2 instance was also
verified via session listing and session creation, without making a provider
request. A full provider-backed prompt journey was not run because no
controlled provider fixture was available and the test must not create an
unrequested paid call.

Run the focused checks with:

~~~bash
npx tsx --require ./tests/fixtures/vscode-stub.cjs --test \
  src/session/opencode2ResponseMappers.test.ts \
  src/session/SessionClient.opencode2.test.ts
npx playwright test tests/visual/runtime-control.spec.ts --project=chromium
~~~
