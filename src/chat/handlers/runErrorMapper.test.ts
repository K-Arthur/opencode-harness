import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { mapRunError } from "./runErrorMapper"

describe("mapRunError", () => {
  it("maps model startup timeout distinctly from transport disconnect", () => {
    const startup = mapRunError({
      kind: "model_startup_timeout",
      source: "model_provider",
      recoverability: "retryable",
      sessionId: "tab-1",
      runId: "run-1",
    })

    assert.equal(startup.kind, "model_startup_timeout")
    assert.equal(startup.source, "model_provider")
    assert.equal(startup.retryable, true)
    assert.match(startup.userMessage, /no model, tool, or subagent activity/i)

    const transport = mapRunError({
      kind: "transport_disconnected",
      source: "event_stream",
      recoverability: "refresh_from_server",
      sessionId: "tab-1",
      runId: "run-1",
      mayStillBeRunning: true,
      partialOutputPreserved: true,
    })

    assert.equal(transport.kind, "transport_disconnected")
    assert.equal(transport.source, "event_stream")
    assert.equal(transport.mayStillBeRunning, true)
    assert.equal(transport.partialOutputPreserved, true)
    assert.match(transport.title ?? "", /stream disconnected/i)
  })
})
