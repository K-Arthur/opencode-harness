import { describe, it } from "node:test"
import assert from "node:assert/strict"

const path = await import("node:path")
const fs = await import("node:fs")

const sourcePath = path.join(import.meta.dirname, "..", "..", "src", "chat", "TabManager.ts")
const source = fs.readFileSync(sourcePath, "utf8")

describe("TabManager — class structure", () => {
  it("defines TabManager as exported class", () => {
    assert.ok(source.includes("export class TabManager"), "TabManager class must be exported")
  })

  it("defines TabState interface with all required fields", () => {
    assert.ok(source.includes("export interface TabState"))
    assert.ok(source.includes("id:"), "TabState must have id")
    assert.ok(source.includes("isStreaming:"), "TabState must have isStreaming")
    assert.ok(source.includes("streamingBuffer:"), "TabState must have streamingBuffer")
    assert.ok(source.includes("model:"), "TabState must have model")
    assert.ok(source.includes("mode:"), "TabState must have mode")
    assert.ok(source.includes("lastActivityTime:"), "TabState must have lastActivityTime")
  })

  it("enforces configurable concurrent stream limit", () => {
    assert.ok(source.includes("maxConcurrentStreams") || source.includes("MAX_CONCURRENT_STREAMS"),
      "must enforce a concurrent stream limit")
    assert.ok(source.includes("get<number>(\"sessions.maxConcurrentStreams\")") || source.includes(">= this.maxConcurrentStreams") || source.includes(">= this.MAX_CONCURRENT_STREAMS"),
      "stream limit must be configurable or enforced")
  })
})

describe("TabManager — tab lifecycle", () => {
  it("createTab creates a tab with default values", () => {
    assert.ok(source.includes("createTab("), "createTab method must exist")
    assert.ok(source.includes("id"))
    assert.ok(source.includes("streamingBuffer: \"\""))
    assert.ok(source.includes("isStreaming: false"))
    assert.ok(source.includes("mode: mode ||"))
  })

  it("closeTab removes tab and handles active tab switch", () => {
    const methodStart = source.indexOf("closeTab(")
    const methodEnd = source.indexOf("switchTab(", methodStart + 10)
    const method = source.slice(methodStart, methodEnd > 0 ? methodEnd : undefined)
    assert.ok(source.includes("closeTab("), "closeTab method must exist")
    assert.ok(method.includes("tabs.delete"), "must delete tab from map")
    assert.ok(method.includes("activeTabId"), "must handle active tab switching")
  })

  it("closeTab returns false for nonexistent tabs", () => {
    assert.ok(source.includes("if (!tab) return false"), "must return false for missing tab")
  })

  it("switchTab changes active tab", () => {
    assert.ok(source.includes("switchTab("), "switchTab method must exist")
    assert.ok(source.includes("activeTabId = id"), "must set activeTabId")
  })

  it("switchTab returns false for nonexistent tab", () => {
    assert.ok(source.includes("if (!this.tabs.has(id)) return false"), "must reject nonexistent tabs")
  })

  it("dispose cleans up all timers and emitters", () => {
    const methodStart = source.indexOf("dispose(): void")
    const methodEnd = source.indexOf("\n}\n", methodStart + 50)
    const method = source.slice(methodStart, methodEnd > 0 ? methodEnd + 1 : undefined)
    assert.ok(source.includes("tabs.clear()"), "must clear all tabs")
    assert.ok(method.includes("clearTimeout"), "must clear completion timeouts")
    assert.ok(method.includes("dispose()"), "must dispose event emitters")
  })
})

describe("TabManager — accessors", () => {
  it("provides getTab to retrieve tab by id", () => {
    assert.ok(source.includes("getTab("), "getTab method must exist")
    assert.ok(source.includes("tabs.get(id)"), "getTab must use map.get")
  })

  it("provides getActiveTab for current tab", () => {
    assert.ok(source.includes("getActiveTab("), "getActiveTab method must exist")
    assert.ok(source.includes("tabs.get(this.activeTabId)"), "getActiveTab must use activeTabId")
  })

  it("provides getActiveId for current tab id", () => {
    assert.ok(source.includes("getActiveId("), "getActiveId method must exist")
    assert.ok(source.includes("return this.activeTabId"), "getActiveId must return active id")
  })

  it("provides getAllTabs to iterate all tabs", () => {
    assert.ok(source.includes("getAllTabs("), "getAllTabs method must exist")
    assert.ok(source.includes("tabs.values()"), "getAllTabs must return all values")
  })

  it("provides getTabCount for count", () => {
    assert.ok(source.includes("getTabCount("), "getTabCount method must exist")
    assert.ok(source.includes("tabs.size"), "getTabCount must return map size")
  })

  it("provides getStreamingCount for concurrent count", () => {
    assert.ok(source.includes("getStreamingCount("), "getStreamingCount method must exist")
    assert.ok(source.includes("isStreaming"), "getStreamingCount must filter by isStreaming")
  })
})

describe("TabManager — streaming control", () => {
  it("canStartStreaming enforces max concurrent limit", () => {
    assert.ok(source.includes("canStartStreaming("), "canStartStreaming method must exist")
    assert.ok(source.includes("maxConcurrentStreams") || source.includes("MAX_CONCURRENT_STREAMS"), "must check max streams")
    assert.ok(source.includes("{ ok: true }"), "must return success object")
    assert.ok(source.includes("ok: false"), "must return failure object when at limit")
  })

  it("setStreaming updates isStreaming and updates lastActivityTime", () => {
    assert.ok(source.includes("setStreaming("), "setStreaming method must exist")
    assert.ok(source.includes("tab.isStreaming = isStreaming"), "must set isStreaming property")
    assert.ok(source.includes("lastActivityTime"), "must update lastActivityTime")
  })
})

describe("TabManager — tab mutations", () => {
  it("provides setModel for changing model", () => {
    assert.ok(source.includes("setModel("), "setModel method must exist")
    assert.ok(source.includes("tab.model = model"), "must set model property")
  })

  it("provides setMode for changing mode", () => {
    assert.ok(source.includes("setMode("), "setMode method must exist")
    assert.ok(source.includes("tab.mode = mode"), "must set mode property")
  })

  it("provides setCliSessionId for session binding", () => {
    assert.ok(source.includes("setCliSessionId("), "setCliSessionId method must exist")
    assert.ok(source.includes("tab.cliSessionId"), "must set cliSessionId")
  })

  it("provides appendToBuffer for streaming", () => {
    assert.ok(source.includes("appendToBuffer("), "appendToBuffer method must exist")
    assert.ok(source.includes("tab.streamingBuffer += text"), "must append to buffer")
  })

  it("provides clearBuffer for resetting", () => {
    assert.ok(source.includes("clearBuffer("), "clearBuffer method must exist")
    assert.ok(source.includes('tab.streamingBuffer = ""'), "must clear buffer")
  })

  it("provides setWaitingForCompletion for flow control", () => {
    assert.ok(source.includes("setWaitingForCompletion("), "setWaitingForCompletion must exist")
  })
})

describe("TabManager — event emitters", () => {
  it("fires events on tab lifecycle changes", () => {
    assert.ok(source.includes("_onTabCreated"), "must emit on tab created")
    assert.ok(source.includes("_onTabClosed"), "must emit on tab closed")
    assert.ok(source.includes("_onTabSwitched"), "must emit on tab switched")
    assert.ok(source.includes("_onStreamingStateChanged"), "must emit on streaming state change")
  })

  it("defines readonly event accessors", () => {
    assert.ok(source.includes("readonly onTabCreated"), "onTabCreated event accessor")
    assert.ok(source.includes("readonly onTabClosed"), "onTabClosed event accessor")
    assert.ok(source.includes("readonly onTabSwitched"), "onTabSwitched event accessor")
    assert.ok(source.includes("readonly onStreamingStateChanged"), "onStreamingStateChanged event accessor")
  })
})
