import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import {
  resolveEscapeAction,
  createEscapeRegistry,
  type OverlayDescriptor,
} from "./escapeCoordinator"

function overlay(id: string, open: boolean, priority: number, onClose?: () => void): OverlayDescriptor {
  return { id, priority, isOpen: () => open, close: onClose ?? (() => {}) }
}

void describe("resolveEscapeAction", () => {
  void it("defers entirely when a self-managed popup is visible", () => {
    const action = resolveEscapeAction([overlay("modal", true, 100)], {
      hasDeferredOverlay: true,
      hasUnmanagedModal: false,
      isStreaming: true,
    })
    assert.deepEqual(action, { type: "defer" })
  })

  void it("defers when an unmanaged aria-modal dialog is open", () => {
    const action = resolveEscapeAction([overlay("side-region", true, 20)], {
      hasDeferredOverlay: false,
      hasUnmanagedModal: true,
      isStreaming: false,
    })
    assert.deepEqual(action, { type: "defer" })
  })

  void it("closes only the highest-priority open overlay", () => {
    const action = resolveEscapeAction(
      [
        overlay("side-region", true, 20),
        overlay("session-modal", true, 100),
        overlay("search-bar", true, 40),
      ],
      { hasDeferredOverlay: false, hasUnmanagedModal: false, isStreaming: true }
    )
    assert.deepEqual(action, { type: "close-overlay", id: "session-modal" })
  })

  void it("breaks priority ties by most recently registered (topmost wins)", () => {
    const action = resolveEscapeAction(
      [overlay("first", true, 80), overlay("second", true, 80)],
      { hasDeferredOverlay: false, hasUnmanagedModal: false, isStreaming: false }
    )
    assert.deepEqual(action, { type: "close-overlay", id: "second" })
  })

  void it("skips closed overlays", () => {
    const action = resolveEscapeAction(
      [overlay("modal", false, 100), overlay("side-region", true, 20)],
      { hasDeferredOverlay: false, hasUnmanagedModal: false, isStreaming: false }
    )
    assert.deepEqual(action, { type: "close-overlay", id: "side-region" })
  })

  void it("treats a throwing isOpen() as closed instead of crashing", () => {
    const broken: OverlayDescriptor = {
      id: "broken",
      priority: 100,
      isOpen: () => { throw new Error("detached DOM") },
      close: () => {},
    }
    const action = resolveEscapeAction([broken, overlay("search-bar", true, 40)], {
      hasDeferredOverlay: false,
      hasUnmanagedModal: false,
      isStreaming: false,
    })
    assert.deepEqual(action, { type: "close-overlay", id: "search-bar" })
  })

  void it("requests stop-stream only when nothing is open and a stream is active", () => {
    const action = resolveEscapeAction([overlay("modal", false, 100)], {
      hasDeferredOverlay: false,
      hasUnmanagedModal: false,
      isStreaming: true,
    })
    assert.deepEqual(action, { type: "stop-stream" })
  })

  void it("returns none when nothing is open and nothing is streaming", () => {
    const action = resolveEscapeAction([], {
      hasDeferredOverlay: false,
      hasUnmanagedModal: false,
      isStreaming: false,
    })
    assert.deepEqual(action, { type: "none" })
  })
})

void describe("createEscapeRegistry", () => {
  let closed: string[]

  beforeEach(() => { closed = [] })

  function makeEvent(key = "Escape", defaultPrevented = false) {
    let prevented = defaultPrevented
    let stopped = false
    return {
      key,
      get defaultPrevented() { return prevented },
      preventDefault() { prevented = true },
      stopPropagation() { stopped = true },
      get _stopped() { return stopped },
    }
  }

  function makeRegistry(opts?: { streaming?: boolean; deferred?: boolean; unmanaged?: boolean }) {
    return createEscapeRegistry({
      isStreaming: () => opts?.streaming ?? false,
      onStop: () => { closed.push("__stop__") },
      hasDeferredOverlay: () => opts?.deferred ?? false,
      hasUnmanagedModal: () => opts?.unmanaged ?? false,
    })
  }

  void it("closes the topmost overlay and consumes the event", () => {
    const reg = makeRegistry()
    reg.register({ id: "low", priority: 20, isOpen: () => true, close: () => closed.push("low") })
    reg.register({ id: "high", priority: 100, isOpen: () => true, close: () => closed.push("high") })
    const e = makeEvent()
    reg.handleKeydown(e as unknown as KeyboardEvent)
    assert.deepEqual(closed, ["high"])
    assert.equal(e.defaultPrevented, true)
    assert.equal(e._stopped, true)
  })

  void it("ignores non-Escape keys and already-handled events", () => {
    const reg = makeRegistry()
    reg.register({ id: "m", priority: 100, isOpen: () => true, close: () => closed.push("m") })
    reg.handleKeydown(makeEvent("Enter") as unknown as KeyboardEvent)
    reg.handleKeydown(makeEvent("Escape", true) as unknown as KeyboardEvent)
    assert.deepEqual(closed, [])
  })

  void it("does not consume the event when deferring to self-managed popups", () => {
    const reg = makeRegistry({ deferred: true })
    reg.register({ id: "m", priority: 100, isOpen: () => true, close: () => closed.push("m") })
    const e = makeEvent()
    reg.handleKeydown(e as unknown as KeyboardEvent)
    assert.deepEqual(closed, [])
    assert.equal(e.defaultPrevented, false)
  })

  void it("stops the stream when nothing is open and consumes the event", () => {
    const reg = makeRegistry({ streaming: true })
    const e = makeEvent()
    reg.handleKeydown(e as unknown as KeyboardEvent)
    assert.deepEqual(closed, ["__stop__"])
    assert.equal(e.defaultPrevented, true)
  })

  void it("leaves the event untouched when there is nothing to do", () => {
    const reg = makeRegistry()
    const e = makeEvent()
    reg.handleKeydown(e as unknown as KeyboardEvent)
    assert.deepEqual(closed, [])
    assert.equal(e.defaultPrevented, false)
    assert.equal(e._stopped, false)
  })

  void it("unregister removes the overlay from consideration", () => {
    const reg = makeRegistry()
    const off = reg.register({ id: "m", priority: 100, isOpen: () => true, close: () => closed.push("m") })
    off()
    reg.register({ id: "n", priority: 20, isOpen: () => true, close: () => closed.push("n") })
    reg.handleKeydown(makeEvent() as unknown as KeyboardEvent)
    assert.deepEqual(closed, ["n"])
  })
})
