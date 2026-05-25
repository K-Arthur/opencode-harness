# SessionManager Decomposition Plan — Tier 3.1

**Status:** Design doc — no code moves yet.
**Target:** `src/session/SessionManager.ts` (1538 LoC, 68 methods, 14 importers)
**Strategy:** Extract 4 service classes; SessionManager becomes a ~300 LoC façade.

---

## Proposed Splits

### 1. `ServerLifecycle` — spawn, health, shutdown

**Extracts:**
- `start()` / `stop()` / `dispose()`
- `waitForHealth()` / `findOpencodeBinary()` / `scheduleReconnect()`
- `setStoredPort()` / `storedPort` field
- `serverProcess`, `port`, `reconnectTimer`, `reconnectAttempts`, `startPromise`
- All server-process event handlers (stdout/stderr, exit, error)

**API:**
```typescript
class ServerLifecycle {
  constructor(private readonly auth: AuthProvider)
  start(): Promise<void>
  stop(): Promise<void>
  dispose(): void
  get isRunning(): boolean
  get currentPort(): number
  setStoredPort(port?: number): void
  readonly onConnected: vscode.Event<{ port: number; remote: boolean; url?: string }>
  readonly onDisconnected: vscode.Event<{ code: number | null; signal: string | null }>
}
```

**Seam:** The server-process spawn is the only place `spawn()` from `child_process` is called. Tests inject a fake `ServerLifecycle` (or a test double that skips actual spawning). All timer-based reconnect logic lives here.

### 2. `SseSubscriber` — event stream connect/reconnect

**Extracts:**
- `subscribeToEvents()` / `runEventStream()` / `readEventStream()`
- `handleEventStreamError()` / `consumeSseParseResult()`
- `markEventStreamConnected()` / `handleSdkEvent()` / `scheduleEventStreamReconnect()`
- `setEventStreamState()` / `eventStreamStatus` / `waitForEventStreamReady()`
- `eventStreamController`, `eventReconnectTimer`, `eventStreamGeneration`, `eventStreamState`
- `lastRawEventAt`, `lastRawEventType`, `lastSseEventId`, etc.
- `eventNormalizer`, `droppedNonDataFrameCount`
- `sessionIdFromEvent()` (used by both event handling and caller)

**API:**
```typescript
class SseSubscriber {
  constructor(
    private readonly getClient: () => OpencodeClient | null,
    private readonly getBaseUrl: () => string | null,
    private readonly getAuthHeader: () => string | undefined,
    private readonly onEvent: (event: OpencodeEvent) => void,
  )
  subscribe(): void
  disconnect(): void
  get status(): EventStreamStatus
  get isReady(): boolean
  waitForReady(timeoutMs?: number): Promise<boolean>
}
```

**Seam:** All SSE parsing and reconnect logic decoupled from server lifecycle. `SseSubscriber` receives an `onEvent` callback — it never needs to know about session CRUD. Tests can pass a fake `fetch`, fake `ReadableStream`, and an `onEvent` spy to verify: (a) events are parsed and forwarded, (b) reconnect fires on timeout/idle/disconnect, (c) max-attempts cap is respected, (d) generation-gate drops stale streams.

### 3. `SessionClient` — CRUD via SDK

**Extracts:**
- `createSession()` / `deleteSession()` / `getSession()` / `updateSessionTitle()`
- `getSessionMessages()` / `listSessions()` / `sessionExists()` / `ensureSession()`
- `sendPrompt()` / `sendPromptAsync()` / `getMessages()`
- `compactSession()` / `abortSession()` / `revertMessage()` / `respondToPermission()`
- `sendCommand()` / `recoverSessions()`
- `filterToolsForModel()` / `assertResponseSize()`
- `currentModel`, `mcpServerManager`

**API:**
```typescript
class SessionClient {
  constructor(
    private readonly getClient: () => OpencodeClient | null,
    private readonly mcpServerManager?: McpServerManager,
  )
  // All CRUD methods — same signatures as current SessionManager
  createSession(title?: string): Promise<Session>
  deleteSession(id: string): Promise<boolean>
  getSession(id: string): Promise<Session>
  updateSessionTitle(id: string, title: string): Promise<Session>
  getSessionMessages(id: string): Promise<...>
  listSessions(): Promise<Session[]>
  sendPrompt(...): Promise<{ info: Message; parts: Part[] }>
  sendPromptAsync(...): Promise<void>
  compactSession(...): Promise<void>
  abortSession(...): Promise<void>
  revertMessage(...): Promise<...>
  respondToPermission(...): Promise<...>
  sendCommand(...): Promise<...>
  recoverSessions(): Promise<void>
  sessionExists(id: string): Promise<boolean>
  ensureSession(...): Promise<Session>
  getMessages(...): Promise<...>
  // State
  set model(ref: ModelRef | null)
  get model(): ModelRef | null
}
```

**Seam:** Pure data access. Takes `getClient` callback (returns null when server is down). All methods follow the same pattern: guard → client call → check error → return data. Tests pass a fake `createOpencodeClient` and verify each CRUD path independently.

### 4. `AuthProvider` — token resolution + header injection

**Extracts:**
- `generatePassword()` / `authHeader` / `buildRemoteAuthHeader()`
- `remoteServerUrl` / `remoteServerPassword` / `serverPassword`
- `serverBaseUrl()` / `isRemote` / `setRemoteServer()`
- `makeClient()` / `makeRemoteClient()` / `_startRemote()`

**API:**
```typescript
class AuthProvider {
  constructor()
  get authHeader(): string | undefined
  get isRemote(): boolean
  get serverPassword(): string
  get baseUrl(): string | null
  setRemoteServer(url: string | null | undefined, password?: string | null): void
  setStoredPassword(password: string): void
  makeClient(port: number): OpencodeClient
  generatePassword(): void  // idempotent
}
```

**Seam:** Pure auth — no SDK calls, no process spawning. Easy to unit test: (a) password generation produces correct format, (b) auth header derivation matches Basic scheme, (c) remote URL validation rejects invalid URLs, (d) `makeClient` attaches auth headers.

---

## SessionManager Façade (~300 LoC)

```typescript
export class SessionManager {
  readonly serverLifecycle: ServerLifecycle
  readonly sseSubscriber: SseSubscriber
  readonly sessionClient: SessionClient
  readonly authProvider: AuthProvider

  constructor(mcpServerManager?: McpServerManager) {
    this.authProvider = new AuthProvider()
    this.serverLifecycle = new ServerLifecycle(this.authProvider)
    this.sessionClient = new SessionClient(
      () => this._client,
      mcpServerManager,
    )
    this.sseSubscriber = new SseSubscriber(
      () => this._client,
      () => this.authProvider.baseUrl,
      () => this.authProvider.authHeader,
      (event) => this._onEvent.fire(event),
    )
  }

  // Public API: delegates to sub-services
  async start(): Promise<void> {
    await this.serverLifecycle.start()
    this._client = this.authProvider.makeClient(this.serverLifecycle.currentPort)
    this.sseSubscriber.subscribe()
    await this.sessionClient.recoverSessions()
  }

  // ... etc. for all current public methods
  private _client: OpencodeClient | null = null
  private _onEvent = new vscode.EventEmitter<OpencodeEvent>()
}
```

---

## Test-Rewrite Scope

| Service | Current test coverage | New tests needed |
|---------|----------------------|------------------|
| `ServerLifecycle` | Indirect via integration tests | Unit: spawn retry, health-polling timeout, reconnect backoff, SIGTERM/SIGKILL fallback. Fake `spawn()` and `fetch()` |
| `SseSubscriber` | Indirect | Unit: SSE frame parsing, reconnect on timeout/idle/error, generation-gate stale stream, max-attempts cap. Mock `fetch()` + `ReadableStream` |
| `SessionClient` | 14 importers exercise indirectly, no direct unit tests | Unit: each CRUD method with fake `OpencodeClient` that returns success/error. `sendPromptAsync` retry loop |
| `AuthProvider` | none | Unit: password gen, Basic header derivation, remote URL validation, `makeClient` header attachment |
| `SessionManager` façade | Existing behavioral tests pass through | ~5 integration tests: composition wiring, `start()` → lifecycle + client + SSE sequence, `stop()` sequence |

**Net new tests:** ~30 unit + ~5 integration. All existing importers (14 files) continue to work because the public API is identical — `SessionManager.start()`, `.sendPrompt()`, `.onEvent`, etc. all remain unchanged.

---

## Rollback Strategy

Each extraction is **one commit** (not squashed with others), and the branch follows this order:

1. `AuthProvider` — no importers affected, purely additive + one internal delegate in SessionManager
2. `SessionClient` — additive, constructor takes `getClient`; SessionManager creates and delegates
3. `ServerLifecycle` — biggest LoC move; SessionManager's `start()`/`stop()` become thin wrappers
4. `SseSubscriber` — additive; SessionManager's `subscribeToEvents()` becomes a delegate call
5. Squash façade pass — delete all inlined private methods that are now in sub-services

Points where a rollback is safe: **after each commit**. The diff is never >400 lines per step, and the façade always passes `npm run typecheck && npm test` before proceeding to the next extraction. If any step fails, revert that single commit — prior steps remain in place.

The full branch diff is estimated at **+800 / -1000** (4 new files, 1 trimmed file).

---

## Sequencing

Per the plan's Tier 3 recommendation:
1. `SessionManager` **first** (cleanest seams, highest test coverage) — **THIS DOC**
2. `webview/main.ts` — feature-by-feature, one PR per feature (~14 PRs)
3. `ChatProvider` — after SessionManager has stable sub-service APIs

---

## Open Questions

- Should `McpServerManager` be passed to `SessionClient` directly (as now) or should `SessionClient` receive already-filtered tools?
- Should `SessionManager` expose sub-services for direct access (e.g. `sessionManager.sessionClient.createSession(...)`) or keep full delegation?
- Should `currentModel` belong to `SessionClient` or to the `SessionManager` façade?
- `sessionIdFromEvent` is used by both `SseSubscriber` (for debug logging) and external callers via `chat/handlers/MessageRouter` — should it be a free-standing utility rather than living on any service?
- `assertResponseSize` is a utility — should it stay private to `SessionClient` or become a shared utility?
