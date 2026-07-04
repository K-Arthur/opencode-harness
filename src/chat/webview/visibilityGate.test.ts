import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"

// Module under test (doesn't exist yet — tests should FAIL in RED phase)
import { isPanelVisible, registerActivationFlush, notifyTabActivated } from "./visibilityGate"

function setupDom() {
  const dom = new JSDOM(`<!doctype html><html><body></body></html>`)
  ;(globalThis as any).document = dom.window.document
  ;(globalThis as any).window = dom.window
  ;(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
    cb(0)
    return 0
  }
  ;(globalThis as any).cancelAnimationFrame = () => undefined
  return dom
}

describe("isPanelVisible", () => {
  beforeEach(() => setupDom())

  it("returns true when element is inside an .active .tab-panel", () => {
    const panel = document.createElement("div")
    panel.className = "tab-panel active"
    const child = document.createElement("div")
    panel.appendChild(child)
    document.body.appendChild(panel)
    assert.equal(isPanelVisible(child), true)
    panel.remove()
  })

  it("returns false when .tab-panel exists but lacks .active", () => {
    const panel = document.createElement("div")
    panel.className = "tab-panel"
    const child = document.createElement("div")
    panel.appendChild(child)
    document.body.appendChild(panel)
    assert.equal(isPanelVisible(child), false)
    panel.remove()
  })

  it("returns true when there is no .tab-panel ancestor (detached or test context)", () => {
    const el = document.createElement("div")
    // Not appended to any panel
    assert.equal(isPanelVisible(el), true)
  })

  it("returns true for element directly in an active panel", () => {
    const panel = document.createElement("div")
    panel.className = "tab-panel active"
    document.body.appendChild(panel)
    assert.equal(isPanelVisible(panel), true)
    panel.remove()
  })
})

describe("registerActivationFlush / notifyTabActivated", () => {
  let savedRAF: typeof globalThis.requestAnimationFrame
  let rafCbs: Array<FrameRequestCallback>

  beforeEach(() => {
    setupDom()
    rafCbs = []
    savedRAF = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      rafCbs.push(cb)
      return rafCbs.length
    }
  })

  afterEach(() => {
    globalThis.requestAnimationFrame = savedRAF
  })

  it("runs registered flush inside a RAF when tab is activated", () => {
    let called = 0
    registerActivationFlush("tab-1", () => { called++ })
    notifyTabActivated("tab-1")
    assert.equal(called, 0, "should not run synchronously")
    rafCbs.forEach(cb => cb(0))
    assert.equal(called, 1, "should run once after RAF fires")
  })

  it("runs multiple flushes registered for the same tab", () => {
    let a = 0, b = 0
    registerActivationFlush("tab-2", () => { a++ })
    registerActivationFlush("tab-2", () => { b++ })
    notifyTabActivated("tab-2")
    rafCbs.forEach(cb => cb(0))
    assert.equal(a, 1)
    assert.equal(b, 1)
  })

  it("unregister prevents flush from being called", () => {
    let called = 0
    const unregister = registerActivationFlush("tab-3", () => { called++ })
    unregister()
    notifyTabActivated("tab-3")
    rafCbs.forEach(cb => cb(0))
    assert.equal(called, 0, "unregistered flush must not fire")
  })

  it("notifyTabActivated for unknown tabId is a no-op", () => {
    assert.doesNotThrow(() => notifyTabActivated("nonexistent-tab"))
  })

  it("flushes only the activated tab, not other tabs", () => {
    let a = 0, b = 0
    registerActivationFlush("tab-a", () => { a++ })
    registerActivationFlush("tab-b", () => { b++ })
    notifyTabActivated("tab-a")
    rafCbs.forEach(cb => cb(0))
    assert.equal(a, 1)
    assert.equal(b, 0, "tab-b flush must not run when tab-a is activated")
  })
})
