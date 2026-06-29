import { describe, it } from "node:test"
import assert from "node:assert/strict"

const path = await import("node:path")
const fs = await import("node:fs")

const root = path.resolve(import.meta.dirname, "..", "..")

const SESSION_FOCUS = fs.readFileSync(path.join(root, "src", "chat", "webview", "sessionFocus.ts"), "utf8")
const SEND_LOGIC = fs.readFileSync(path.join(root, "src", "chat", "webview", "sendMessage.ts"), "utf8")
const TAB_MANAGER = fs.readFileSync(path.join(root, "src", "chat", "TabManager.ts"), "utf8")
const STREAM_COORDINATOR = fs.readFileSync(path.join(root, "src", "chat", "handlers", "StreamCoordinator.ts"), "utf8")
const STREAM_TIMEOUT_MANAGER = fs.readFileSync(path.join(root, "src", "chat", "handlers", "StreamTimeoutManager.ts"), "utf8")
const MAIN_TS = fs.readFileSync(path.join(root, "src", "chat", "webview", "main.ts"), "utf8")

void describe("tab-focus stability — user's current view not stolen during generation", () => {
  void it("shouldHonorActiveSessionChange accepts currentIsStreaming field", () => {
    const idx = SESSION_FOCUS.indexOf("export interface ActiveSessionChangeContext")
    assert.ok(idx >= 0, "ActiveSessionChangeContext must exist")
    const block = SESSION_FOCUS.slice(idx, idx + 800)
    assert.ok(
      block.includes("currentIsStreaming"),
      "ActiveSessionChangeContext must have currentIsStreaming field",
    )
  })

  void it("shouldHonorActiveSessionChange blocks switch when user is on a different valid tab", () => {
    const idx = SESSION_FOCUS.indexOf("export function shouldHonorActiveSessionChange(")
    assert.ok(idx >= 0, "shouldHonorActiveSessionChange must exist")
    const block = SESSION_FOCUS.slice(idx, idx + 1500)
    assert.ok(
      block.indexOf("currentActiveId === targetId") > 0,
      "shouldHonorActiveSessionChange must check for same tab first",
    )
    assert.ok(
      block.includes("return false"),
      "shouldHonorActiveSessionChange must return false (auto-switch disabled) for different valid tabs",
    )
  })

  void it("active_session_changed handler passes currentIsStreaming to shouldHonorActiveSessionChange", () => {
    const idx = MAIN_TS.indexOf('"active_session_changed"')
    assert.ok(idx >= 0, "active_session_changed handler must exist")
    const block = MAIN_TS.slice(idx, idx + 1200)
    assert.ok(
      block.includes("currentIsStreaming") || block.includes("isStreaming"),
      "active_session_changed handler must pass currentIsStreaming to shouldHonorActiveSessionChange",
    )
  })

  void it("sendLogic.sendMessage does not auto-switch when user is on a different non-streaming tab", () => {
    const idx = SEND_LOGIC.indexOf("export function sendMessage")
    assert.ok(idx >= 0, "sendMessage must exist")
    const block = SEND_LOGIC.slice(idx, idx + 2000)
    const switchCount = (block.match(/switchTab/g) || []).length +
      (block.match(/switchToTab/g) || []).length
    assert.ok(switchCount <= 2,
      `sendMessage must minimize tab switches (found ${switchCount} switchTab/switchToTab calls)`,
    )
    assert.ok(
      !block.includes("activeSessionId !== active.id"),
      "sendMessage must not auto-switch when state.activeSessionId differs from active.id",
    )
  })

  void it("TabManager.createTab defaults setActive to false", () => {
    const idx = TAB_MANAGER.indexOf("createTab(")
    assert.ok(idx >= 0, "createTab must exist")
    const block = TAB_MANAGER.slice(idx, TAB_MANAGER.indexOf("closeTab(", idx))
    assert.ok(
      block.includes("options?.setActive === true"),
      "createTab must require explicit setActive:true — not auto-activate",
    )
    assert.ok(
      !block.includes("options?.setActive !== false"),
      "createTab must NOT check setActive !== false (defaults to true)",
    )
  })
})

void describe("TTFB stability — no premature state reversion for slow models", () => {
  void it("TTFB_TIMEOUT_MS is increased to 90000ms for slow third-party models", () => {
    const match = STREAM_COORDINATOR.match(/TTFB_TIMEOUT_MS_DEFAULT\s*=\s*(\d[\d_]*)/)
    assert.ok(match, "TTFB_TIMEOUT_MS_DEFAULT must be defined")
    const val = parseInt(match[1].replace(/_/g, ""), 10)
    assert.ok(val >= 90000, `TTFB_TIMEOUT_MS_DEFAULT should be >= 90000ms, got ${val}`)
  })

  void it("setupTtfbTimeout does NOT post stream_end when probe says run is still active", () => {
    // Use method signature to match the DEFINITION, not a call site
    const idx = STREAM_TIMEOUT_MANAGER.indexOf("setupTtfbTimeout(tabId: string, callbacks: StreamCallbacks)")
    assert.ok(idx >= 0, "setupTtfbTimeout definition must exist in StreamTimeoutManager")
    const block = STREAM_TIMEOUT_MANAGER.slice(idx, idx + 12000)
    assert.ok(
      block.includes("probeActiveRun"),
      "setupTtfbTimeout must call probeActiveRun to check backend",
    )
    assert.ok(
      block.includes("suppressing stream_end") || block.includes("suppressing"),
      "setupTtfbTimeout must suppress stream_end when probe confirms run is active",
    )
  })

  void it("setupTtfbTimeout delays postRequestError until probe completes", () => {
    // Use method signature to match the DEFINITION, not a call site
    const idx = STREAM_TIMEOUT_MANAGER.indexOf("setupTtfbTimeout(tabId: string, callbacks: StreamCallbacks)")
    assert.ok(idx >= 0, "setupTtfbTimeout definition must exist in StreamTimeoutManager")
    const block = STREAM_TIMEOUT_MANAGER.slice(idx, idx + 5000)
    const probeIdx = block.indexOf("probeActiveRun")
    const postRequestErrorIdx = block.indexOf("postRequestError")
    if (postRequestErrorIdx >= 0) {
      assert.ok(
        probeIdx >= 0 && probeIdx < postRequestErrorIdx,
        "postRequestError must come AFTER probeActiveRun in the timeout handler",
      )
    }
  })
})
