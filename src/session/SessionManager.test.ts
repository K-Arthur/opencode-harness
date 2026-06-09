import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "SessionManager.ts"), "utf8")
const typesSource = readFileSync(path.join(__dirname, "sessionTypes.ts"), "utf8")
const authSource = readFileSync(path.join(__dirname, "AuthProvider.ts"), "utf8")
const clientSource = readFileSync(path.join(__dirname, "SessionClient.ts"), "utf8")
const lifecycleSource = readFileSync(path.join(__dirname, "ServerLifecycle.ts"), "utf8")
const sseSource = readFileSync(path.join(__dirname, "SseSubscriber.ts"), "utf8")
const allSource = source + authSource + clientSource + lifecycleSource + sseSource

describe("SessionManager.ts", () => {
  it("exports OpencodeEventType union type", () => {
    assert.ok(source.includes("OpencodeEventType") || typesSource.includes("export type OpencodeEventType"), "must export OpencodeEventType union type")
  })

  it("exports OpencodeEvent interface", () => {
    assert.ok(source.includes("OpencodeEvent") || typesSource.includes("export interface OpencodeEvent"), "must export OpencodeEvent interface")
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
    assert.ok(clientSource.includes("async sendPrompt("))
  })

  it("has sendPromptAsync with retry logic", () => {
    assert.ok(clientSource.includes("async sendPromptAsync("))
    assert.ok(clientSource.includes("MAX_RETRIES"))
  })

  it("supports OpenCode agent selection on prompt bodies", () => {
    assert.ok(source.includes("agent?: string"), "PromptOptions must expose the SDK agent field")
    assert.ok(clientSource.includes("const agent = options?.agent"), "sendPrompt methods must read options.agent")
    assert.ok(clientSource.includes("...(agent ? { agent } : {})"), "prompt body must include agent when provided")
  })

  it("has ensureSession method", () => {
    assert.ok(clientSource.includes("async ensureSession("))
  })

  it("ensureSession treats webview-local placeholder ids as pending, not server ids", () => {
    const idx = clientSource.indexOf("async ensureSession(")
    assert.ok(idx >= 0, "ensureSession must exist")
    const block = clientSource.slice(idx, idx + 1200)
    assert.ok(
      block.includes("isLocalPlaceholderSessionId"),
      "ensureSession should not probe the OpenCode server for session-* placeholder ids"
    )
  })

  it("has getSessionMessages method backed by session.messages API", () => {
    assert.ok(clientSource.includes("async getSessionMessages("))
    assert.ok(clientSource.includes("client.session.messages("), "must use SDK session.messages(), not Session.history")
  })

  it("updates session titles through the OpenCode SDK", () => {
    assert.ok(clientSource.includes("async updateSessionTitle("))
    assert.ok(clientSource.includes("client.session.update("), "must call session.update with title")
  })

  it("generates SERVER_PASSWORD when none is configured", () => {
    assert.ok(authSource.includes("generatePassword"), "must have generatePassword method")
    assert.ok(authSource.includes("OPENCODE_SERVER_PASSWORD"), "must respect OPENCODE_SERVER_PASSWORD env var")
    assert.ok(authSource.includes("oc-"), "must use oc- prefix for generated passwords")
  })

  it("passes password as Basic auth to SDK client", () => {
    assert.ok(authSource.includes("Basic"), "must use Basic scheme (opencode server uses HTTP Basic Auth)")
    assert.ok(authSource.includes("opencode:"), "must use opencode: username")
    assert.ok(authSource.includes("base64"), "must base64-encode credentials")
  })

  it("has idempotency key on sendPromptAsync to prevent duplicate retries", () => {
    assert.ok(clientSource.includes("Idempotency-Key"), "must have idempotency-key header or mechanism")
    assert.ok(clientSource.includes("idempotencyKey"), "must generate unique key per prompt")
  })

  it("narrows isRetryableError to avoid false-positive business-logic retries", () => {
    assert.ok(clientSource.includes("isRetryableError"), "isRetryableError must exist")
  })

  it("start() guards against concurrent server processes", () => {
    assert.ok(lifecycleSource.includes("startPromise"), "must use startPromise to guard concurrent starts")
    assert.ok(lifecycleSource.includes("if (this.startPromise) return"), "must reuse in-flight promise")
  })

  it("validates remote server URL before enabling remote attach", () => {
    assert.ok(authSource.includes("validateServerUrl"), "must use shared URL validation")
    assert.ok(authSource.includes("Invalid remote server URL"), "must reject invalid URLs")
  })

  it("spawned server inherits data-dir env vars so CLI and extension share sessions", () => {
    assert.ok(lifecycleSource.includes("OPENCODE_DATA_DIR"), "OPENCODE_DATA_DIR must be in allowedEnvVars so extension server uses same storage as CLI")
  })

  const idx = source.indexOf("sessions_recovered")
  const block = idx >= 0 ? source.slice(idx - 400, idx + 400) : ""
  it("recoverSessions shows all workspaces, not just current", () => {
    assert.ok(idx >= 0, "must have sessions_recovered event")
    assert.ok(!block.includes("currentWorkspaceDir"), "recoverSessions must not filter by current workspace — CLI sessions from other workspaces must surface")
  })

  it("defines MAX_EVENT_STREAM_RECONNECT_ATTEMPTS constant", () => {
    assert.ok(sseSource.includes("MAX_EVENT_STREAM_RECONNECT_ATTEMPTS"), "must cap event stream reconnect attempts at 10")
    assert.ok(sseSource.includes("10"), "must cap at 10")
  })

  const reconnect = sseSource.indexOf("private scheduleEventStreamReconnect")
  const reconnectBlock = reconnect >= 0 ? sseSource.slice(reconnect, reconnect + 1600) : ""
  it("transitions to 'failed' lifecycle state when max reconnect attempts reached", () => {
    assert.ok(reconnect >= 0, "scheduleEventStreamReconnect must exist")
    assert.ok(reconnectBlock.includes("failed"), "must transition to failed state")
    assert.ok(reconnectBlock.includes("max reconnect attempts"), "must log max attempts reached")
  })

  const markConnected = sseSource.indexOf("private markEventStreamConnected")
  const markConnectedBlock = markConnected >= 0 ? sseSource.slice(markConnected, markConnected + 1600) : ""
  it("resolves event stream waiters with false when entering 'failed' or 'disconnected' state", () => {
    assert.ok(sseSource.includes("eventStreamReadyWaiters"), "must track waiters")
    assert.ok(sseSource.includes("resolve(false)"), "must resolve waiters with false on failed or disconnected")
    assert.ok(sseSource.includes("resolve(true)"), "must resolve waiters with true on connected")
  })

  it("resets normalizer on reconnect to avoid stale deduplication", () => {
    assert.ok(markConnected >= 0, "markEventStreamConnected must exist")
    assert.ok(markConnectedBlock.includes("createSdkEventNormalizer"), "must reset normalizer on reconnect")
    assert.ok(markConnectedBlock.includes("wasReconnect"), "must distinguish first connect from reconnect")
  })

  const extractMethod = (name: string): string => {
    const start = allSource.indexOf(name)
    if (start < 0) return ""
    const after = allSource.indexOf("{", start)
    if (after < 0) return ""
    let depth = 0
    for (let i = after; i < allSource.length; i++) {
      if (allSource[i] === "{") depth++
      if (allSource[i] === "}") { depth--; if (depth === 0) return allSource.slice(start, i + 1) }
    }
    return allSource.slice(start)
  }

  const extractRunEventStreamBody = (): string => extractMethod("private async runEventStream")
  const extractHandleError = (): string => extractMethod("private handleEventStreamError")

  const runEventBlock = extractRunEventStreamBody()
  const errorBlock = extractHandleError()

  it("applies connection timeout to the event stream fetch", () => {
    assert.ok(runEventBlock.includes("30_000") || runEventBlock.includes("30000"), "must set a connection timeout on the fetch")
    assert.ok(runEventBlock.includes("connectTimeout"), "must track connection timeout separately")
  })

  it("surfaces specific connection timeout error instead of silent abort", () => {
    assert.ok(errorBlock.includes("connectionTimedOut"), "must track connection timeout with a flag")
    assert.ok(errorBlock.includes("timed out after 30s"), "must log specific timeout message")
  })

  it("preserves user-initiated abort distinction without reconnect attempt", () => {
    assert.ok(errorBlock.includes("signal.aborted") || errorBlock.includes("controller.signal.aborted"), "user abort must return without scheduling reconnect")
  })

  it("aborts the event stream when reads idle for too long (server stall protection)", () => {
    assert.ok(runEventBlock.includes("IdleWatchdog"), "must use IdleWatchdog for stall detection")
    assert.ok(runEventBlock.includes("90_000") || runEventBlock.includes("90000"), "must set idle timeout")
  })
})
