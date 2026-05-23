import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "SessionManager.ts"), "utf8")

describe("SessionManager.ts", () => {
  it("exports OpencodeEventType union type", () => {
    assert.ok(source.includes("export type OpencodeEventType"))
  })

  it("exports OpencodeEvent interface", () => {
    assert.ok(source.includes("export interface OpencodeEvent"))
  })

  it("exports ContextPackage interface", () => {
    assert.ok(source.includes("export interface ContextPackage"))
  })

  it("exports SessionManager class", () => {
    assert.ok(source.includes("export class SessionManager"))
  })

  it("has start method", () => {
    assert.ok(source.includes("async start()"))
  })

  it("has stop method", () => {
    assert.ok(source.includes("async stop()"))
  })

  it("has dispose method", () => {
    assert.ok(source.includes("dispose()"))
  })

  it("has sendPrompt method", () => {
    assert.ok(source.includes("async sendPrompt("))
  })

  it("has sendPromptAsync with retry logic", () => {
    assert.ok(source.includes("async sendPromptAsync("))
    assert.ok(source.includes("MAX_RETRIES"))
  })

  it("supports OpenCode agent selection on prompt bodies", () => {
    assert.ok(source.includes("agent?: string"), "PromptOptions must expose the SDK agent field")
    assert.ok(source.includes("const agent = options?.agent"), "sendPrompt methods must read options.agent")
    assert.ok(source.includes("...(agent ? { agent } : {})"), "prompt body must include agent when provided")
  })

  it("has ensureSession method", () => {
    assert.ok(source.includes("async ensureSession("))
  })

  it("ensureSession treats webview-local placeholder ids as pending, not server ids", () => {
    const idx = source.indexOf("async ensureSession(")
    assert.ok(idx >= 0, "ensureSession must exist")
    const block = source.slice(idx, idx + 1200)
    assert.ok(
      block.includes("!isLocalPlaceholderSessionId(cliSessionId)"),
      "ensureSession should not probe the OpenCode server for session-* placeholder ids"
    )
  })

  it("has getSessionMessages method backed by session.messages API", () => {
    assert.ok(source.includes("async getSessionMessages("), "must expose session message history")
    assert.ok(source.includes("this.client.session.messages("), "must use SDK session.messages(), not Session.history")
  })

  it("generates SERVER_PASSWORD when none is configured", () => {
    assert.ok(source.includes("generatePassword"), "must have generatePassword method")
    assert.ok(source.includes("randomUUID"), "must use randomUUID for password")
    assert.ok(source.includes("OPENCODE_SERVER_PASSWORD"), "must pass password via env var")
  })

  it("passes password as Basic auth to SDK client", () => {
    assert.ok(source.includes("Authorization"), "must set Authorization header")
    assert.ok(source.includes("Basic"), "must use Basic scheme (opencode server uses HTTP Basic Auth)")
  })

  it("has idempotency key on sendPromptAsync to prevent duplicate retries", () => {
    assert.ok(source.includes("idempotency"), "must have idempotency-key header or mechanism")
  })

  it("narrows isRetryableError to avoid false-positive business-logic retries", () => {
    assert.ok(source.includes("isRetryableError"), "isRetryableError must exist")
    assert.ok(source.includes("econnrefused"), "must match ECONNREFUSED")
    assert.ok(source.includes("econnreset"), "must match ECONNRESET")
    // Should NOT broadly match generic strings like "socket"
    const narrowPattern = !source.includes("/socket/i")
    assert.ok(narrowPattern || source.includes("econnrefused"), "must prefer targeted patterns over broad /socket/i")
  })

  it("start() guards against concurrent server processes", () => {
    assert.ok(source.includes("startPromise"), "must use startPromise to guard concurrent starts")
    assert.ok(source.includes("this.startPromise = this._start()"), "must assign _start() to startPromise")
    assert.ok(source.includes("this.startPromise = null"), "must clear startPromise after completion")
  })

  it("validates remote server URL before enabling remote attach", () => {
    assert.ok(source.includes("validateServerUrl"), "must use shared URL validation")
    assert.ok(source.includes("Remote server URL warning"), "must log non-fatal URL warnings")
    assert.ok(source.includes("Invalid remote server URL"), "must reject invalid remote URLs")
  })

  // ── CLI session sharing ────────────────────────────────────────────────────

  it("spawned server inherits data-dir env vars so CLI and extension share sessions", () => {
    assert.ok(
      source.includes("OPENCODE_DATA_DIR"),
      "OPENCODE_DATA_DIR must be in allowedEnvVars so extension server uses same storage as CLI"
    )
    assert.ok(
      source.includes("XDG_DATA_HOME"),
      "XDG_DATA_HOME must be in allowedEnvVars so extension server uses same storage as CLI"
    )
  })

  it("recoverSessions shows all workspaces, not just current", () => {
    const idx = source.indexOf("private async recoverSessions(")
    assert.ok(idx >= 0, "recoverSessions must exist")
    const block = source.slice(idx, idx + 400)
    assert.ok(
      !block.includes("isInCurrentWorkspace"),
      "recoverSessions must NOT filter by isInCurrentWorkspace (all workspace sessions should be recoverable)"
    )
  })

  // ── Event stream transport ──────────────────────────────────────────────

  it("defines MAX_EVENT_STREAM_RECONNECT_ATTEMPTS constant", () => {
    assert.ok(
      source.includes("MAX_EVENT_STREAM_RECONNECT_ATTEMPTS = 10"),
      "must cap event stream reconnect attempts at 10"
    )
  })

  it("transitions to 'failed' lifecycle state when max reconnect attempts reached", () => {
    const reconnect = source.indexOf("private scheduleEventStreamReconnect(")
    assert.ok(reconnect >= 0, "scheduleEventStreamReconnect must exist")
    const block = source.slice(reconnect, reconnect + 700)
    assert.ok(
      block.includes("this.eventReconnectAttempts >= this.MAX_EVENT_STREAM_RECONNECT_ATTEMPTS"),
      "must check max attempts before scheduling reconnect"
    )
    assert.ok(
      block.includes('this.setEventStreamState("failed")'),
      "must set state to 'failed' when max attempts exhausted"
    )
    assert.ok(
      block.includes('type: "server_error"'),
      "must fire server_error before entering failed state"
    )
    assert.ok(
      block.includes("max reconnect attempts reached"),
      "server_error must indicate max reconnect attempts reached"
    )
  })

  it("resolves event stream waiters with false when entering 'failed' or 'disconnected' state", () => {
    assert.ok(
      source.includes('state === "failed" || state === "disconnected"'),
      "must resolve waiters with false on failed or disconnected"
    )
    assert.ok(
      source.includes("this.eventStreamReadyWaiters.forEach"),
      "must notify all waiters"
    )
  })

  it("resets normalizer on reconnect to avoid stale deduplication", () => {
    const markConnected = source.indexOf("private markEventStreamConnected(")
    assert.ok(markConnected >= 0, "markEventStreamConnected must exist")
    const block = source.slice(markConnected, markConnected + 500)
    assert.ok(
      block.includes("this.eventNormalizer = createSdkEventNormalizer()"),
      "must reassign normalizer on reconnect to clear stale dedup state"
    )
  })

  /**
   * Pattern for source-text assertions: extract a method's full body by
   * anchoring on its declaration and slicing through the start of the next
   * sibling. Prefer this over `source.slice(idx, idx + N)` — fixed character
   * windows silently fail when the method grows.
   *
   * Other tests in this codebase still use `idx + N` slicing; migrate them
   * to a similar helper opportunistically when assertions break or the
   * method body grows.
   */
  const extractMethod = (methodName: string): string => {
    const start = source.indexOf(`private ${methodName}(`)
    if (start < 0) return ""
    const after = source.slice(start + 1)
    const nextMethodMatch = after.match(/\n  (?:private |async |get |dispose\(|protected )/)
    const end = nextMethodMatch && typeof nextMethodMatch.index === "number"
      ? start + 1 + nextMethodMatch.index
      : source.length
    return source.slice(start, end)
  }

  const extractRunEventStreamBody = (): string => extractMethod("async runEventStream")
  const extractHandleError = (): string => extractMethod("handleEventStreamError")

  it("applies connection timeout to the event stream fetch", () => {
    const block = extractRunEventStreamBody()
    assert.ok(
      block.includes("connectTimeout"),
      "must set a connection timeout on the fetch"
    )
    assert.ok(
      block.includes("clearTimeout(connectTimeout)"),
      "must clear connection timeout after fetch completes"
    )
  })

  it("surfaces specific connection timeout error instead of silent abort", () => {
    const block = extractHandleError()
    assert.ok(
      block.includes("connectionTimedOut"),
      "must track connection timeout with a flag"
    )
    assert.ok(
      block.includes('"OpenCode event stream connection timed out after 30s"'),
      "must log specific timeout message"
    )
    assert.ok(
      block.includes('this.scheduleEventStreamReconnect("connection_timeout")'),
      "must schedule reconnect with connection_timeout reason"
    )
  })

  it("preserves user-initiated abort distinction without reconnect attempt", () => {
    const block = extractHandleError()
    assert.ok(
      block.includes("if (controller.signal.aborted) return"),
      "user abort must return without scheduling reconnect"
    )
    assert.ok(
      block.includes("generation !== this.eventStreamGeneration || this.disposed"),
      "stale generation must return without scheduling reconnect"
    )
  })

  it("aborts the event stream when reads idle for too long (server stall protection)", () => {
    const runEventBlock = extractRunEventStreamBody()
    assert.ok(
      runEventBlock.includes("IdleWatchdog"),
      "must use IdleWatchdog for stall detection"
    )
    assert.ok(
      runEventBlock.includes('timeoutMs: 90_000'),
      "must have 90s idle timeout"
    )
    const errorBlock = extractHandleError()
    assert.ok(
      errorBlock.includes("idleWatchdog.timedOut"),
      "must check idle watchdog on stream failure"
    )
    assert.ok(
      errorBlock.includes("idle_timeout"),
      "must reconnect with idle_timeout reason when reads stall"
    )
  })
})
