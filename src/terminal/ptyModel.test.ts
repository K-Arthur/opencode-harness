/**
 * Behavioral tests for the PTY terminal state model (audit §14.1/§14.2).
 *
 * opencode SDK 1.17.7 exposes a PTY API: `pty.created/updated/exited/deleted`
 * events (lifecycle/status) + `pty.connect()` (live output bytes) + `pty.remove()`
 * (true per-command cancel). The `Pty` info object carries NO output, so output
 * arrives as separate chunks from the connect stream. This pure reducer folds
 * both into a renderable, ring-buffered terminal model — replacing the §14.1
 * "Hybrid A" 500ms polling hack once PTY is available.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { ptyReducer, isPtySupported, PTY_OUTPUT_CAP, type PtyAction, type PtyTerminalState } from "./ptyModel"

const info = (over: Partial<PtyTerminalState> & { id: string }) => ({
  id: over.id,
  title: over.title ?? "bash",
  command: over.command ?? "npm",
  args: over.args ?? ["run", "build"],
  cwd: over.cwd ?? "/repo",
  status: (over.status ?? "running") as "running" | "exited",
  pid: 4242,
})

const apply = (actions: PtyAction[]): Map<string, PtyTerminalState> =>
  actions.reduce((s, a) => ptyReducer(s, a), new Map<string, PtyTerminalState>())

describe("ptyReducer — lifecycle", () => {
  it("created → a running terminal with command/cwd and empty output", () => {
    const s = apply([{ kind: "created", info: info({ id: "p1" }), at: 1000 }])
    const t = s.get("p1")!
    assert.equal(t.status, "running")
    assert.equal(t.command, "npm")
    assert.deepEqual(t.args, ["run", "build"])
    assert.equal(t.cwd, "/repo")
    assert.equal(t.output, "")
    assert.equal(t.startedAt, 1000)
    assert.equal(t.endedAt, undefined)
  })

  it("chunk appends output in order", () => {
    const s = apply([
      { kind: "created", info: info({ id: "p1" }), at: 1 },
      { kind: "chunk", id: "p1", data: "Building...\n" },
      { kind: "chunk", id: "p1", data: "Done.\n" },
    ])
    assert.equal(s.get("p1")!.output, "Building...\nDone.\n")
  })

  it("exited → status exited, exitCode, endedAt set, output preserved", () => {
    const s = apply([
      { kind: "created", info: info({ id: "p1" }), at: 1 },
      { kind: "chunk", id: "p1", data: "ok" },
      { kind: "exited", id: "p1", exitCode: 0, at: 5000 },
    ])
    const t = s.get("p1")!
    assert.equal(t.status, "exited")
    assert.equal(t.exitCode, 0)
    assert.equal(t.endedAt, 5000)
    assert.equal(t.output, "ok")
  })

  it("updated → refreshes title/status without dropping output", () => {
    const s = apply([
      { kind: "created", info: info({ id: "p1", title: "bash" }), at: 1 },
      { kind: "chunk", id: "p1", data: "x" },
      { kind: "updated", info: info({ id: "p1", title: "vitest", status: "running" }) },
    ])
    const t = s.get("p1")!
    assert.equal(t.title, "vitest")
    assert.equal(t.output, "x")
  })

  it("removed → drops the terminal entry", () => {
    const s = apply([
      { kind: "created", info: info({ id: "p1" }), at: 1 },
      { kind: "removed", id: "p1" },
    ])
    assert.equal(s.has("p1"), false)
  })

  it("tracks multiple terminals independently", () => {
    const s = apply([
      { kind: "created", info: info({ id: "p1", command: "npm" }), at: 1 },
      { kind: "created", info: info({ id: "p2", command: "pytest" }), at: 2 },
      { kind: "chunk", id: "p2", data: "collected 3 items" },
    ])
    assert.equal(s.size, 2)
    assert.equal(s.get("p1")!.output, "")
    assert.equal(s.get("p2")!.output, "collected 3 items")
  })
})

describe("ptyReducer — robustness", () => {
  it("ignores chunk/exited/updated for an unknown id (no throw, no entry created)", () => {
    const s = apply([
      { kind: "chunk", id: "ghost", data: "x" },
      { kind: "exited", id: "ghost", exitCode: 1, at: 9 },
      { kind: "updated", info: info({ id: "ghost" }) },
    ])
    assert.equal(s.size, 0)
  })

  it("is immutable — returns a new Map and does not mutate the input", () => {
    const before = apply([{ kind: "created", info: info({ id: "p1" }), at: 1 }])
    const snapshotOutput = before.get("p1")!.output
    const after = ptyReducer(before, { kind: "chunk", id: "p1", data: "more" })
    assert.notEqual(after, before)
    assert.equal(before.get("p1")!.output, snapshotOutput, "input state unchanged")
    assert.equal(after.get("p1")!.output, "more")
  })

  it("ring-buffers output to PTY_OUTPUT_CAP, keeping the most recent tail", () => {
    const big = "A".repeat(PTY_OUTPUT_CAP + 5000)
    const s = apply([
      { kind: "created", info: info({ id: "p1" }), at: 1 },
      { kind: "chunk", id: "p1", data: big },
      { kind: "chunk", id: "p1", data: "TAIL_MARKER" },
    ])
    const out = s.get("p1")!.output
    assert.ok(out.length <= PTY_OUTPUT_CAP + 200, "capped near the limit")
    assert.ok(out.endsWith("TAIL_MARKER"), "keeps the newest output")
    assert.ok(out.includes("truncated"), "marks that earlier output was dropped")
  })
})

describe("isPtySupported — capability probe (graceful degradation)", () => {
  it("supported when pty.list returns an array", () => {
    assert.equal(isPtySupported({ data: [] }), true)
    assert.equal(isPtySupported({ data: [{ id: "p1" }] }), true)
  })
  it("unsupported on error / 404 / missing data (fall back to Hybrid-A)", () => {
    assert.equal(isPtySupported({ error: new Error("not found") }), false)
    assert.equal(isPtySupported({ response: { status: 404 } }), false)
    assert.equal(isPtySupported({}), false)
    assert.equal(isPtySupported(undefined), false)
  })
})
