import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..", "..")
const bundleDir = path.join(repoRoot, ".coverage-bundles")
const bundlePath = path.join(bundleDir, "opencode-event-normalizer.cjs")

function loadNormalizer() {
  execFileSync("npx", [
    "esbuild",
    "src/session/EventNormalizer.ts",
    "--bundle",
    "--platform=node",
    "--format=cjs",
    `--outfile=${bundlePath}`,
  ], {
    cwd: repoRoot,
    stdio: "pipe",
  })

  delete createRequire(import.meta.url).cache?.[bundlePath]
  return createRequire(import.meta.url)(bundlePath)
}

function collect(events) {
  const { createSdkEventNormalizer } = loadNormalizer()
  const normalizer = createSdkEventNormalizer()
  return events.flatMap((event) => normalizer.normalize(event))
}

test("normalizes the live OpenCode assistant stream without user echo or fake skill events", () => {
  const sessionID = "ses_test"
  const userID = "msg_user"
  const assistantID = "msg_assistant"
  const textPartID = "part_text"

  const normalized = collect([
    { type: "message.updated", properties: { info: { id: userID, sessionID, role: "user", time: { created: 1 } } } },
    { type: "message.part.updated", properties: { part: { id: "user_part", sessionID, messageID: userID, type: "text", text: "hello" } } },
    { type: "message.updated", properties: { info: { id: assistantID, sessionID, role: "assistant", time: { created: 2 } } } },
    { type: "message.part.updated", properties: { part: { id: "step", sessionID, messageID: assistantID, type: "step-start" } } },
    { type: "message.part.updated", properties: { part: { id: "reason", sessionID, messageID: assistantID, type: "reasoning", text: "thinking" } } },
    { type: "message.part.updated", properties: { part: { id: textPartID, sessionID, messageID: assistantID, type: "text", text: "" } } },
    { type: "message.part.delta", properties: { sessionID, messageID: assistantID, partID: textPartID, delta: "OK" } },
    { type: "message.part.updated", properties: { part: { id: textPartID, sessionID, messageID: assistantID, type: "text", text: "OK" } } },
    { type: "message.part.updated", properties: { part: { id: "finish", sessionID, messageID: assistantID, type: "step-finish" } } },
    { type: "message.updated", properties: { info: { id: assistantID, sessionID, role: "assistant", time: { created: 2 }, finish: "stop" } } },
    { type: "message.updated", properties: { info: { id: assistantID, sessionID, role: "assistant", time: { created: 2, completed: 3 }, finish: "stop" } } },
  ])

  assert.deepEqual(normalized.map((event) => event.type), ["text_chunk", "message_complete"])
  assert.equal(normalized[0].sessionId, sessionID)
  assert.deepEqual(normalized[0].data, { text: "OK", messageId: assistantID })
  assert.equal(normalized[1].sessionId, sessionID)
})

test("dedupes repeated running tool updates but keeps terminal tool results", () => {
  const sessionID = "ses_test"
  const assistantID = "msg_assistant"

  const normalized = collect([
    { type: "message.updated", properties: { info: { id: assistantID, sessionID, role: "assistant", time: { created: 1 } } } },
    { type: "message.part.updated", properties: { part: { id: "tool_1", sessionID, messageID: assistantID, type: "tool", tool: "read", state: { status: "running", input: { file: "a.ts" } } } } },
    { type: "message.part.updated", properties: { part: { id: "tool_1", sessionID, messageID: assistantID, type: "tool", tool: "read", state: { status: "running", input: { file: "a.ts" } } } } },
    { type: "message.part.updated", properties: { part: { id: "tool_1", sessionID, messageID: assistantID, type: "tool", tool: "read", state: { status: "completed", input: { file: "a.ts" }, output: "done" } } } },
  ])

  assert.deepEqual(normalized.map((event) => event.type), ["tool_start", "tool_end"])
  assert.deepEqual(normalized[0].data, { id: "tool_1", tool: "read", input: { file: "a.ts" }, status: "running" })
  assert.deepEqual(normalized[1].data, { id: "tool_1", tool: "read", result: "done", ok: true })
})

test("normalizes session and permission lifecycle events", () => {
  const sessionID = "ses_test"

  const normalized = collect([
    { type: "session.status", properties: { sessionID, status: { type: "busy" } } },
    { type: "session.idle", properties: { sessionID } },
    { type: "permission.updated", properties: { id: "perm_1", sessionID, title: "Allow read?" } },
    { type: "permission.replied", properties: { sessionID, permissionID: "perm_1", response: "once" } },
  ])

  assert.deepEqual(normalized.map((event) => event.type), [
    "session_status",
    "session_status",
    "permission_request",
    "permission_replied",
  ])
  assert.deepEqual(normalized[0].data, { status: { type: "busy" } })
  assert.deepEqual(normalized[1].data, { status: { type: "idle" } })
  assert.equal(normalized[2].sessionId, sessionID)
  assert.equal(normalized[3].sessionId, sessionID)
})
