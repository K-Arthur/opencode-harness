import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { mapOpenCode2MessagePage, mapOpenCode2Session, mapOpenCode2PromptAdmission } from "./opencode2ResponseMappers"

describe("OpenCode 2 response mappers", () => {
  it("maps the location-based session shape into the session store contract", () => {
    const session = mapOpenCode2Session({
      id: "ses_123",
      projectID: "project",
      title: "OpenCode 2 session",
      location: { directory: "/workspace/project" },
      time: { created: 10, updated: 20 },
      cost: 0,
      tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
    })
    assert.equal(session.id, "ses_123")
    assert.equal(session.directory, "/workspace/project")
    assert.equal(session.title, "OpenCode 2 session")
    assert.equal(session.version, "opencode2")
  })

  it("unwraps the generated SDK response envelope for sessions", () => {
    const session = mapOpenCode2Session({
      data: {
        id: "ses_wrapped",
        projectID: "project",
        location: { directory: "/workspace/project" },
        time: { created: 1, updated: 2 },
        title: "Wrapped",
      },
    })
    assert.equal(session.id, "ses_wrapped")
    assert.equal(session.directory, "/workspace/project")
  })

  it("maps user, assistant text, reasoning, and tool states", () => {
    const messages = mapOpenCode2MessagePage({ data: [
      { id: "u1", type: "user", time: { created: 1 }, text: "hello" },
      {
        id: "a1", type: "assistant", time: { created: 2 }, agent: "build",
        model: { providerID: "p", id: "m" }, content: [
          { type: "text", id: "t1", text: "answer" },
          { type: "reasoning", id: "r1", text: "thinking" },
          { type: "tool", id: "tool1", name: "read", state: {
            status: "completed", input: { path: "README.md" }, content: [{ type: "text", text: "contents" }], result: { ok: true },
          }, time: { created: 3, completed: 4 } },
        ],
      },
    ], cursor: {} }, "ses_123")
    assert.equal(messages.length, 2)
    assert.equal(messages[0]?.parts[0] && (messages[0].parts[0] as { text?: string }).text, "hello")
    assert.equal(messages[1]?.parts[0] && (messages[1].parts[0] as { text?: string }).text, "answer")
    assert.equal(messages[1]?.parts[1] && (messages[1].parts[1] as { text?: string }).text, "thinking")
    const tool = messages[1]?.parts[2] as { state?: { output?: string; result?: unknown } } | undefined
    assert.equal(tool?.state?.output, "contents")
    assert.deepEqual(tool?.state?.result, { ok: true })
  })

  it("maps prompt admission to a user message", () => {
    const admitted = mapOpenCode2PromptAdmission({
      id: "u2", timeCreated: 12, prompt: { text: "queued input" },
    }, "ses_123")
    assert.equal(admitted.info.id, "u2")
    assert.equal((admitted.parts[0] as { text: string }).text, "queued input")
  })

  it("unwraps the generated SDK response envelope for pages and admissions", () => {
    const messages = mapOpenCode2MessagePage({
      data: { data: [{ id: "u1", type: "user", time: { created: 1 }, text: "wrapped" }], cursor: {} },
    }, "ses_123")
    const admitted = mapOpenCode2PromptAdmission({
      data: { id: "u2", timeCreated: 2, prompt: { text: "wrapped prompt" } },
    }, "ses_123")
    assert.equal((messages[0]?.parts[0] as { text?: string } | undefined)?.text, "wrapped")
    assert.equal((admitted.parts[0] as { text: string }).text, "wrapped prompt")
  })
})
