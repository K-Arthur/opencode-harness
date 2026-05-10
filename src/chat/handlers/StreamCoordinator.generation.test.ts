import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const __dirname = path.dirname(new URL(import.meta.url).pathname)
const source = readFileSync(path.join(__dirname, "StreamCoordinator.ts"), "utf8")

describe("StreamCoordinator.ts", () => {
  it("exports StreamCallbacks interface", () => {
    assert.ok(source.includes("export interface StreamCallbacks"), "StreamCallbacks interface must be exported")
  })

  it("exports StreamCoordinator class", () => {
    assert.ok(source.includes("export class StreamCoordinator"), "StreamCoordinator class must be exported")
  })

  it("defines StreamLifecycleState type", () => {
    assert.ok(source.includes("StreamLifecycleState"), "StreamLifecycleState type must be defined")
  })

  it("has startPrompt method", () => {
    assert.ok(source.includes("startPrompt("), "StreamCoordinator must have startPrompt method")
  })

  it("has finalizeStream method", () => {
    assert.ok(source.includes("finalizeStream("), "StreamCoordinator must have finalizeStream method")
  })

  it("has abort method", () => {
    assert.ok(source.includes("abort("), "StreamCoordinator must have abort method")
  })

  it("has TTFB and transport-aware stream watchdog timeouts", () => {
    assert.ok(source.includes("TTFB_TIMEOUT_MS"), "Must have TTFB timeout")
    assert.ok(source.includes("STREAM_STUCK_MS"), "Must have stream stuck watchdog")
    assert.ok(!source.includes("CHUNK_INACTIVITY_TIMEOUT_MS"), "Must not revive chunk inactivity timeout")
  })

  it("has streamStates map for lifecycle tracking", () => {
    assert.ok(source.includes("streamStates = new Map"), "Must track stream states")
  })

  it("has finalizingTabs set to guard against double-finalize", () => {
    assert.ok(source.includes("finalizingTabs"), "Must have finalizingTabs guard")
  })

  it("has activeMessageIds map for mid-stream message detection", () => {
    assert.ok(source.includes("activeMessageIds"), "Must track active message IDs")
  })

  it("uses DiffHandler for diff processing", () => {
    assert.ok(source.includes("diffHandler"), "StreamCoordinator must use DiffHandler")
  })

  it("calls postMessage with final message_complete in finalizeStream", () => {
    assert.ok(source.includes("message_complete"), "finalizeStream must post message_complete")
  })

  it("handles blocksBuffer in finalizeStream to preserve tool/skill blocks", () => {
    assert.ok(source.includes("blocksBuffer"), "finalizeStream must handle blocksBuffer")
  })

  it("has setStreamState private method for lifecycle logging", () => {
    assert.ok(source.includes("setStreamState("), "Must have setStreamState method")
  })

  it("logs stream state transitions", () => {
    assert.ok(source.includes("stream:") && source.includes("→"), "Must log stream state transitions")
  })
})
