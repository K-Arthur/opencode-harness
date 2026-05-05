import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"




const source = readFileSync(resolve(__dirname, "TabManager.ts"), "utf8")

void describe("TabManager.ts", () => {
  void it("exports TabState interface", () => {
    assert.ok(source.includes("export interface TabState"), "TabState interface must be exported")
    assert.ok(source.includes("id: string"), "TabState must have id")
    assert.ok(source.includes("cliSessionId?: string"), "TabState must have cliSessionId")
    assert.ok(source.includes("streamingBuffer: string"), "TabState must have streamingBuffer")
    assert.ok(source.includes("isStreaming: boolean"), "TabState must have isStreaming")
  })

  void it("exports TabManager class", () => {
    assert.ok(source.includes("export class TabManager"), "TabManager class must be exported")
  })

  void it("has MAX_CONCURRENT_STREAMS = 3", () => {
    assert.ok(source.includes("MAX_CONCURRENT_STREAMS = 3"), "max concurrent streams must be 3")
  })

  void it("has tab lifecycle methods", () => {
    assert.ok(source.includes("createTab("), "must have createTab")
    assert.ok(source.includes("closeTab("), "must have closeTab")
    assert.ok(source.includes("switchTab("), "must have switchTab")
    assert.ok(source.includes("dispose()"), "must have dispose")
  })

  void it("has tab query methods", () => {
    assert.ok(source.includes("getTab("), "must have getTab")
    assert.ok(source.includes("getActiveTab("), "must have getActiveTab")
    assert.ok(source.includes("getActiveId("), "must have getActiveId")
    assert.ok(source.includes("getAllTabs("), "must have getAllTabs")
    assert.ok(source.includes("getTabCount("), "must have getTabCount")
    assert.ok(source.includes("getStreamingCount("), "must have getStreamingCount")
  })

  void it("has streaming control methods", () => {
    assert.ok(source.includes("setStreaming("), "must have setStreaming")
    assert.ok(source.includes("canStartStreaming("), "must have canStartStreaming")
    assert.ok(source.includes("setWaitingForCompletion("), "must have setWaitingForCompletion")
    assert.ok(source.includes("setCompletionTimeout("), "must have setCompletionTimeout")
    assert.ok(source.includes("clearCompletionTimeout("), "must have clearCompletionTimeout")
  })

  void it("has buffer management methods", () => {
    assert.ok(source.includes("appendToBuffer("), "must have appendToBuffer")
    assert.ok(source.includes("clearBuffer("), "must have clearBuffer")
    assert.ok(source.includes("tab.streamingBuffer"), "must access streamingBuffer")
  })

  void it("has tab property setters", () => {
    assert.ok(source.includes("setModel("), "must have setModel")
    assert.ok(source.includes("setMode("), "must have setMode")
    assert.ok(source.includes("setCliSessionId("), "must have setCliSessionId")
  })

  void it("has EventEmitter-based events", () => {
    assert.ok(source.includes("_onTabCreated"), "must have _onTabCreated")
    assert.ok(source.includes("_onTabClosed"), "must have _onTabClosed")
    assert.ok(source.includes("_onTabSwitched"), "must have _onTabSwitched")
    assert.ok(source.includes("_onStreamingStateChanged"), "must have _onStreamingStateChanged")
    assert.ok(source.includes("readonly onTabCreated"), "must expose onTabCreated")
    assert.ok(source.includes("readonly onTabClosed"), "must expose onTabClosed")
    assert.ok(source.includes("readonly onTabSwitched"), "must expose onTabSwitched")
    assert.ok(source.includes("readonly onStreamingStateChanged"), "must expose onStreamingStateChanged")
  })

  void it("closeTab handles active tab switching and streaming cleanup", () => {
    assert.ok(source.includes("if (this.activeTabId === id)"), "closeTab must re-assign activeTabId")
    assert.ok(source.includes("this._onTabSwitched.fire"), "closeTab must fire onTabSwitched")
    assert.ok(source.includes("clearTimeout(tab.completionTimeout)"), "closeTab must clear completion timeout")
  })
})
