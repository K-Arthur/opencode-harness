import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"

// Fake timer wiring
let fakeNow = 0
let timers: Array<{ id: number; at: number; fn: () => void }> = []
let nextId = 1
const savedSet = globalThis.setTimeout
const savedClear = globalThis.clearTimeout

function installFake() {
  fakeNow = 0
  timers = []
  nextId = 1
  globalThis.setTimeout = ((fn: () => void, ms: number) => {
    const id = nextId++
    timers.push({ id, at: fakeNow + ms, fn })
    return id as any
  }) as any
  globalThis.clearTimeout = (id: any) => {
    timers = timers.filter(t => t.id !== (id as number))
  }
}
function restoreFake() {
  globalThis.setTimeout = savedSet
  globalThis.clearTimeout = savedClear
}
function advance(ms: number) {
  fakeNow += ms
  const due = timers.filter(t => t.at <= fakeNow)
  timers = timers.filter(t => t.at > fakeNow)
  for (const t of due) t.fn()
}

describe("PerSessionDebouncer", () => {
  beforeEach(() => installFake())
  afterEach(() => restoreFake())

  it("coalesces_burst_into_single_callback", async () => {
    const { PerSessionDebouncer } = await import("./PerSessionDebouncer")
    const fired: Array<{ sessionId: string; payload: unknown }> = []
    const d = new PerSessionDebouncer((sid, p) => fired.push({ sessionId: sid, payload: p }), 300)

    d.schedule("s1", { todos: [1] })
    d.schedule("s1", { todos: [1, 2] })
    d.schedule("s1", { todos: [1, 2, 3] })

    assert.equal(fired.length, 0, "must not fire immediately")
    advance(300)
    assert.equal(fired.length, 1, "must coalesce into exactly one call")
    assert.deepEqual(fired[0], { sessionId: "s1", payload: { todos: [1, 2, 3] } })
  })

  it("per_session_independence", async () => {
    const { PerSessionDebouncer } = await import("./PerSessionDebouncer")
    const fired: Array<{ sessionId: string; payload: unknown }> = []
    const d = new PerSessionDebouncer((sid, p) => fired.push({ sessionId: sid, payload: p }), 300)

    d.schedule("s1", "payload-a")
    d.schedule("s2", "payload-b")

    advance(300)
    assert.equal(fired.length, 2, "must call once per session")
    const s1 = fired.find(f => f.sessionId === "s1")
    const s2 = fired.find(f => f.sessionId === "s2")
    assert.equal(s1?.payload, "payload-a")
    assert.equal(s2?.payload, "payload-b")
  })

  it("trailing_latest_wins", async () => {
    const { PerSessionDebouncer } = await import("./PerSessionDebouncer")
    const fired: string[] = []
    const d = new PerSessionDebouncer((_, p) => fired.push(p as string), 200)

    d.schedule("s1", "first")
    advance(100)
    d.schedule("s1", "second")  // resets the timer
    advance(200)                 // now fires
    assert.deepEqual(fired, ["second"], "must use latest payload and trail from last schedule")
  })

  it("flushAll_on_dispose", async () => {
    const { PerSessionDebouncer } = await import("./PerSessionDebouncer")
    const fired: string[] = []
    const d = new PerSessionDebouncer((_, p) => fired.push(p as string), 300)

    d.schedule("s1", "pending")
    d.dispose()
    assert.deepEqual(fired, ["pending"], "dispose must flush all pending sessions immediately")
  })
})
