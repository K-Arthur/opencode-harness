import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = readFileSync(resolve(__dirname, "AutoCompactor.ts"), "utf8")

void describe("AutoCompactor.ts", () => {
  void it("exports AutoCompactor class", () => {
    assert.ok(source.includes("export class AutoCompactor"), "AutoCompactor class must be exported")
  })

  void it("constructor accepts sessionManager, sessionStore, contextMonitor, tabManager", () => {
    assert.ok(source.includes("private readonly sessionManager: SessionManager"), "must accept SessionManager")
    assert.ok(source.includes("private readonly sessionStore: SessionStore"), "must accept SessionStore")
    assert.ok(source.includes("private readonly contextMonitor: ContextMonitor"), "must accept ContextMonitor")
    assert.ok(source.includes("private readonly tabManager: TabManager"), "must accept TabManager")
  })

  void it("has tryCompactIfNeeded method with auto, off, and banner modes", () => {
    assert.ok(source.includes("tryCompactIfNeeded("), "must have tryCompactIfNeeded method")
    assert.ok(source.includes("autoCompact === \"off\""), "must handle off setting")
    assert.ok(source.includes("autoCompact === \"auto\""), "must handle auto setting")
    assert.ok(source.includes("compaction_started"), "must send compaction_started message")
    assert.ok(source.includes("compact_banner"), "must send compact_banner in manual mode")
  })

  void it("has handleBannerAction for compact_now and remind_later", () => {
    assert.ok(source.includes("handleBannerAction("), "must have handleBannerAction method")
    assert.ok(source.includes("compact_now"), "must handle compact_now")
    assert.ok(source.includes("remind_later"), "must handle remind_later")
    assert.ok(source.includes("compact_banner_dismissed"), "must send dismiss event on remind")
  })

  void it("has compactNow method that compacts the server session", () => {
    assert.ok(source.includes("async compactNow("), "must have compactNow method")
    assert.ok(source.includes("this.sessionManager.compactSession("), "must call compactSession on server")
    assert.ok(source.includes("this.tabManager.getTab("), "must find tab")
    assert.ok(source.includes("server not running"), "must handle server not running")
  })

  void it("manages snooze state internally", () => {
    assert.ok(source.includes("snoozeUntil"), "must have snoozeUntil field")
    assert.ok(source.includes("snoozeTokens"), "must have snoozeTokens field")
    assert.ok(source.includes("snoozeUntil = Date.now() + 10 * 60 * 1000"), "must set 10-minute snooze")
    assert.ok(source.includes("snoozeUntil = 0"), "must reset snooze on compact_now")
  })

  void it("checks message threshold before auto-compacting", () => {
    assert.ok(source.includes("session.messages.length < 10"), "must require at least 10 messages")
    assert.ok(source.includes("this.contextMonitor.getAutoCompactSetting("), "must check auto compact setting")
  })

  void it("sends session_compacted message on completion", () => {
    assert.ok(source.includes("session_compacted"), "must send session_compacted message")
    assert.ok(source.includes("task_banner"), "must send task_banner for completion")
  })
})
