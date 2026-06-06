import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { createSdkEventNormalizer } from "../EventNormalizer"

describe("ActivityPartHandler", () => {
  it("normalizes subtask parts into live subagent activity", () => {
    const normalizer = createSdkEventNormalizer()
    const events = normalizer.normalize({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-subtask",
          sessionID: "ses-1",
          messageID: "msg-1",
          type: "subtask",
          agent: "UI Audit",
          description: "Review the React surface",
          prompt: "Audit the UI",
        },
      },
    })

    assert.equal(events.length, 1)
    assert.equal(events[0]?.type, "subagent_update")
    assert.equal(events[0]?.sessionId, "ses-1")
    assert.deepEqual(events[0]?.data, {
      id: "part-subtask",
      messageId: "msg-1",
      agentName: "UI Audit",
      status: "running",
      currentActivity: "Review the React surface",
      inputPrompt: "Audit the UI",
    })
  })

  it("normalizes agent, retry, compaction, and step-start parts as progress", () => {
    const normalizer = createSdkEventNormalizer()
    const base = { sessionID: "ses-2", messageID: "msg-2" }
    const events = [
      normalizer.normalize({ type: "message.part.updated", properties: { part: { ...base, id: "agent", type: "agent", name: "build" } } }),
      normalizer.normalize({ type: "message.part.updated", properties: { part: { ...base, id: "retry", type: "retry", error: "provider busy" } } }),
      normalizer.normalize({ type: "message.part.updated", properties: { part: { ...base, id: "compact", type: "compaction" } } }),
      normalizer.normalize({ type: "message.part.updated", properties: { part: { ...base, id: "step", type: "step-start" } } }),
    ].flat()

    assert.deepEqual(events.map((event) => event.type), [
      "agent_activity",
      "retry_activity",
      "compaction_activity",
      "step_start",
    ])
  })

  it("preserves session retry status details", () => {
    const normalizer = createSdkEventNormalizer()
    const events = normalizer.normalize({
      type: "session.status",
      properties: {
        sessionID: "ses-3",
        status: { type: "retry", attempt: 2, message: "provider timeout", next: 123_000 },
      },
    })

    assert.equal(events[0]?.type, "session_status")
    assert.deepEqual((events[0]?.data as { status?: unknown }).status, {
      type: "retry",
      attempt: 2,
      message: "provider timeout",
      next: 123_000,
    })
  })
})
