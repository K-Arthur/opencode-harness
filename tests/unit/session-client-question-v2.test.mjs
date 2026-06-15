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

// getV2Client is the 4th constructor arg: (getClient, mcp?, disposed?, getV2Client?)
function makeClientWithV2(v2) {
  return new SessionClient(() => ({}), undefined, () => false, () => v2)
}

test("replyToQuestion calls the v2 question.reply with requestID + answers", async () => {
  const calls = []
  const v2 = { question: { reply: async (p) => { calls.push(p); return {} }, reject: async () => ({}) } }
  await makeClientWithV2(v2).replyToQuestion("req_1", [["A"], ["B"]])
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { requestID: "req_1", answers: [["A"], ["B"]] })
})

test("rejectQuestion calls the v2 question.reject with requestID", async () => {
  const calls = []
  const v2 = { question: { reply: async () => ({}), reject: async (p) => { calls.push(p); return {} } } }
  await makeClientWithV2(v2).rejectQuestion("req_2")
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], { requestID: "req_2" })
})

test("replyToQuestion throws 'Server not running' (not 'API unavailable') when no v2 client", async () => {
  // Regression: previously the v1 client lacked a `question` API and this threw
  // "OpenCode question reply API is unavailable", which rolled back the optimistic
  // answer and left the question panel stuck. Now the absence is just "not running".
  const sc = new SessionClient(() => ({}), undefined, () => false, () => null)
  await assert.rejects(sc.replyToQuestion("req_x", [["A"]]), /Server not running/)
})

test("replyToQuestion surfaces a server-side error from the v2 response", async () => {
  const v2 = { question: { reply: async () => ({ error: { message: "bad request" } }), reject: async () => ({}) } }
  await assert.rejects(makeClientWithV2(v2).replyToQuestion("req_3", [["A"]]), /Question reply failed/)
})

test("rejectQuestion surfaces a server-side error from the v2 response", async () => {
  const v2 = { question: { reply: async () => ({}), reject: async () => ({ error: { message: "nope" } }) } }
  await assert.rejects(makeClientWithV2(v2).rejectQuestion("req_4"), /Question reject failed/)
})

// --- Phase 2: safe void/ack session calls migrated to the v2 client ----------------
// These pin the v1 -> v2 param-shape transform: v1 nested `{ path: { id } }` /
// `{ body: { messageID } }` becomes v2 FLAT `{ sessionID, messageID }`.

test("abortSession calls v2 session.abort with a flat sessionID", async () => {
  const calls = []
  const v2 = { session: { abort: async (p) => { calls.push(p); return {} } } }
  const result = await new SessionClient(() => ({}), undefined, () => false, () => v2).abortSession("ses_1")
  assert.equal(result, true)
  assert.deepEqual(calls[0], { sessionID: "ses_1" })
})

test("deleteSession calls v2 session.delete with a flat sessionID", async () => {
  const calls = []
  const v2 = { session: { delete: async (p) => { calls.push(p); return {} } } }
  await new SessionClient(() => ({}), undefined, () => false, () => v2).deleteSession("ses_2")
  assert.deepEqual(calls[0], { sessionID: "ses_2" })
})

test("revertMessage calls v2 session.revert with flat sessionID + messageID", async () => {
  const calls = []
  const v2 = { session: { revert: async (p) => { calls.push(p); return {} } } }
  await new SessionClient(() => ({}), undefined, () => false, () => v2).revertMessage("ses_3", "msg_9")
  assert.deepEqual(calls[0], { sessionID: "ses_3", messageID: "msg_9" })
})

test("migrated session calls require the v2 client (Server not running otherwise)", async () => {
  const sc = new SessionClient(() => ({}), undefined, () => false, () => null)
  await assert.rejects(sc.abortSession("ses_x"), /Server not running/)
})
