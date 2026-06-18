/**
 * Shared streaming test harness (not a test suite — excluded from the
 * `*.test.ts` runner glob).
 *
 * Provides a JSDOM environment with a *controllable* requestAnimationFrame so
 * tests can interpose events (e.g. a tool_start) between a chunk enqueue and
 * its flush — the existing inline harness in stream.test.ts fires RAF
 * synchronously and cannot express that ordering.
 */

import type { StreamState, StreamElements } from "./streamHandlers"

const { JSDOM } = require("jsdom") as { JSDOM: any }

export interface DomHandle {
  restore: () => void
  /** Run every RAF callback queued since the last flush (manual mode only). */
  flushRafs: () => void
}

export interface InstallDomOptions {
  /** When true, RAF callbacks queue until flushRafs() instead of firing inline. */
  manualRaf?: boolean
}

export function installDom(opts: InstallDomOptions = {}): DomHandle {
  const dom = new JSDOM(
    '<!doctype html><div id="message-list"></div><div id="typing-indicator"></div><span id="typing-label"></span>',
    { url: "https://opencode-harness.test" },
  )
  const g = globalThis as any
  // NB: crypto is intentionally excluded — in modern Node it is a read-only
  // accessor on globalThis and cannot be reassigned via Object.assign.
  const previous = {
    window: g.window,
    document: g.document,
    HTMLElement: g.HTMLElement,
    Node: g.Node,
    requestAnimationFrame: g.requestAnimationFrame,
    cancelAnimationFrame: g.cancelAnimationFrame,
  }

  g.window = dom.window
  g.document = dom.window.document
  g.HTMLElement = dom.window.HTMLElement
  g.Node = dom.window.Node
  let addedCrypto = false
  if (!g.crypto || typeof g.crypto.randomUUID !== "function") {
    Object.defineProperty(g, "crypto", {
      value: { randomUUID: () => `uuid-${Math.random().toString(36).slice(2)}` },
      configurable: true,
      writable: true,
    })
    addedCrypto = true
  }

  const rafQueue: Array<FrameRequestCallback> = []
  let nextId = 1
  const idToCb = new Map<number, FrameRequestCallback>()

  if (opts.manualRaf) {
    g.requestAnimationFrame = (cb: FrameRequestCallback) => {
      const id = nextId++
      idToCb.set(id, cb)
      rafQueue.push(cb)
      return id
    }
    g.cancelAnimationFrame = (id: number) => {
      const cb = idToCb.get(id)
      idToCb.delete(id)
      if (cb) {
        const i = rafQueue.indexOf(cb)
        if (i >= 0) rafQueue.splice(i, 1)
      }
    }
  } else {
    g.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    }
    g.cancelAnimationFrame = () => {}
  }

  const flushRafs = () => {
    // Drain in waves so a callback that schedules another RAF still runs.
    let guard = 0
    while (rafQueue.length > 0 && guard++ < 100) {
      const batch = rafQueue.splice(0, rafQueue.length)
      for (const cb of batch) cb(0)
    }
  }

  return {
    restore: () => {
      Object.assign(g, previous)
      if (addedCrypto) {
        try {
          delete g.crypto
        } catch {
          /* best-effort cleanup */
        }
      }
      dom.window.close()
    },
    flushRafs,
  }
}

export interface Harness {
  messages: any[]
  state: StreamState
  els: StreamElements & { scrollCalls: number }
}

export function createHarness(): Harness {
  const messageList = document.getElementById("message-list") as HTMLDivElement
  const typingIndicator = document.getElementById("typing-indicator") as HTMLDivElement
  const typingLabel = document.getElementById("typing-label") as HTMLSpanElement

  let scrollCalls = 0
  return {
    messages: [],
    state: {
      isStreaming: false,
      streamingMessageId: null,
      streamingBuffer: "",
      streamingBlockId: null,
      streamingToolCallId: null,
      seenEventIds: new Set<string>(),
      lastStreamTextEl: null,
      currentBlockEl: null,
      currentBlockBuffer: "",
      currentBlockIndex: -1,
      rafPending: false,
      renderQueue: null,
      chunkSeq: 0,
    },
    els: {
      messageList,
      typingIndicator,
      typingLabel,
      get scrollCalls() {
        return scrollCalls
      },
      scrollAnchor: {
        container: messageList,
        isAnchored: true,
        anchor() {},
        scrollIfAnchored() {
          scrollCalls++
        },
        pause() {},
        resume() {},
        pauseForReflow() {},
        dispose() {},
      },
    } as StreamElements & { scrollCalls: number },
  }
}
