import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { RenderQueue } from "./renderQueue"

describe("RenderQueue", () => {
  let queue: RenderQueue
  let calls: string[]
  let savedRAF: typeof globalThis.requestAnimationFrame | undefined
  let savedCAF: typeof globalThis.cancelAnimationFrame | undefined
  let savedST: typeof globalThis.setTimeout
  let savedCT: typeof globalThis.clearTimeout
  let pendingRafCbs: Map<number, FrameRequestCallback>
  let pendingTimerCbs: Map<number, () => void>
  let nextFakeId: number

  function captureFakeId(): number {
    return nextFakeId++
  }

  function installFakes(): void {
    savedRAF = globalThis.requestAnimationFrame
    savedCAF = globalThis.cancelAnimationFrame
    savedST = globalThis.setTimeout
    savedCT = globalThis.clearTimeout
    pendingRafCbs = new Map()
    pendingTimerCbs = new Map()
    nextFakeId = 1

    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      const id = captureFakeId()
      pendingRafCbs.set(id, cb)
      return id
    }
    globalThis.cancelAnimationFrame = (id: number) => {
      pendingRafCbs.delete(id)
    }
    globalThis.setTimeout = ((cb: (...args: any[]) => void, _ms?: number) => {
      const id = captureFakeId()
      pendingTimerCbs.set(id, cb as () => void)
      return id as any
    }) as any
    globalThis.clearTimeout = (id: any) => {
      pendingTimerCbs.delete(id as number)
    }
  }

  function restoreFakes(): void {
    globalThis.requestAnimationFrame = savedRAF!
    globalThis.cancelAnimationFrame = savedCAF!
    globalThis.setTimeout = savedST
    globalThis.clearTimeout = savedCT
  }

  function fireAllPending(): void {
    const rafs = new Map(pendingRafCbs)
    const timers = new Map(pendingTimerCbs)
    pendingRafCbs.clear()
    pendingTimerCbs.clear()
    for (const [id, cb] of rafs) {
      if (!pendingRafCbs.has(id)) {
        pendingTimerCbs.clear()
        cb(0)
        break
      }
    }
    if (pendingTimerCbs.size === 0 && rafs.size === 0) {
      for (const [, cb] of timers) {
        cb()
      }
    }
  }

  function fireTimers(): void {
    const timers = new Map(pendingTimerCbs)
    pendingTimerCbs.clear()
    for (const [, cb] of timers) {
      cb()
    }
  }

  beforeEach(() => {
    calls = []
    installFakes()
    queue = new RenderQueue((text: string) => {
      calls.push(text)
    })
  })

  afterEach(() => {
    queue.destroy()
    restoreFakes()
  })

  it("accumulates chunks without flushing immediately", () => {
    queue.enqueue("Hello ")
    queue.enqueue("World")
    assert.equal(calls.length, 0, "should not have flushed yet")
  })

  it("batch flush empties queue and calls render callback with all accumulated text", () => {
    queue.enqueue("Hello ")
    queue.enqueue("World")

    fireAllPending()

    assert.deepEqual(calls, ["Hello World"])
  })

  it("does not call render callback when queue is empty on flush", () => {
    fireAllPending()
    assert.equal(calls.length, 0)
  })

  it("forceFlush renders all accumulated text immediately", () => {
    queue.enqueue("A")
    queue.enqueue("B")
    queue.enqueue("C")

    queue.forceFlush()

    assert.deepEqual(calls, ["ABC"])
  })

  it("forceFlush clears the queue so subsequent flush is no-op", () => {
    queue.enqueue("X")
    queue.forceFlush()

    calls.length = 0
    fireAllPending()

    assert.equal(calls.length, 0)
  })

  it("stream end forces immediate final flush", () => {
    queue.enqueue("final ")
    queue.enqueue("chunk")

    queue.forceFlush()

    assert.deepEqual(calls, ["final chunk"])
  })

  it("destroy cancels pending timers and prevents future flushes", () => {
    queue.enqueue("pending")
    queue.destroy()

    calls.length = 0
    fireAllPending()

    assert.equal(calls.length, 0)
  })

  it("enqueue after destroy is a no-op", () => {
    queue.destroy()
    queue.enqueue("should not flush")

    fireAllPending()
    assert.equal(calls.length, 0)
  })

  it("flushes each batch independently", () => {
    queue.enqueue("first")
    queue.forceFlush()

    calls.length = 0

    queue.enqueue("second")
    queue.forceFlush()

    assert.deepEqual(calls, ["second"])
  })

  it("timer fallback triggers flush when raf is stalled", () => {
    queue.enqueue("delayed")

    assert.equal(calls.length, 0)

    fireTimers()

    assert.deepEqual(calls, ["delayed"])
  })

  it("handles empty enqueue as no-op (buffer stays empty, flush skips)", () => {
    queue.enqueue("")
    fireAllPending()

    assert.deepEqual(calls, [])
  })

  it("calls onFlush only after a rendered batch", () => {
    let flushes = 0
    queue.destroy()
    queue = new RenderQueue((text: string) => {
      calls.push(text)
    }, () => {
      flushes++
    })

    fireAllPending()
    assert.equal(flushes, 0)

    queue.enqueue("ack me")
    fireAllPending()
    assert.deepEqual(calls, ["ack me"])
    assert.equal(flushes, 1)
  })

  describe("shouldDefer option", () => {
    let deferred: boolean

    beforeEach(() => {
      deferred = true
      queue.destroy()
      queue = new RenderQueue(
        (text: string) => { calls.push(text) },
        undefined,
        { shouldDefer: () => deferred },
      )
    })

    it("defers_scheduling_while_shouldDefer_returns_true", () => {
      queue.enqueue("hidden chunk")
      assert.equal(pendingRafCbs.size, 0, "no RAF scheduled while deferred")
      assert.equal(pendingTimerCbs.size, 0, "no timer scheduled while deferred")
      assert.equal(calls.length, 0)
    })

    it("flushDeferred_renders_once_after_deferral", () => {
      queue.enqueue("chunk A")
      queue.enqueue("chunk B")
      deferred = false
      queue.flushDeferred()
      assert.equal(calls.length, 1, "should render exactly once")
    })

    it("flushDeferred_is_noop_when_nothing_queued", () => {
      deferred = false
      queue.flushDeferred()
      assert.equal(calls.length, 0)
    })

    it("buffer_cap_while_deferred_does_not_schedule_flush", () => {
      const bigChunk = "x".repeat(RenderQueue.MAX_BUFFER_SIZE)
      queue.enqueue(bigChunk)
      // Buffer overflow while deferred: must NOT fire a flush
      assert.equal(calls.length, 0, "must not flush while deferred on overflow")
      assert.equal(pendingRafCbs.size, 0)
      assert.equal(pendingTimerCbs.size, 0)
    })

    it("resumes_normal_scheduling_after_deferral_lifted", () => {
      queue.enqueue("while hidden")
      deferred = false
      // Now enqueue more — should schedule normally
      queue.enqueue("while visible")
      assert.ok(
        pendingRafCbs.size > 0 || pendingTimerCbs.size > 0,
        "should schedule flush once deferral lifted",
      )
      fireAllPending()
      assert.equal(calls.length, 1)
    })
  })
})
