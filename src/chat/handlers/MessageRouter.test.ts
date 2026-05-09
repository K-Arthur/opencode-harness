import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const source = readFileSync(resolve(__dirname, "MessageRouter.ts"), "utf8")

describe("MessageRouter.ts", () => {
  it("exports RouteContext interface", () => {
    assert.ok(source.includes("export interface RouteContext"), "RouteContext interface must be exported")
    assert.ok(source.includes("postMessage: (msg: Record<string, unknown>) => void"),
      "RouteContext must have postMessage")
    assert.ok(source.includes("postRequestError: (message: string) => void"),
      "RouteContext must have postRequestError")
  })

  it("exports MessageRouter class", () => {
    assert.ok(source.includes("export class MessageRouter"), "MessageRouter class must be exported")
  })

  it("accepts SessionManager and ModelManager in constructor", () => {
    assert.ok(
      source.includes("private readonly sessionManager: SessionManager"),
      "constructor must accept SessionManager"
    )
    assert.ok(
      source.includes("private readonly modelManager: ModelManager"),
      "constructor must accept ModelManager"
    )
  })

  it("has handleMentionSearch method with mention types", () => {
    assert.ok(
      source.includes("async handleMentionSearch(query: string, context: RouteContext)"),
      "handleMentionSearch must exist"
    )
    assert.ok(source.includes('prefix: "@file:"'), "must handle @file mentions")
    assert.ok(source.includes('prefix: "@folder:"'), "must handle @folder mentions")
    assert.ok(source.includes('prefix: "@url:"'), "must handle @url mentions")
    assert.ok(source.includes('prefix: "@terminal:"'), "must handle @terminal mentions")
    assert.ok(source.includes('prefix: "@problems:"'), "must handle @problems mentions")
  })

  it("has handleListSessions method", () => {
    assert.ok(
      source.includes("async handleListSessions(sessionStore: any, context: RouteContext)"),
      "handleListSessions must exist"
    )
    assert.ok(source.includes('type: "session_list"'), "must post session_list message")
  })

  it("has handleAcceptPermission method", () => {
    assert.ok(
      source.includes("async handleAcceptPermission(sessionId: string, permissionId: string, response: string)"),
      "handleAcceptPermission must exist"
    )
    assert.ok(
      source.includes("this.sessionManager.respondToPermission(sessionId, permissionId, response)"),
      "must call respondToPermission"
    )
  })

  it("has getModelList method", () => {
    assert.ok(
      source.includes("getModelList(context: RouteContext): void"),
      "getModelList must exist"
    )
    assert.ok(source.includes("this.modelManager.models.map"), "must iterate modelManager.models")
    assert.ok(source.includes('type: "model_list"'), "must post model_list message")
  })

  it("searches workspace files for mention results", () => {
    assert.ok(
      source.includes("vscode.workspace.findFiles"),
      "must search workspace files"
    )
    assert.ok(
      source.includes('type: "mention_results"'),
      "must post mention_results"
    )
  })

  it("debounces mention searches and uses path-aware globbing", () => {
    assert.ok(source.includes("searchDebounceTimer"), "must keep a mention search debounce timer")
    assert.ok(source.includes("executeMentionSearch"), "must isolate the actual search implementation")
    assert.ok(source.includes("clearTimeout(this.searchDebounceTimer"), "must cancel stale search timers")
    assert.ok(source.includes('query.includes("/")'), "must detect path-like mention queries")
    assert.ok(source.includes("**/${query}*"), "must build path-aware glob patterns")
    assert.ok(source.includes(", 50)"), "must request enough file results for useful autocomplete")
  })

  it("has routeSseEvent method for SDK events", () => {
    assert.ok(
      source.includes("routeSseEvent("),
      "routeSseEvent must exist"
    )
    assert.ok(source.includes("switch (type as KnownSseEventType)"), "must switch on event.type")
    assert.ok(source.includes("_exhaustiveCheck"), "must have exhaustive check guard")
  })

  it("routes all SDK event types in routeSseEvent", () => {
    const sdkEventTypes = [
      "stream_start", "stream_token", "stream_chunk", "stream_end",
      "stream_error", "tool_start", "tool_update", "tool_end",
      "diff", "thinking", "text", "error",
      "session_start", "session_end", "model_change", "compaction"
    ]
    sdkEventTypes.forEach(type => {
      assert.ok(
        source.includes(`case "${type}":`),
        `routeSseEvent must handle ${type} event`
      )
    })
  })

  it("has _exhaustiveCheck guard for never type", () => {
    assert.ok(source.includes("function _exhaustiveCheck"), "_exhaustiveCheck must be defined")
    assert.ok(source.includes("Unrecognized event type:"), "must build error message")
    assert.ok(source.includes("throw new Error(msg)"), "must throw on unexpected type")
  })

  it("handles stream_error in routeSseEvent", () => {
    assert.ok(
      source.includes('case "stream_error":'),
      "routeSseEvent must handle stream_error"
    )
    assert.ok(
      source.includes("context.postMessage(event)"),
      "stream_error must post via context"
    )
  })
})
