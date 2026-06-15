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

test("migrated domain methods require the v2 client (Server not running otherwise)", async () => {
  const sc = new SessionClient(() => ({}), undefined, () => false, () => null)
  await assert.rejects(sc.getSession("ses_x"), /Server not running/)
  await assert.rejects(sc.createSession(), /Server not running/)
  await assert.rejects(sc.updateSessionTitle("ses_x", "x"), /Server not running/)
  await assert.rejects(sc.listSessions(), /Server not running/)
  await assert.rejects(sc.getChildSessions("p_x"), /Server not running/)
})
