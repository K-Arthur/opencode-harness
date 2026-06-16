import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..", "..")
const bundleDir = path.join(repoRoot, ".coverage-bundles")
const bundlePath = path.join(bundleDir, "session-client-question.cjs")
const vscodeStubPath = path.join(bundleDir, "vscode-stub.js")

function loadSessionClient() {
  mkdirSync(bundleDir, { recursive: true })
  writeFileSync(vscodeStubPath, `
module.exports = {
  window: { createOutputChannel: () => ({ appendLine: () => {}, append: () => {}, show: () => {}, dispose: () => {} }) },
  workspace: { getConfiguration: () => ({ get: () => false }) },
}
`)
  execFileSync("npx", [
    "esbuild",
    "src/session/SessionClient.ts",
    "--bundle",
    "--platform=node",
    "--format=cjs",
    `--alias:vscode=${vscodeStubPath}`,
    `--outfile=${bundlePath}`,
  ], { cwd: repoRoot, stdio: "pipe" })

  delete createRequire(import.meta.url).cache?.[bundlePath]
  return createRequire(import.meta.url)(bundlePath)
}

const { SessionClient } = loadSessionClient()

// getV2Client is the 3rd constructor arg: (mcp?, disposed?, getV2Client?)
function makeClientWithV2(v2) {
  return new SessionClient(undefined, () => false, () => v2)
}

// ─────────────────────────────────────────────────────────────────────────────
// CRITICAL: Smoke test against the REAL @opencode-ai/sdk OpencodeClient.
// This guards against SDK shape drift. The previous bug (v0.3.73) called
// `client.session.question.reply(...)` — but `client.session` (Session2) has
// NO `question` getter. The correct path is `client.v2.session.question`
// (Session3 → Question2 → POST /api/session/{sessionID}/question/{requestID}/reply).
// Without this smoke test, unit tests using hand-rolled mocks can silently
// codify the WRONG path and pass while production crashes with
// "Cannot read properties of undefined (reading 'reply')".
// ─────────────────────────────────────────────────────────────────────────────
test("SDK shape contract: OpencodeClient.v2.session.question.{reply,reject} are functions", async () => {
  const { OpencodeClient } = await import("@opencode-ai/sdk/v2/client")
  const client = new OpencodeClient({ baseUrl: "http://127.0.0.1:1" })
  assert.equal(typeof client.v2?.session?.question?.reply, "function",
    "client.v2.session.question.reply must be a function — if this fails the SDK shape changed and SessionClient.ts must be updated")
  assert.equal(typeof client.v2?.session?.question?.reject, "function",
    "client.v2.session.question.reject must be a function")
})

test("SDK shape contract: client.session has NO question getter (regression sentinel)", async () => {
  const { OpencodeClient } = await import("@opencode-ai/sdk/v2/client")
  const client = new OpencodeClient({ baseUrl: "http://127.0.0.1:1" })
  assert.equal(client.session.question, undefined,
    "client.session must NOT expose .question — calling it was the v0.3.73 crash. If the SDK adds it, this test and SessionClient.ts should be revisited.")
})

// ── replyToQuestion / rejectQuestion — REAL SDK shape ──────────────────────
// The v2 client nests session-scoped question under `client.v2.session.question`,
// NOT `client.session.question`. These tests use the real shape.

test("replyToQuestion calls client.v2.session.question.reply with sessionID + requestID + questionV2Reply", async () => {
  const calls = []
  const v2 = {
    v2: {
      session: {
        question: {
          reply: async (p) => { calls.push(p); return {} },
          reject: async () => ({}),
        },
      },
    },
  }
  await makeClientWithV2(v2).replyToQuestion("ses_1", "req_1", [["A"], ["B"]])
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { sessionID: "ses_1", requestID: "req_1", questionV2Reply: { answers: [["A"], ["B"]] } })
})

test("rejectQuestion calls client.v2.session.question.reject with sessionID + requestID", async () => {
  const calls = []
  const v2 = {
    v2: {
      session: {
        question: {
          reply: async () => ({}),
          reject: async (p) => { calls.push(p); return {} },
        },
      },
    },
  }
  await makeClientWithV2(v2).rejectQuestion("ses_2", "req_2")
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { sessionID: "ses_2", requestID: "req_2" })
})

test("replyToQuestion throws 'Server not running' when no v2 client", async () => {
  const sc = new SessionClient(undefined, () => false, () => null)
  await assert.rejects(sc.replyToQuestion("ses_x", "req_x", [["A"]]), /Server not running/)
})

test("replyToQuestion surfaces a server-side error from the v2 response", async () => {
  const v2 = {
    v2: {
      session: {
        question: {
          reply: async () => ({ error: { message: "bad request" } }),
          reject: async () => ({}),
        },
      },
    },
  }
  await assert.rejects(makeClientWithV2(v2).replyToQuestion("ses_3", "req_3", [["A"]]), /Question reply failed/)
})

test("rejectQuestion surfaces a server-side error from the v2 response", async () => {
  const v2 = {
    v2: {
      session: {
        question: {
          reply: async () => ({}),
          reject: async () => ({ error: { message: "nope" } }),
        },
      },
    },
  }
  await assert.rejects(makeClientWithV2(v2).rejectQuestion("ses_4", "req_4"), /Question reject failed/)
})

// ── Regression: the v0.3.73 crash path ──────────────────────────────────────
// The old code read `client.session.question.reply`. Session2 has no `question`
// getter, so this threw "Cannot read properties of undefined (reading 'reply')".
// We must NEVER regress to that path. Simulate a client that has the OLD shape
// (no v2 nesting) and assert we get a CLEAR error, not a cryptic TypeError.

test("regression v0.3.73: client without v2.session.question yields a clear actionable error, not 'Cannot read reply of undefined'", async () => {
  // Old/legacy client shape: session exists but no question getter, and no v2 nest.
  const legacyV2 = { session: { abort: async () => ({}) } }
  const sc = makeClientWithV2(legacyV2)
  await assert.rejects(
    sc.replyToQuestion("ses_1", "req_1", [["A"]]),
    (err) => {
      const msg = err instanceof Error ? err.message : String(err)
      // Must NOT be the cryptic TypeError from v0.3.73
      assert.ok(!msg.includes("reading 'reply'"),
        `regression: must not surface 'Cannot read properties of undefined (reading reply)'. Got: ${msg}`)
      assert.ok(!msg.includes("reading 'reject'"),
        `regression: must not surface 'Cannot read properties of undefined (reading reject)'. Got: ${msg}`)
      // Must be a clear, searchable error
      assert.ok(/question.*(API|unsupported|unavailable)|SDK.*(question|shape)|unsupported/i.test(msg),
        `regression: error must explain the SDK question API is unavailable. Got: ${msg}`)
      return true
    },
  )
})

test("regression v0.3.73: rejectQuestion on legacy client shape yields clear error", async () => {
  const legacyV2 = { session: { abort: async () => ({}) } }
  const sc = makeClientWithV2(legacyV2)
  await assert.rejects(
    sc.rejectQuestion("ses_1", "req_1"),
    (err) => {
      const msg = err instanceof Error ? err.message : String(err)
      assert.ok(!msg.includes("reading 'reject'"), `regression: ${msg}`)
      return true
    },
  )
})

// ── Edge case: defensive guard when v2.session exists but v2.session.question is missing ─
test("edge: client.v2.session present but .question missing yields clear error (partial SDK)", async () => {
  const partialV2 = { v2: { session: { list: async () => ({}) } } }
  const sc = makeClientWithV2(partialV2)
  await assert.rejects(
    sc.replyToQuestion("ses_1", "req_1", [["A"]]),
    (err) => {
      const msg = err instanceof Error ? err.message : String(err)
      assert.ok(!msg.includes("reading 'reply'"), `edge: ${msg}`)
      return true
    },
  )
})

// ── Edge case: disposed client ──────────────────────────────────────────────
test("replyToQuestion on disposed client throws disposed error", async () => {
  const sc = new SessionClient(undefined, () => true, () => null)
  await assert.rejects(sc.replyToQuestion("s", "r", [["A"]]), /disposed/i)
})

// ── Edge case: empty/null answers should be normalized, not crash ───────────
test("replyToQuestion with empty answers still forwards (server validates)", async () => {
  const calls = []
  const v2 = {
    v2: {
      session: {
        question: {
          reply: async (p) => { calls.push(p); return {} },
          reject: async () => ({}),
        },
      },
    },
  }
  // Empty answers array — forward as-is, let the server reject if invalid.
  // The host must not invent answers or crash.
  await makeClientWithV2(v2).replyToQuestion("ses_e", "req_e", [])
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].questionV2Reply, { answers: [] })
})

// ── Edge case: answers with empty inner arrays / mixed ──────────────────────
test("replyToQuestion preserves structured multi-group answers including empties", async () => {
  const calls = []
  const v2 = {
    v2: {
      session: {
        question: {
          reply: async (p) => { calls.push(p); return {} },
          reject: async () => ({}),
        },
      },
    },
  }
  await makeClientWithV2(v2).replyToQuestion("ses_m", "req_m", [["A"], [], ["C", "D"]])
  assert.deepEqual(calls[0].questionV2Reply, { answers: [["A"], [], ["C", "D"]] })
})

// ── Edge case: null/undefined response from SDK (network/parse issue) ───────
test("replyToQuestion tolerates null/undefined response without throwing on resp.error", async () => {
  const v2 = {
    v2: {
      session: {
        question: {
          reply: async () => null,
          reject: async () => ({}),
        },
      },
    },
  }
  // Must not throw "Cannot read properties of null (reading 'error')"
  await makeClientWithV2(v2).replyToQuestion("ses_n", "req_n", [["A"]])
})

test("rejectQuestion tolerates null/undefined response without throwing on resp.error", async () => {
  const v2 = {
    v2: {
      session: {
        question: {
          reply: async () => ({}),
          reject: async () => undefined,
        },
      },
    },
  }
  await makeClientWithV2(v2).rejectQuestion("ses_n", "req_n")
})

// ── Edge case: SDK throws synchronously / async ─────────────────────────────
test("replyToQuestion propagates SDK network errors", async () => {
  const v2 = {
    v2: {
      session: {
        question: {
          reply: async () => { throw new Error("ECONNREFUSED") },
          reject: async () => ({}),
        },
      },
    },
  }
  await assert.rejects(makeClientWithV2(v2).replyToQuestion("s", "r", [["A"]]), /ECONNREFUSED/)
})

// --- Phase 2: safe void/ack session calls migrated to the v2 client ----------------
// These pin the v1 -> v2 param-shape transform: v1 nested `{ path: { id } }` /
// `{ body: { messageID } }` becomes v2 FLAT `{ sessionID, messageID }`.

test("abortSession calls v2 session.abort with a flat sessionID", async () => {
  const calls = []
  const v2 = { session: { abort: async (p) => { calls.push(p); return {} } } }
  const result = await new SessionClient(undefined, () => false, () => v2).abortSession("ses_1")
  assert.equal(result, true)
  assert.deepEqual(calls[0], { sessionID: "ses_1" })
})

test("deleteSession calls v2 session.delete with a flat sessionID", async () => {
  const calls = []
  const v2 = { session: { delete: async (p) => { calls.push(p); return {} } } }
  await new SessionClient(undefined, () => false, () => v2).deleteSession("ses_2")
  assert.deepEqual(calls[0], { sessionID: "ses_2" })
})

test("revertMessage calls v2 session.revert with flat sessionID + messageID", async () => {
  const calls = []
  const v2 = { session: { revert: async (p) => { calls.push(p); return {} } } }
  await new SessionClient(undefined, () => false, () => v2).revertMessage("ses_3", "msg_9")
  assert.deepEqual(calls[0], { sessionID: "ses_3", messageID: "msg_9" })
})

test("migrated session calls require the v2 client (Server not running otherwise)", async () => {
  const sc = new SessionClient(undefined, () => false, () => null)
  await assert.rejects(sc.abortSession("ses_x"), /Server not running/)
})
