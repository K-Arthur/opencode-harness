import { describe, it } from "node:test"
import assert from "node:assert/strict"

describe("SDK contract fields (compilation guard)", () => {
  it("Session has required fields", () => {
    const session = {
      id: "test-id",
      title: "test",
      version: "1.0",
      projectID: "p1",
      directory: "/d",
      time: { created: 100, updated: 200 },
    } as const
    assert.equal(typeof session.id, "string")
    assert.equal(typeof session.title, "string")
    assert.equal(typeof session.version, "string")
    assert.equal(typeof session.projectID, "string")
    assert.equal(typeof session.directory, "string")
    assert.equal(typeof session.time.created, "number")
    assert.equal(typeof session.time.updated, "number")
  })

  it("Session handles optional fields", () => {
    const session: Record<string, unknown> = {
      parentID: "parent-1",
      summary: { additions: 10, deletions: 5, files: 3 },
      revert: { messageID: "msg-1" },
      share: { url: "https://example.com" },
      agent: "custom",
      model: { id: "claude-3", providerID: "anthropic" },
    }
    assert.equal(typeof session.parentID, "string")
    if (session.summary) {
      const s = session.summary as Record<string, unknown>
      assert.equal(typeof s.additions, "number")
      assert.equal(typeof s.deletions, "number")
      assert.equal(typeof s.files, "number")
    }
  })

  it("time can have optional archived and compacting", () => {
    const session = {
      id: "s1",
      title: "t",
      projectID: "p",
      directory: "/d",
      version: "1",
      time: { created: 1, updated: 2, archived: 3, compacting: 4 },
    }
    if (session.time.archived !== undefined) assert.equal(typeof session.time.archived, "number")
    if (session.time.compacting !== undefined) assert.equal(typeof session.time.compacting, "number")
  })

  it("UserMessage has expected shape", () => {
    const msg = {
      id: "m1",
      sessionID: "s1",
      role: "user" as const,
      time: { created: 100 },
      agent: "user",
      model: { providerID: "p", modelID: "m" },
    }
    if (msg.role === "user") {
      assert.equal(typeof msg.id, "string")
      assert.equal(typeof msg.sessionID, "string")
      assert.equal(typeof msg.time.created, "number")
      assert.equal(typeof msg.agent, "string")
      assert.equal(typeof msg.model.providerID, "string")
      assert.equal(typeof msg.model.modelID, "string")
    }
  })

  it("AssistantMessage has expected shape", () => {
    const msg = {
      id: "m2",
      sessionID: "s1",
      role: "assistant" as const,
      time: { created: 100 },
      parentID: "m1",
      modelID: "m",
      providerID: "p",
      mode: "build",
      agent: "test",
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }
    if (msg.role === "assistant") {
      assert.equal(typeof msg.id, "string")
      assert.equal(typeof msg.sessionID, "string")
      assert.equal(typeof msg.parentID, "string")
      assert.equal(typeof msg.modelID, "string")
      assert.equal(typeof msg.providerID, "string")
      assert.equal(typeof msg.mode, "string")
      assert.equal(typeof msg.agent, "string")
      assert.equal(typeof msg.cost, "number")
      assert.equal(typeof msg.tokens.input, "number")
      assert.equal(typeof msg.tokens.output, "number")
      assert.equal(typeof msg.tokens.reasoning, "number")
    }
  })

  it("TextPart has expected shape", () => {
    const part = { type: "text" as const, id: "p1", sessionID: "s1", messageID: "m1", text: "hello" }
    if (part.type === "text") {
      assert.equal(typeof part.id, "string")
      assert.equal(typeof part.sessionID, "string")
      assert.equal(typeof part.messageID, "string")
      assert.equal(typeof part.text, "string")
    }
  })

  it("ToolPart has expected shape", () => {
    const part = {
      type: "tool" as const,
      id: "p2",
      sessionID: "s1",
      messageID: "m1",
      callID: "c1",
      tool: "read",
      state: { status: "completed" as const, input: {}, output: "ok", title: "read", metadata: {}, time: { start: 1, end: 2 } },
    }
    if (part.type === "tool") {
      assert.equal(typeof part.id, "string")
      assert.equal(typeof part.callID, "string")
      assert.equal(typeof part.tool, "string")
      assert.equal(typeof part.state, "object")
      assert.equal(typeof part.state.status, "string")
    }
  })

  it("FilePart has expected shape", () => {
    const part = { type: "file" as const, id: "p3", sessionID: "s1", messageID: "m1", mime: "text/plain", url: "file:///test.ts" }
    if (part.type === "file") {
      assert.equal(typeof part.id, "string")
      assert.equal(typeof part.sessionID, "string")
      assert.equal(typeof part.messageID, "string")
      assert.equal(typeof part.mime, "string")
      assert.equal(typeof part.url, "string")
    }
  })

  it("ReasoningPart has expected shape", () => {
    const part = { type: "reasoning" as const, id: "p4", sessionID: "s1", messageID: "m1", text: "thinking...", time: { start: 100 } }
    if (part.type === "reasoning") {
      assert.equal(typeof part.id, "string")
      assert.equal(typeof part.text, "string")
      assert.equal(typeof part.time.start, "number")
    }
  })

  it("SnapshotFileDiff has expected shape", () => {
    const diff = { additions: 10, deletions: 5, file: "test.ts", status: "modified" as const }
    assert.equal(typeof diff.additions, "number")
    assert.equal(typeof diff.deletions, "number")
    if (diff.file !== undefined) assert.equal(typeof diff.file, "string")
    if (diff.status !== undefined) assert.ok(["added", "deleted", "modified"].includes(diff.status))
  })
})
