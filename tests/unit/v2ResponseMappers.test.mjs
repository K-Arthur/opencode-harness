import test from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..", "..")
const bundleDir = path.join(repoRoot, ".coverage-bundles")
const bundlePath = path.join(bundleDir, "v2ResponseMappers.cjs")
const vscodeStubPath = path.join(bundleDir, "vscode-stub-mappers.js")

function loadMappers() {
  mkdirSync(bundleDir, { recursive: true })
  writeFileSync(vscodeStubPath, `
module.exports = {
  window: { createOutputChannel: () => ({ appendLine: () => {}, append: () => {}, show: () => {}, dispose: () => {} }) },
  workspace: { getConfiguration: () => ({ get: () => false }) },
}
`)
  execFileSync("npx", [
    "esbuild",
    "src/session/v2ResponseMappers.ts",
    "--bundle",
    "--platform=node",
    "--format=cjs",
    `--alias:vscode=${vscodeStubPath}`,
    `--outfile=${bundlePath}`,
  ], { cwd: repoRoot, stdio: "pipe" })

  delete createRequire(import.meta.url).cache?.[bundlePath]
  return createRequire(import.meta.url)(bundlePath)
}

const {
  mapV2Session,
  mapV2SessionArray,
  mapV2Message,
  mapV2Part,
  mapV2MessageWithParts,
  mapV2MessageWithPartsArray,
  mapV2Agent,
} = loadMappers()

// ── mapV2Session ─────────────────────────────────────────────────────────────

test("mapV2Session maps core fields from raw v2 object", () => {
  const raw = {
    id: "ses_1",
    slug: "ses_1",
    projectID: "proj_1",
    directory: "/repo",
    title: "Test Session",
    version: "1.0",
    time: { created: 1000, updated: 2000 },
  }
  const result = mapV2Session(raw)
  assert.equal(result.id, "ses_1")
  assert.equal(result.slug, "ses_1")
  assert.equal(result.projectID, "proj_1")
  assert.equal(result.directory, "/repo")
  assert.equal(result.title, "Test Session")
  assert.equal(result.version, "1.0")
  assert.equal(result.time.created, 1000)
  assert.equal(result.time.updated, 2000)
})

test("mapV2Session maps parentID when present", () => {
  const raw = {
    id: "child_1",
    slug: "child_1",
    projectID: "p1",
    directory: "/repo",
    parentID: "parent_1",
    title: "Child",
    version: "1",
    time: { created: 100, updated: 200 },
  }
  assert.equal(mapV2Session(raw).parentID, "parent_1")
})

test("mapV2Session maps parentID as undefined when absent", () => {
  const raw = {
    id: "s1",
    slug: "s1",
    projectID: "p1",
    directory: "/repo",
    title: "No Parent",
    version: "1",
    time: { created: 100, updated: 200 },
  }
  assert.equal(mapV2Session(raw).parentID, undefined)
})

test("mapV2Session maps summary with SnapshotFileDiff array", () => {
  const raw = {
    id: "s1",
    slug: "s1",
    projectID: "p1",
    directory: "/repo",
    title: "With Summary",
    version: "1",
    time: { created: 100, updated: 200 },
    summary: {
      additions: 10,
      deletions: 5,
      files: 2,
      diffs: [
        { file: "src/a.ts", additions: 7, deletions: 2, status: "modified", patch: "@@..." },
        { file: "src/b.ts", additions: 3, deletions: 3, status: "modified" },
      ],
    },
  }
  const result = mapV2Session(raw)
  assert.equal(result.summary.additions, 10)
  assert.equal(result.summary.deletions, 5)
  assert.equal(result.summary.files, 2)
  assert.equal(result.summary.diffs.length, 2)
  assert.equal(result.summary.diffs[0].file, "src/a.ts")
  assert.equal(result.summary.diffs[0].status, "modified")
  assert.equal(result.summary.diffs[0].patch, "@@...")
  assert.equal(result.summary.diffs[1].file, "src/b.ts")
})

test("mapV2Session handles missing summary", () => {
  const raw = {
    id: "s1",
    slug: "s1",
    projectID: "p1",
    directory: "/repo",
    title: "No Summary",
    version: "1",
    time: { created: 100, updated: 200 },
  }
  assert.equal(mapV2Session(raw).summary, undefined)
})

test("mapV2Session handles summary with no diffs", () => {
  const raw = {
    id: "s1",
    slug: "s1",
    projectID: "p1",
    directory: "/repo",
    title: "Empty Diffs",
    version: "1",
    time: { created: 100, updated: 200 },
    summary: { additions: 0, deletions: 0, files: 0 },
  }
  const result = mapV2Session(raw)
  assert.equal(result.summary.diffs, undefined)
})

test("mapV2Session maps share.url", () => {
  const raw = {
    id: "s1",
    slug: "s1",
    projectID: "p1",
    directory: "/repo",
    title: "Shared",
    version: "1",
    time: { created: 100, updated: 200 },
    share: { url: "https://share.example.com/abc" },
  }
  assert.equal(mapV2Session(raw).share.url, "https://share.example.com/abc")
})

test("mapV2Session handles missing share", () => {
  const raw = {
    id: "s1",
    slug: "s1",
    projectID: "p1",
    directory: "/repo",
    title: "No Share",
    version: "1",
    time: { created: 100, updated: 200 },
  }
  assert.equal(mapV2Session(raw).share, undefined)
})

test("mapV2Session maps time.compacting when present", () => {
  const raw = {
    id: "s1",
    slug: "s1",
    projectID: "p1",
    directory: "/repo",
    title: "Compacting",
    version: "1",
    time: { created: 100, updated: 200, compacting: 150 },
  }
  assert.equal(mapV2Session(raw).time.compacting, 150)
})

test("mapV2Session maps revert fields", () => {
  const raw = {
    id: "s1",
    slug: "s1",
    projectID: "p1",
    directory: "/repo",
    title: "Reverted",
    version: "1",
    time: { created: 100, updated: 200 },
    revert: { messageID: "msg_1", partID: "p1", snapshot: "snap_1", diff: "diff_1" },
  }
  const result = mapV2Session(raw)
  assert.equal(result.revert.messageID, "msg_1")
  assert.equal(result.revert.partID, "p1")
  assert.equal(result.revert.snapshot, "snap_1")
  assert.equal(result.revert.diff, "diff_1")
})

test("mapV2Session handles missing revert", () => {
  const raw = {
    id: "s1",
    slug: "s1",
    projectID: "p1",
    directory: "/repo",
    title: "No Revert",
    version: "1",
    time: { created: 100, updated: 200 },
  }
  assert.equal(mapV2Session(raw).revert, undefined)
})

// ── mapV2SessionArray ────────────────────────────────────────────────────────

test("mapV2SessionArray maps array of raw sessions", () => {
  const raw = [
    { id: "s1", slug: "s1", projectID: "p1", directory: "/r", title: "A", version: "1", time: { created: 1, updated: 2 } },
    { id: "s2", slug: "s2", projectID: "p1", directory: "/r", title: "B", version: "1", time: { created: 3, updated: 4 } },
  ]
  const result = mapV2SessionArray(raw)
  assert.equal(result.length, 2)
  assert.equal(result[0].id, "s1")
  assert.equal(result[1].id, "s2")
})

test("mapV2SessionArray handles empty array", () => {
  assert.deepEqual(mapV2SessionArray([]), [])
})

// ── mapV2Message / mapV2Part ─────────────────────────────────────────────────

test("mapV2Message passes through raw object as Message", () => {
  const raw = { id: "m1", sessionID: "s1", role: "assistant", time: { created: 100 } }
  const result = mapV2Message(raw)
  assert.equal(result.id, "m1")
  assert.equal(result.role, "assistant")
})

test("mapV2Part passes through raw object as Part", () => {
  const raw = { id: "p1", sessionID: "s1", messageID: "m1", type: "text", text: "hello" }
  const result = mapV2Part(raw)
  assert.equal(result.id, "p1")
  assert.equal(result.type, "text")
})

// ── mapV2MessageWithParts ────────────────────────────────────────────────────

test("mapV2MessageWithParts maps info + parts from raw", () => {
  const raw = {
    info: { id: "m1", sessionID: "s1", role: "assistant", time: { created: 100 } },
    parts: [
      { id: "p1", sessionID: "s1", messageID: "m1", type: "text", text: "hi" },
      { id: "p2", sessionID: "s1", messageID: "m1", type: "tool", callID: "c1", tool: "bash", state: { status: "running" } },
    ],
  }
  const result = mapV2MessageWithParts(raw)
  assert.equal(result.info.id, "m1")
  assert.equal(result.parts.length, 2)
  assert.equal(result.parts[0].type, "text")
  assert.equal(result.parts[1].type, "tool")
})

// ── mapV2MessageWithPartsArray ───────────────────────────────────────────────

test("mapV2MessageWithPartsArray maps array of message+parts", () => {
  const raw = [
    { info: { id: "m1", sessionID: "s1", role: "user", time: { created: 1 } }, parts: [{ id: "p1", sessionID: "s1", messageID: "m1", type: "text", text: "q" }] },
    { info: { id: "m2", sessionID: "s1", role: "assistant", time: { created: 2 } }, parts: [{ id: "p2", sessionID: "s1", messageID: "m2", type: "text", text: "a" }] },
  ]
  const result = mapV2MessageWithPartsArray(raw)
  assert.equal(result.length, 2)
  assert.equal(result[0].info.id, "m1")
  assert.equal(result[1].info.id, "m2")
})

test("mapV2MessageWithPartsArray handles empty array", () => {
  assert.deepEqual(mapV2MessageWithPartsArray([]), [])
})

// ── mapV2Agent ───────────────────────────────────────────────────────────────

test("mapV2Agent maps name, description, mode, native→builtIn", () => {
  const raw = { name: "builder", description: "Build agent", mode: "build", native: true }
  const result = mapV2Agent(raw)
  assert.equal(result.name, "builder")
  assert.equal(result.description, "Build agent")
  assert.equal(result.mode, "build")
  assert.equal(result.builtIn, true)
})

test("mapV2Agent maps native:false to builtIn:false", () => {
  const raw = { name: "custom", mode: "plan", native: false }
  assert.equal(mapV2Agent(raw).builtIn, false)
})

test("mapV2Agent defaults builtIn to false when native is missing", () => {
  const raw = { name: "custom", mode: "plan" }
  assert.equal(mapV2Agent(raw).builtIn, false)
})

test("mapV2Agent handles missing description", () => {
  const raw = { name: "x", mode: "auto", native: true }
  assert.equal(mapV2Agent(raw).description, undefined)
})

// ── Edge cases ───────────────────────────────────────────────────────────────

test("mapV2Session handles SnapshotFileDiff with only required fields", () => {
  const raw = {
    id: "s1",
    slug: "s1",
    projectID: "p1",
    directory: "/repo",
    title: "Minimal Diff",
    version: "1",
    time: { created: 100, updated: 200 },
    summary: {
      additions: 1,
      deletions: 0,
      files: 1,
      diffs: [{ additions: 1, deletions: 0 }],
    },
  }
  const diff = mapV2Session(raw).summary.diffs[0]
  assert.equal(diff.file, undefined)
  assert.equal(diff.patch, undefined)
  assert.equal(diff.status, undefined)
  assert.equal(diff.additions, 1)
  assert.equal(diff.deletions, 0)
})

test("mapV2Session handles SnapshotFileDiff with status 'added'", () => {
  const raw = {
    id: "s1",
    slug: "s1",
    projectID: "p1",
    directory: "/repo",
    title: "Added File",
    version: "1",
    time: { created: 100, updated: 200 },
    summary: {
      additions: 5,
      deletions: 0,
      files: 1,
      diffs: [{ file: "new.ts", additions: 5, deletions: 0, status: "added" }],
    },
  }
  assert.equal(mapV2Session(raw).summary.diffs[0].status, "added")
})

test("mapV2Session handles SnapshotFileDiff with status 'deleted'", () => {
  const raw = {
    id: "s1",
    slug: "s1",
    projectID: "p1",
    directory: "/repo",
    title: "Deleted File",
    version: "1",
    time: { created: 100, updated: 200 },
    summary: {
      additions: 0,
      deletions: 10,
      files: 1,
      diffs: [{ file: "old.ts", additions: 0, deletions: 10, status: "deleted" }],
    },
  }
  assert.equal(mapV2Session(raw).summary.diffs[0].status, "deleted")
})
