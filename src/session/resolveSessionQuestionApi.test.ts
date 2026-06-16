import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { resolveSessionQuestionApi } from "./resolveSessionQuestionApi"
import type { V2OpencodeClient } from "./opencodeClientFactory"

/**
 * Mirrors the real @opencode-ai/sdk generated client shape: each namespace
 * class stores `client` as an instance field set at construction, and its
 * methods read `this.client` at call time (e.g. `reply()` does
 * `this.client.post(...)`). A plain mock `{ reply: () => ... }` doesn't
 * exercise this — only a real method relying on `this` catches a caller
 * that extracts `reply`/`reject` and invokes them off their receiver.
 */
function makeFakeV2ClientWithQuestionApi(): V2OpencodeClient {
  const httpClient = {
    post: async (args: Record<string, unknown>) => ({ data: { ok: true, args }, error: undefined }),
  }
  class FakeQuestion {
    constructor(private readonly client: typeof httpClient) {}
    reply(params: Record<string, unknown>) {
      return this.client.post(params)
    }
    reject(params: Record<string, unknown>) {
      return this.client.post(params)
    }
  }
  const question = new FakeQuestion(httpClient)
  return { v2: { session: { question } } } as unknown as V2OpencodeClient
}

void describe("resolveSessionQuestionApi", () => {
  // Regression test for the v0.3.76 crash: "Cannot read properties of
  // undefined (reading 'post')". The bug: reply/reject were extracted as
  // bare function references and returned in a plain { reply, reject }
  // object. Calling `api.reply(...)` then ran the SDK method with `this`
  // bound to that wrapper (no `.client` field) instead of the real
  // `question` instance, so `this.client.post(...)` threw inside the SDK.
  void it("returned reply() keeps its receiver bound to the question instance", async () => {
    const client = makeFakeV2ClientWithQuestionApi()
    const api = resolveSessionQuestionApi(client)
    const result = await api.reply({ sessionID: "ses_1", requestID: "req_1", questionV2Reply: { answers: [["yes"]] } })
    assert.equal((result as { data: { ok: boolean } }).data.ok, true)
  })

  void it("returned reject() keeps its receiver bound to the question instance", async () => {
    const client = makeFakeV2ClientWithQuestionApi()
    const api = resolveSessionQuestionApi(client)
    await assert.doesNotReject(() => api.reject({ sessionID: "ses_1", requestID: "req_1" }))
  })

  void it("throws a clear error when v2 namespace is missing", () => {
    const client = {} as V2OpencodeClient
    assert.throws(() => resolveSessionQuestionApi(client), /does not expose the v2 session namespace/)
  })

  void it("throws a clear error when v2.session is missing", () => {
    const client = { v2: {} } as unknown as V2OpencodeClient
    assert.throws(() => resolveSessionQuestionApi(client), /does not expose v2\.session/)
  })

  void it("throws a clear error when v2.session.question is missing", () => {
    const client = { v2: { session: {} } } as unknown as V2OpencodeClient
    assert.throws(() => resolveSessionQuestionApi(client), /does not expose v2\.session\.question/)
  })

  void it("throws a clear error when reply/reject are not callable", () => {
    const client = { v2: { session: { question: { reply: null, reject: null } } } } as unknown as V2OpencodeClient
    assert.throws(() => resolveSessionQuestionApi(client), /are not callable/)
  })
})
