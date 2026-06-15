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
const bundlePath = path.join(bundleDir, "session-client-v2-domain.cjs")
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

// --- Phase 2b: domain-returning session calls ----------------------------------------
// Each test verifies:
//   1. The v2 method was called with FLAT params (not v1 nested `{ path: { id } }`)
//   2. The return value has the correct v1-typed shape (through the mapper)

function makeFakeSession(id, title) {
  return {
    id,
    projectID: "proj_1",
    directory: "/tmp/test",
    slug: id,
    workspaceID: "ws_1",
    title: title ?? "Test Session",
    version: "1",
    time: { created: 1000, updated: 2000 },
  }
}

function makeV2SessionResponse(id, title) {
  return { data: makeFakeSession(id, title), error: undefined }
}

test("getSession calls v2 session.get with flat sessionID and maps response", async () => {
  const calls = []
  const v2 = {
    session: {
      get: async (p) => { calls.push(p); return makeV2SessionResponse("ses_1") },
    },
  }
  const result = await new SessionClient(() => ({}), undefined, () => false, () => v2).getSession("ses_1")
  assert.equal(result.id, "ses_1")
  assert.equal(result.title, "Test Session")
  assert.equal(result.projectID, "proj_1")
  assert.equal(result.directory, "/tmp/test")
  assert.deepEqual(result.time.created, 1000)
  assert.deepEqual(result.time.updated, 2000)
  assert.deepEqual(calls[0], { sessionID: "ses_1" })
})

test("createSession calls v2 session.create with flat title and maps response", async () => {
  const calls = []
  const v2 = {
    session: {
      create: async (p) => { calls.push(p); return makeV2SessionResponse("ses_2", "New Session") },
    },
  }
  const result = await new SessionClient(() => ({}), undefined, () => false, () => v2).createSession("New Session")
  assert.equal(result.id, "ses_2")
  assert.equal(result.title, "New Session")
  assert.deepEqual(calls[0], { title: "New Session" })
})

test("createSession with no title still works", async () => {
  const calls = []
  const v2 = {
    session: {
      create: async (p) => { calls.push(p); return makeV2SessionResponse("ses_3") },
    },
  }
  const result = await new SessionClient(() => ({}), undefined, () => false, () => v2).createSession()
  assert.equal(result.id, "ses_3")
  assert.deepEqual(calls[0], { title: undefined })
})

test("updateSessionTitle calls v2 session.update with flat sessionID + title", async () => {
  const calls = []
  const v2 = {
    session: {
      update: async (p) => { calls.push(p); return makeV2SessionResponse("ses_1", "Updated") },
    },
  }
  const result = await new SessionClient(() => ({}), undefined, () => false, () => v2).updateSessionTitle("ses_1", "Updated")
  assert.equal(result.title, "Updated")
  assert.deepEqual(calls[0], { sessionID: "ses_1", title: "Updated" })
})

test("getSession throws on v2 error", async () => {
  const v2 = {
    session: {
      get: async () => ({ data: undefined, error: { message: "not found" } }),
    },
  }
  await assert.rejects(
    new SessionClient(() => ({}), undefined, () => false, () => v2).getSession("ses_x"),
    /Failed to get session/,
  )
})

test("createSession throws on v2 error", async () => {
  const v2 = {
    session: {
      create: async () => ({ data: undefined, error: { message: "bad request" } }),
    },
  }
  await assert.rejects(
    new SessionClient(() => ({}), undefined, () => false, () => v2).createSession("fail"),
    /Failed to create session/,
  )
})

test("updateSessionTitle throws on v2 error", async () => {
  const v2 = {
    session: {
      update: async () => ({ data: undefined, error: { message: "no session" } }),
    },
  }
  await assert.rejects(
    new SessionClient(() => ({}), undefined, () => false, () => v2).updateSessionTitle("ses_x", "fail"),
    /Failed to update session title/,
  )
})

// --- Cluster 2: listSessions, getChildSessions ----------------------------------------

test("listSessions calls v2 session.list with no params and maps response", async () => {
  const calls = []
  const v2 = {
    session: {
      list: async (p) => { calls.push(p); return { data: [makeFakeSession("s1", "Session A"), makeFakeSession("s2", "Session B")], error: undefined } },
    },
  }
  const results = await new SessionClient(() => ({}), undefined, () => false, () => v2).listSessions()
  assert.equal(results.length, 2)
  assert.equal(results[0].id, "s1")
  assert.equal(results[1].title, "Session B")
  assert.equal(calls[0], undefined) // v2 session.list() called with no params
})

test("listSessions throws on v2 error", async () => {
  const v2 = {
    session: {
      list: async () => ({ data: undefined, error: { message: "no server" } }),
    },
  }
  await assert.rejects(
    new SessionClient(() => ({}), undefined, () => false, () => v2).listSessions(),
    /Failed to list sessions/,
  )
})

test("getChildSessions calls v2 session.children with flat sessionID and maps response", async () => {
  const calls = []
  const v2 = {
    session: {
      children: async (p) => { calls.push(p); return { data: [makeFakeSession("child_1", "Child Session")], error: undefined } },
    },
  }
  const results = await new SessionClient(() => ({}), undefined, () => false, () => v2).getChildSessions("parent_1")
  assert.equal(results.length, 1)
  assert.equal(results[0].id, "child_1")
  assert.equal(results[0].title, "Child Session")
  assert.deepEqual(calls[0], { sessionID: "parent_1" })
})

test("getChildSessions throws on v2 error", async () => {
  const v2 = {
    session: {
      children: async () => ({ data: undefined, error: { message: "gone" } }),
    },
  }
  await assert.rejects(
    new SessionClient(() => ({}), undefined, () => false, () => v2).getChildSessions("parent_x"),
    /Failed to get child sessions/,
  )
})

// --- Cluster 3: getSessionMessages, getMessages, getToolPartialOutput -----------------

function makeFakeMessage(id, infoOverrides) {
  return { id, sessionID: "ses_1", role: "assistant", time: { created: 1000 }, ...infoOverrides }
}

function makeFakePart(partId, type, overrides) {
  return { id: partId, sessionID: "ses_1", messageID: "msg_1", type, ...overrides }
}

function makeMessagesResponse(messages) {
  return { data: messages, error: undefined }
}

test("getSessionMessages calls v2 session.messages with flat sessionID and maps response", async () => {
  const calls = []
  const v2 = {
    session: {
      messages: async (p) => {
        calls.push(p)
        return makeMessagesResponse([
          { info: makeFakeMessage("msg_1"), parts: [makeFakePart("p1", "text", { text: "hello" })] },
        ])
      },
    },
  }
  const results = await new SessionClient(() => ({}), undefined, () => false, () => v2).getSessionMessages("ses_1")
  assert.equal(results.length, 1)
  assert.equal(results[0].info.id, "msg_1")
  assert.equal(results[0].parts[0].id, "p1")
  assert.deepEqual(calls[0], { sessionID: "ses_1" })
})

test("getSessionMessages throws on v2 error", async () => {
  const v2 = {
    session: {
      messages: async () => ({ data: undefined, error: { message: "not found" } }),
    },
  }
  await assert.rejects(
    new SessionClient(() => ({}), undefined, () => false, () => v2).getSessionMessages("ses_x"),
    /Failed to get session messages/,
  )
})

test("getMessages calls v2 session.messages with flat sessionID + limit and maps response", async () => {
  const calls = []
  const v2 = {
    session: {
      messages: async (p) => {
        calls.push(p)
        return makeMessagesResponse([
          { info: makeFakeMessage("msg_1"), parts: [makeFakePart("p1", "text", { text: "hi" })] },
        ])
      },
    },
  }
  const results = await new SessionClient(() => ({}), undefined, () => false, () => v2).getMessages("ses_1", 10)
  assert.equal(results.length, 1)
  assert.equal(results[0].info.id, "msg_1")
  assert.equal(results[0].parts[0].id, "p1")
  assert.deepEqual(calls[0], { sessionID: "ses_1", limit: 10 })
})

test("getMessages without limit omits limit from params", async () => {
  const calls = []
  const v2 = {
    session: {
      messages: async (p) => {
        calls.push(p)
        return makeMessagesResponse([])
      },
    },
  }
  await new SessionClient(() => ({}), undefined, () => false, () => v2).getMessages("ses_1")
  assert.deepEqual(calls[0], { sessionID: "ses_1" })
})

test("getToolPartialOutput calls v2 session.messages and finds tool part", async () => {
  const calls = []
  const v2 = {
    session: {
      messages: async (p) => {
        calls.push(p)
        return makeMessagesResponse([
          {
            info: makeFakeMessage("msg_1"),
            parts: [
              makeFakePart("p1", "text", { text: "hi" }),
              makeFakePart("p2", "tool", { callID: "call_42", tool: "bash", state: { status: "running", input: {}, stdout: "hello world", time: { start: 1000 } } }),
            ],
          },
        ])
      },
    },
  }
  const result = await new SessionClient(() => ({}), undefined, () => false, () => v2).getToolPartialOutput("ses_1", "call_42")
  assert.equal(result.callId, "call_42")
  assert.equal(result.available, true)
  assert.deepEqual(calls[0], { sessionID: "ses_1" })
})

// --- Cluster 4: sendCommand ----------------------------------------------------------

test("sendCommand calls v2 session.command with flat params and maps response", async () => {
  const calls = []
  const v2 = {
    session: {
      command: async (p) => {
        calls.push(p)
        return { data: { info: makeFakeMessage("msg_cmd"), parts: [makeFakePart("p1", "text", { text: "done" })] }, error: undefined }
      },
    },
  }
  const result = await new SessionClient(() => ({}), undefined, () => false, () => v2).sendCommand("ses_1", "test", "--verbose")
  assert.equal(result.info.id, "msg_cmd")
  assert.equal(result.parts[0].id, "p1")
  assert.deepEqual(calls[0], { sessionID: "ses_1", command: "test", arguments: "--verbose" })
})

test("sendCommand uses empty string for undefined args", async () => {
  const calls = []
  const v2 = {
    session: {
      command: async (p) => {
        calls.push(p)
        return { data: { info: makeFakeMessage("msg_cmd"), parts: [] }, error: undefined }
      },
    },
  }
  await new SessionClient(() => ({}), undefined, () => false, () => v2).sendCommand("ses_1", "test")
  assert.deepEqual(calls[0], { sessionID: "ses_1", command: "test", arguments: "" })
})

// --- Cluster 5: compactSession -------------------------------------------------------

test("compactSession calls v2 session.summarize with flat sessionID", async () => {
  const calls = []
  const v2 = {
    session: {
      summarize: async (p) => { calls.push(p); return { data: true, error: undefined } },
    },
  }
  const result = await new SessionClient(() => ({}), undefined, () => false, () => v2).compactSession("ses_1")
  assert.equal(result, true)
  assert.deepEqual(calls[0], { sessionID: "ses_1" })
})

test("compactSession passes model ref when provided", async () => {
  const calls = []
  const sc = new SessionClient(() => ({}), undefined, () => false, () => ({
    session: { summarize: async (p) => { calls.push(p); return { data: true, error: undefined } } },
  }))
  sc.setModel("provider_1", "model_1")
  await sc.compactSession("ses_1")
  assert.deepEqual(calls[0], { sessionID: "ses_1", providerID: "provider_1", modelID: "model_1" })
})

// --- Cluster 6: getSessionDiff, getSessionTodos --------------------------------------

test("getSessionDiff calls v2 session.diff with flat sessionID", async () => {
  const calls = []
  const v2 = {
    session: {
      diff: async (p) => { calls.push(p); return { data: [{ file: "test.ts", additions: 5, deletions: 3 }], error: undefined } },
    },
  }
  const result = await new SessionClient(() => ({}), undefined, () => false, () => v2).getSessionDiff("ses_1")
  assert.deepEqual(result, [{ file: "test.ts", additions: 5, deletions: 3 }])
  assert.deepEqual(calls[0], { sessionID: "ses_1" })
})

test("getSessionDiff passes messageID when provided", async () => {
  const calls = []
  const v2 = {
    session: {
      diff: async (p) => { calls.push(p); return { data: [], error: undefined } },
    },
  }
  await new SessionClient(() => ({}), undefined, () => false, () => v2).getSessionDiff("ses_1", "msg_9")
  assert.deepEqual(calls[0], { sessionID: "ses_1", messageID: "msg_9" })
})

test("getSessionTodos calls v2 session.todo with flat sessionID", async () => {
  const calls = []
  const v2 = {
    session: {
      todo: async (p) => { calls.push(p); return { data: [{ id: "t1", content: "fix bug", status: "pending", priority: "high" }], error: undefined } },
    },
  }
  const results = await new SessionClient(() => ({}), undefined, () => false, () => v2).getSessionTodos("ses_1")
  assert.equal(results.length, 1)
  assert.equal(results[0].content, "fix bug")
  assert.deepEqual(calls[0], { sessionID: "ses_1" })
})

// --- Cluster 7: readFile, listCommands, listAgents -----------------------------------

test("readFile calls v2 file.read with flat path and directory", async () => {
  const calls = []
  const v2 = {
    file: {
      read: async (p) => { calls.push(p); return { data: { type: "text", content: "hello" }, error: undefined } },
    },
  }
  const result = await new SessionClient(() => ({}), undefined, () => false, () => v2).readFile("src/test.ts", "/repo")
  assert.deepEqual(result, { type: "text", content: "hello" })
  assert.deepEqual(calls[0], { path: "src/test.ts", directory: "/repo" })
})

test("readFile omits directory when not provided", async () => {
  const calls = []
  const v2 = {
    file: {
      read: async (p) => { calls.push(p); return { data: null, error: undefined } },
    },
  }
  await new SessionClient(() => ({}), undefined, () => false, () => v2).readFile("README.md")
  assert.deepEqual(calls[0], { path: "README.md" })
})

test("listCommands calls v2 command.list and maps response", async () => {
  const calls = []
  const v2 = {
    command: {
      list: async (p) => { calls.push(p); return { data: [{ name: "test", template: "npm test" }], error: undefined } },
    },
  }
  const results = await new SessionClient(() => ({}), undefined, () => false, () => v2).listCommands()
  assert.equal(results.length, 1)
  assert.equal(results[0].name, "test")
  assert.equal(calls[0], undefined) // no params
})

test("listAgents calls v2 app.agents and maps native→builtIn", async () => {
  const calls = []
  const v2 = {
    app: {
      agents: async (p) => { calls.push(p); return { data: [{ name: "builder", mode: "primary", native: true }], error: undefined } },
    },
  }
  const results = await new SessionClient(() => ({}), undefined, () => false, () => v2).listAgents()
  assert.equal(results.length, 1)
  assert.equal(results[0].name, "builder")
  assert.equal(results[0].builtIn, true) // native→builtIn mapping
  assert.equal(calls[0], undefined) // no params → undefined
})

test("listAgents passes directory when provided", async () => {
  const calls = []
  const v2 = {
    app: {
      agents: async (p) => { calls.push(p); return { data: [], error: undefined } },
    },
  }
  await new SessionClient(() => ({}), undefined, () => false, () => v2).listAgents("/my/repo")
  assert.deepEqual(calls[0], { directory: "/my/repo" })
})

// --- Guard: all migrated methods require the v2 client -------------------------------

test("all migrated domain methods require the v2 client (Server not running otherwise)", async () => {
  const sc = new SessionClient(() => ({}), undefined, () => false, () => null)
  await assert.rejects(sc.getSession("ses_x"), /Server not running/)
  await assert.rejects(sc.createSession(), /Server not running/)
  await assert.rejects(sc.updateSessionTitle("ses_x", "x"), /Server not running/)
  await assert.rejects(sc.listSessions(), /Server not running/)
  await assert.rejects(sc.getChildSessions("p_x"), /Server not running/)
  await assert.rejects(sc.getSessionMessages("ses_x"), /Server not running/)
  await assert.rejects(sc.getMessages("ses_x"), /Server not running/)
  await assert.rejects(sc.getToolPartialOutput("ses_x", "c"), /Server not running/)
  await assert.rejects(sc.sendCommand("ses_x", "x"), /Server not running/)
  await assert.rejects(sc.compactSession("ses_x"), /Server not running/)
  await assert.rejects(sc.getSessionDiff("ses_x"), /Server not running/)
  await assert.rejects(sc.getSessionTodos("ses_x"), /Server not running/)
  await assert.rejects(sc.readFile("x"), /Server not running/)
  await assert.rejects(sc.listCommands(), /Server not running/)
  await assert.rejects(sc.listAgents(), /Server not running/)
})
