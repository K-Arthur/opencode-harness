import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import Module from "node:module"
import type { HeartbeatService } from "./HeartbeatService"
import type { HeartbeatDeps } from "./HeartbeatService"

// HeartbeatService transitively imports `vscode` via `outputChannel`. In a pure
// node test runner the `vscode` module doesn't exist, so we install a minimal
// CJS shim into the loader cache before requiring the handler.
const ModuleAny = Module as unknown as {
  _resolveFilename: (id: string, parent: NodeModule, ...rest: unknown[]) => string
  _cache: Record<string, { id: string; exports: unknown; loaded: boolean }>
}
const originalResolve = ModuleAny._resolveFilename
ModuleAny._resolveFilename = function (id: string, parent: NodeModule, ...rest: unknown[]) {
  if (id === "vscode") return "vscode-stub"
  return originalResolve.call(this, id, parent, ...rest)
}
ModuleAny._cache["vscode-stub"] = {
  id: "vscode-stub",
  loaded: true,
  exports: {
    window: {
      createOutputChannel: () => ({
        appendLine: () => {},
        append: () => {},
        show: () => {},
      }),
    },
    OutputChannel: class {},
    EventEmitter: class { event() { return () => {} } },
    workspace: { getConfiguration: () => ({ get: () => undefined }) },
    env: { language: "en" },
  },
}

const { HeartbeatService: HeartbeatServiceClass } = require("./HeartbeatService") as typeof import("./HeartbeatService")
type HeartbeatServiceInstance = InstanceType<typeof HeartbeatServiceClass>

function makeTabManager(isStreaming = true, buffer = "buffered text") {
  return {
    getTab: (_id: string) => ({ isStreaming, streamingBuffer: buffer }),
  } as any
}

function makeDeps(overrides: Partial<HeartbeatDeps> = {}): HeartbeatDeps {
  return {
    tabManager: makeTabManager(),
    heartbeatSeqs: new Map(),
    heartbeatAckedSeqs: new Map(),
    heartbeatAckedChunkSeqs: new Map(),
    heartbeatTimers: new Map(),
    lastForceRerenderSeqs: new Map(),
    postedChunkSeqs: new Map(),
    deferredChunks: new Map(),
    heartbeatNoticePosted: new Set(),
    MAX_UNACKED_STREAM_CHUNKS: 3,
    MAX_STREAM_DEFER_MS: 200,
    ...overrides,
  }
}

let intervalCbs: Map<number, () => void>
let nextTimerId: number
let savedSetInterval: typeof setInterval
let savedClearInterval: typeof clearInterval

function installFakeTimers() {
  intervalCbs = new Map()
  nextTimerId = 1
  savedSetInterval = globalThis.setInterval
  savedClearInterval = globalThis.clearInterval
  globalThis.setInterval = ((cb: () => void, _ms?: number) => {
    const id = nextTimerId++
    intervalCbs.set(id, cb)
    return id as any
  }) as any
  globalThis.clearInterval = (id: any) => { intervalCbs.delete(id as number) }
}

function restoreFakeTimers() {
  globalThis.setInterval = savedSetInterval
  globalThis.clearInterval = savedClearInterval
}

function tick(count = 1) {
  for (let i = 0; i < count; i++) {
    for (const cb of Array.from(intervalCbs.values())) cb()
  }
}

describe("HeartbeatService — force_rerender gating", () => {
  let svc: HeartbeatServiceInstance
  let deps: HeartbeatDeps
  let posted: Array<Record<string, unknown>>
  const TAB = "tab-1"
  const callbacks = () => ({ postMessage: (m: Record<string, unknown>) => { posted.push(m) } } as any)

  beforeEach(() => {
    posted = []
    deps = makeDeps()
    svc = new HeartbeatServiceClass(deps)
    installFakeTimers()
    svc.startHeartbeat(TAB, callbacks())
  })

  afterEach(() => {
    svc.dispose()
    restoreFakeTimers()
  })

  it("does_not_send_force_rerender_while_acks_missing", () => {
    // 4 ticks with no acks; seq=4, ackedSeq=0, missedCount=4
    tick(4)
    const rerenders = posted.filter(m => m.type === "force_rerender")
    assert.equal(rerenders.length, 0, "must not send force_rerender while acks are pending")
  })

  it("sends_single_force_rerender_after_ack_resumes", () => {
    tick(4) // build up missed pings
    posted.length = 0
    const seq = deps.heartbeatSeqs.get(TAB) ?? 0
    // Ack arrives — must trigger exactly one force_rerender, not per-tick
    svc.handleStreamAck(TAB, seq)
    const rerenders = posted.filter(m => m.type === "force_rerender")
    assert.equal(rerenders.length, 1, "must send exactly one force_rerender after ack resumes")
  })

  it("no_second_force_rerender_on_subsequent_ack_when_up_to_date", () => {
    tick(4)
    const seq = deps.heartbeatSeqs.get(TAB) ?? 0
    svc.handleStreamAck(TAB, seq)
    posted.length = 0
    // Second ack with same/higher seq — no additional force_rerender
    svc.handleStreamAck(TAB, seq)
    const rerenders = posted.filter(m => m.type === "force_rerender")
    assert.equal(rerenders.length, 0, "second ack must not produce another force_rerender")
  })

  it("backs_off_ping_cadence_after_three_missed_pings", () => {
    // Tick 10 times with no acks. With backoff, expect fewer than 10 pings.
    tick(10)
    const pings = posted.filter(m => m.type === "stream_ping")
    // Without backoff: 10 pings. With 3-tick backoff after 3 misses: ≤7 pings.
    assert.ok(pings.length < 10, `expected ping backoff, got ${pings.length} pings from 10 ticks`)
  })

  it("resumes_normal_ping_cadence_immediately_after_ack", () => {
    tick(4) // cause misses
    const seq = deps.heartbeatSeqs.get(TAB) ?? 0
    svc.handleStreamAck(TAB, seq) // recover
    posted.length = 0
    // Next single tick must produce a ping (not skipped by backoff)
    tick(1)
    const pings = posted.filter(m => m.type === "stream_ping")
    assert.equal(pings.length, 1, "after ack, next tick should immediately produce a ping")
  })
})
