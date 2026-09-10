import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { V2OpencodeClient } from "./opencodeClientFactory"
import { SessionClient } from "./SessionClient"

function makeClient(calls: Record<string, unknown[]>): V2OpencodeClient {
  const recordCall = (name: string, value: unknown): void => { calls[name] ??= []; calls[name]!.push(value) }
  const session = {
    create: async (params: unknown) => { recordCall("create", params); return { data: { data: { id: "ses_1", projectID: "p", title: "A", location: { directory: "/workspace" }, time: { created: 1, updated: 1 }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } } } } },
    get: async (params: unknown) => { recordCall("get", params); return { data: { data: { id: "ses_1", projectID: "p", title: "A", location: { directory: "/workspace" }, time: { created: 1, updated: 1 }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } } } } },
    list: async (params: unknown) => { recordCall("list", params); return { data: { data: [], cursor: {} } } },
    messages: async (params: unknown) => { recordCall("messages", params); return { data: { data: { data: [{ id: "u1", type: "user", time: { created: 1 }, text: "hello" }], cursor: {} } } } },
    switchModel: async (params: unknown) => { recordCall("switchModel", params); return { data: {} } },
    switchAgent: async (params: unknown) => { recordCall("switchAgent", params); return { data: {} } },
    prompt: async (params: unknown) => { recordCall("prompt", params); return { data: { data: { id: "u2", timeCreated: 2, prompt: { text: "hello" }, delivery: "queue", admittedSeq: 1, sessionID: "ses_1" } } } },
    compact: async (params: unknown) => { recordCall("compact", params); return { data: {} } },
    interrupt: async (params: unknown) => { recordCall("interrupt", params); return { data: {} } },
    command: async () => ({ data: [] }),
  }
  return { v2: { session, command: { list: async () => ({ data: { data: [] } }) } } } as unknown as V2OpencodeClient
}

describe("SessionClient OpenCode 2 adapter", () => {
  it("uses nested V2 session methods and maps their responses", async () => {
    const calls: Record<string, unknown[]> = {}
    const client = new SessionClient(undefined, () => false, () => makeClient(calls), () => "opencode2", () => "/workspace")
    const created = await client.createSession("A")
    const listed = await client.listSessions()
    const messages = await client.getMessages("ses_1")
    assert.equal(created.id, "ses_1")
    assert.deepEqual(listed, [])
    assert.equal((messages[0]?.info as { id?: string } | undefined)?.id, "u1")
    assert.deepEqual(calls.create?.[0], { title: "A", location: { directory: "/workspace" } })
    assert.deepEqual(calls.list?.[0], { directory: "/workspace" })
    assert.deepEqual(calls.messages?.[0], { sessionID: "ses_1" })
  })

  it("selects model and agent before admitting an OpenCode 2 prompt", async () => {
    const calls: Record<string, unknown[]> = {}
    const client = new SessionClient(undefined, () => false, () => makeClient(calls), () => "opencode2")
    client.setModel("provider", "model")
    const admitted = await client.sendPrompt("ses_1", [{ type: "text", text: "hello" }], { agent: "build", variant: "fast" })
    assert.equal(admitted.info.id, "u2")
    assert.equal(calls.switchModel?.length, 1)
    assert.equal(calls.switchAgent?.length, 1)
    assert.equal(calls.prompt?.length, 1)
    assert.deepEqual(calls.prompt?.[0], { sessionID: "ses_1", prompt: { text: "hello" } })
  })

  it("does not expose legacy diff operations as if OpenCode 2 supported them", async () => {
    const client = new SessionClient(undefined, () => false, () => makeClient({}), () => "opencode2")
    await assert.rejects(() => client.getSessionDiff("ses_1"), /not available on the verified OpenCode 2 API surface/)
  })
})
