import * as vscode from "vscode"
import { log } from "../utils/outputChannel"
import { createSdkEventNormalizer } from "./EventNormalizer"
import type { SdkEventLike } from "./eventHandlers/types"
import { SseEventParser } from "./sseParser"
import { IdleWatchdog } from "./IdleWatchdog"
import type { EventStreamLifecycleState, EventStreamStatus, OpencodeEvent, OpencodeEventType } from "./sessionTypes"

export class SseSubscriber {
  private eventStreamController: AbortController | null = null
  private eventReconnectTimer: ReturnType<typeof setTimeout> | null = null
  private eventReconnectAttempts = 0
  private lastRawEventAt = 0
  private lastNormalizedEventAt = 0
  private lastRawEventType = ""
  private lastNormalizedEventType = ""
  private lastSseEventId: string | null = null
  private eventStreamStableTimer: ReturnType<typeof setTimeout> | null = null
  private eventStreamGeneration = 0
  private eventStreamState: EventStreamLifecycleState = "disconnected"
  private eventStreamEverConnected = false
  private readonly eventStreamReadyWaiters = new Set<(ready: boolean) => void>()
  private readonly MAX_EVENT_STREAM_RECONNECT_ATTEMPTS = 10
  private firstPartEventLoggedForSessions = new Set<string>()
  private eventNormalizer = createSdkEventNormalizer()
  private droppedNonDataFrameCount = 0
  private disposed = false

  constructor(
    private readonly hasClient: () => boolean,
    private readonly getBaseUrl: () => string | null,
    private readonly getAuthHeader: () => string | undefined,
    private readonly onEvent: (event: OpencodeEvent) => void,
  ) {}

  get status(): EventStreamStatus {
    return {
      state: this.eventStreamState,
      lastRawEventType: this.lastRawEventType || undefined,
      lastRawEventAt: this.lastRawEventAt || undefined,
      reconnectAttempts: this.eventReconnectAttempts,
    }
  }

  get isReady(): boolean {
    return this.eventStreamState === "connected"
  }

  async waitForReady(timeoutMs = 5_000): Promise<boolean> {
    if (this.isReady) return true
    if (!this.hasClient()) return false

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.eventStreamReadyWaiters.delete(done)
        resolve(this.isReady)
      }, timeoutMs)

      const done = (ready: boolean): void => {
        clearTimeout(timer)
        this.eventStreamReadyWaiters.delete(done)
        resolve(ready)
      }

      this.eventStreamReadyWaiters.add(done)
    })
  }

  subscribe(): void {
    const baseUrl = this.getBaseUrl()
    if (!this.hasClient() || !baseUrl || this.disposed) return

    if (this.eventReconnectTimer) {
      clearTimeout(this.eventReconnectTimer)
      this.eventReconnectTimer = null
    }

    if (this.eventStreamController) {
      this.eventStreamController.abort()
    }
    const generation = ++this.eventStreamGeneration
    const controller = new AbortController()
    this.eventStreamController = controller
    this.setEventStreamState(this.eventStreamEverConnected ? "reconnecting" : "connecting")

    void this.runEventStream(baseUrl, controller, generation)
    log.info(`Subscribed to OpenCode event stream at ${this.eventStreamUrl(baseUrl)}`)
  }

  disconnect(): void {
    if (this.eventReconnectTimer) {
      clearTimeout(this.eventReconnectTimer)
      this.eventReconnectTimer = null
    }
    if (this.eventStreamStableTimer) {
      clearTimeout(this.eventStreamStableTimer)
      this.eventStreamStableTimer = null
    }
    if (this.eventStreamController) {
      this.eventStreamController.abort()
      this.eventStreamController = null
    }
    this.eventStreamGeneration++
    this.setEventStreamState("disconnected")
    this.eventReconnectAttempts = 0
    this.eventStreamReadyWaiters.forEach(resolve => resolve(false))
    this.eventStreamReadyWaiters.clear()
  }

  dispose(): void {
    this.disposed = true
    this.disconnect()
  }

  sessionIdFromEvent(event: SdkEventLike): string | undefined {
    const props = event.properties
    if (!props) return undefined
    if (typeof props.sessionID === "string") return props.sessionID

    const part = props.part
    if (typeof part === "object" && part !== null && typeof (part as { sessionID?: unknown }).sessionID === "string") {
      return (part as { sessionID: string }).sessionID
    }

    const info = props.info
    if (typeof info === "object" && info !== null && typeof (info as { sessionID?: unknown }).sessionID === "string") {
      return (info as { sessionID: string }).sessionID
    }

    return undefined
  }

  private async runEventStream(baseUrl: string, controller: AbortController, generation: number): Promise<void> {
    const parser = new SseEventParser()
    const headers: Record<string, string> = { Accept: "text/event-stream" }
    const authHeader = this.getAuthHeader()
    if (authHeader) headers["Authorization"] = authHeader
    if (this.lastSseEventId) headers["Last-Event-ID"] = this.lastSseEventId

    let connectionTimedOut = false
    const connectTimeout = setTimeout(() => {
      if (!controller.signal.aborted) {
        connectionTimedOut = true
        controller.abort()
      }
    }, 30_000)

    const idleWatchdog = new IdleWatchdog({
      timeoutMs: 90_000,
      onTimeout: () => {
        if (!controller.signal.aborted) controller.abort()
      },
    })

    try {
      const resp = await fetch(this.eventStreamUrl(baseUrl), {
        signal: controller.signal,
        headers,
      })
      clearTimeout(connectTimeout)

      if (!resp.ok) {
        const body = await this.safeResponsePreview(resp)
        throw new Error(`OpenCode event stream returned HTTP ${resp.status}: ${body}`)
      }
      if (!resp.body) {
        throw new Error("OpenCode event stream returned no response body")
      }

      const contentType = resp.headers.get("content-type") ?? ""
      if (!contentType.toLowerCase().includes("text/event-stream")) {
        log.warn(`OpenCode event stream content-type was ${JSON.stringify(contentType)}; continuing`)
      }

      this.markEventStreamConnected(generation)
      await this.readEventStream(resp.body.getReader(), parser, idleWatchdog, controller, generation)

      if (generation === this.eventStreamGeneration && !controller.signal.aborted && !this.disposed) {
        log.warn(`OpenCode event stream closed (last raw=${this.lastRawEventType || "none"})`)
        this.scheduleEventStreamReconnect("stream_closed")
      }
    } catch (err) {
      clearTimeout(connectTimeout)
      this.handleEventStreamError(err, generation, connectionTimedOut, idleWatchdog, controller)
    }
  }

  private async readEventStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    parser: SseEventParser,
    idleWatchdog: IdleWatchdog,
    controller: AbortController,
    generation: number,
  ): Promise<void> {
    const decoder = new TextDecoder()
    idleWatchdog.arm()
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        if (generation !== this.eventStreamGeneration || controller.signal.aborted) return
        if (!value) continue
        idleWatchdog.arm()
        this.consumeSseParseResult(parser.push(decoder.decode(value, { stream: true })))
      }
      this.consumeSseParseResult(parser.push(decoder.decode()))
      this.consumeSseParseResult(parser.flush())
    } finally {
      reader.releaseLock()
      idleWatchdog.clear()
    }
  }

  private handleEventStreamError(
    err: unknown,
    generation: number,
    connectionTimedOut: boolean,
    idleWatchdog: IdleWatchdog,
    controller: AbortController,
  ): void {
    if (generation !== this.eventStreamGeneration || this.disposed) return

    if (connectionTimedOut) {
      log.warn("OpenCode event stream connection timed out after 30s")
      this.onEvent({
        type: "server_error",
        data: { error: "OpenCode event stream connection timed out after 30s" },
      })
      this.scheduleEventStreamReconnect("connection_timeout")
      return
    }

    if (idleWatchdog.timedOut) {
      log.warn("OpenCode event stream idle for 90000ms — reconnecting")
      this.scheduleEventStreamReconnect("idle_timeout")
      return
    }

    if (controller.signal.aborted) return

    const message = err instanceof Error ? err.message : String(err)
    log.warn(`OpenCode event stream failed: ${message}`)
    this.onEvent({
      type: "server_error",
      data: { error: `OpenCode event stream failed: ${message}` },
    })
    this.scheduleEventStreamReconnect(message)
  }

  private consumeSseParseResult(result: { errors: unknown[]; droppedNonDataFrames: number; lastEventId: string | null; events: unknown[] }): void {
    for (const err of result.errors) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn(`Malformed OpenCode SSE frame ignored: ${message}`)
    }
    if (result.droppedNonDataFrames > 0) {
      this.droppedNonDataFrameCount += result.droppedNonDataFrames
      if (this.droppedNonDataFrameCount % 25 === result.droppedNonDataFrames % 25) {
        log.warn(`OpenCode SSE: ${this.droppedNonDataFrameCount} non-data-bearing frames received so far this stream`)
      }
    }
    if (result.lastEventId !== null) {
      this.lastSseEventId = result.lastEventId
    }
    for (const event of result.events) {
      try {
        if (typeof (event as { type?: unknown }).type !== "string") {
          log.warn("SSE event missing string `type` after parser unwrap — dropping")
          continue
        }
        const sdkEvent = event as unknown as SdkEventLike
        if (sdkEvent.type !== "message.part.delta" && sdkEvent.type !== "server.heartbeat" &&
            sdkEvent.type !== "message.part.updated" && sdkEvent.type !== "sync") {
          log.debug(`SSE event: ${sdkEvent.type} props=${JSON.stringify(sdkEvent.properties ?? {}).slice(0, 200)}`)
        }
        this.handleSdkEvent(sdkEvent)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.warn(`SSE event dispatch threw on ${String((event as { type?: unknown })?.type ?? "<unknown>")}: ${msg} — dropped, stream continues`)
      }
    }
  }

  private handleSdkEvent(event: SdkEventLike): void {
    this.lastRawEventAt = Date.now()
    this.lastRawEventType = event.type

    if (event.type === "message.part.updated") {
      const sessionId = this.sessionIdFromEvent(event)
      if (sessionId && !this.firstPartEventLoggedForSessions.has(sessionId)) {
        this.firstPartEventLoggedForSessions.add(sessionId)
        log.info(`First message.part.updated observed for session ${sessionId}`)
      }
    }

    let normalizedEvents: ReturnType<typeof this.eventNormalizer.normalize>
    try {
      normalizedEvents = this.eventNormalizer.normalize(event)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.warn(`EventNormalizer threw on ${event.type}: ${message} — event dropped, stream continues`)
      return
    }

    for (const normalized of normalizedEvents) {
      this.lastNormalizedEventAt = Date.now()
      this.lastNormalizedEventType = normalized.type
      if (normalized.type !== "server_connected") {
        this.eventReconnectAttempts = 0
      }
      try {
        this.onEvent(normalized)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.warn(`Event listener threw on ${normalized.type}: ${message} — stream continues`)
      }
    }
  }

  private eventStreamUrl(baseUrl: string): string {
    return `${baseUrl}/global/event`
  }

  private markEventStreamConnected(generation: number): void {
    const wasReconnect = this.eventStreamEverConnected
    this.eventStreamEverConnected = true
    this.setEventStreamState("connected")

    if (wasReconnect) {
      this.eventNormalizer = createSdkEventNormalizer()
      this.droppedNonDataFrameCount = 0
    }

    if (this.eventStreamStableTimer) {
      clearTimeout(this.eventStreamStableTimer)
      this.eventStreamStableTimer = null
    }

    if (wasReconnect) {
      this.eventStreamStableTimer = setTimeout(() => {
        if (generation !== this.eventStreamGeneration || this.eventStreamState !== "connected") return
        log.info("Event stream reconnected — stable")
        this.onEvent({ type: "event_stream_reconnected" })
      }, 1_000)
    }
  }

  private scheduleEventStreamReconnect(reason = "stream_error"): void {
    if (this.disposed || !this.hasClient() || this.eventReconnectTimer) return

    if (this.eventReconnectAttempts >= this.MAX_EVENT_STREAM_RECONNECT_ATTEMPTS) {
      log.error(`Event stream max reconnect attempts (${this.MAX_EVENT_STREAM_RECONNECT_ATTEMPTS}) reached — giving up`)
      this.onEvent({
        type: "server_error",
        data: { error: "OpenCode event stream connection failed — max reconnect attempts reached" },
      })
      this.setEventStreamState("failed")
      return
    }

    if (this.eventStreamStableTimer) {
      clearTimeout(this.eventStreamStableTimer)
      this.eventStreamStableTimer = null
    }
    this.setEventStreamState("reconnecting")
    if (this.eventStreamController) {
      this.eventStreamController.abort()
      this.eventStreamController = null
    }
    const attempt = this.eventReconnectAttempts++
    const delay = Math.min(1000 * Math.pow(2, attempt), 30000) + Math.floor(Math.random() * 250)
    const rawAge = this.lastRawEventAt ? `${Date.now() - this.lastRawEventAt}ms ago` : "never"
    const normalizedAge = this.lastNormalizedEventAt ? `${Date.now() - this.lastNormalizedEventAt}ms ago` : "never"
    log.warn(`Reconnecting OpenCode event stream in ${delay}ms (attempt ${attempt + 1}; reason=${reason}; last raw=${this.lastRawEventType || "none"} ${rawAge}; last normalized=${this.lastNormalizedEventType || "none"} ${normalizedAge})`)
    this.eventReconnectTimer = setTimeout(() => {
      this.eventReconnectTimer = null
      if (this.disposed || !this.hasClient()) return
      this.subscribe()
    }, delay)
  }

  private setEventStreamState(state: EventStreamLifecycleState): void {
    if (this.eventStreamState === state) return
    const previous = this.eventStreamState
    this.eventStreamState = state
    log.info(`[event-stream] ${previous} → ${state} (last raw=${this.lastRawEventType || "none"})`)

    if (state === "connected") {
      this.eventStreamReadyWaiters.forEach(resolve => resolve(true))
      this.eventStreamReadyWaiters.clear()
    } else if (state === "failed" || state === "disconnected") {
      this.eventStreamReadyWaiters.forEach(resolve => resolve(false))
      this.eventStreamReadyWaiters.clear()
    }
  }

  private async safeResponsePreview(resp: Response): Promise<string> {
    try {
      return (await resp.text()).slice(0, 500)
    } catch {
      return "<unreadable response body>"
    }
  }
}
