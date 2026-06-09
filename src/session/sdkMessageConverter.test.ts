/**
 * Layer 1 RED tests for the SDK-aligned message pipeline.
 *
 * Spec:    docs/specs/2026-05-16-message-pipeline-alignment.md
 * ADR:     docs/adrs/ADR-008-sdk-aligned-message-pipeline.md
 * Plan:    docs/test-plans/2026-05-16-message-pipeline-tdd.md (L1-T1..L1-T26)
 *
 * These tests assert the *target* canonical block shape, not the legacy
 * shape currently produced. Until the converter is rewritten in Layer 1
 * GREEN, the assertions on canonical shapes will fail at runtime — that is
 * the RED-phase intent. The file deliberately compiles cleanly so the
 * runner can execute every test and report concrete diffs.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import type { Message, Part } from "@opencode-ai/sdk"
import {
  partToBlock,
  partsToBlocks,
  sdkMessageToChatMessage,
  sdkMessagesToChatMessages,
} from "./sdkMessageConverter"
import type { Block } from "../types"

// ---------------------------------------------------------------------------
// Test fixtures — minimal valid SDK Part objects per types.gen.d.ts (1.15.3)
// ---------------------------------------------------------------------------

const baseIds = { id: "p1", sessionID: "s1", messageID: "m1" } as const

const textPart = (overrides: Partial<{ text: string; synthetic: boolean; ignored: boolean }> = {}): Part =>
  ({
    ...baseIds,
    type: "text",
    text: overrides.text ?? "hello",
    ...(overrides.synthetic !== undefined ? { synthetic: overrides.synthetic } : {}),
    ...(overrides.ignored !== undefined ? { ignored: overrides.ignored } : {}),
  }) as Part

const reasoningPart = (text = "thinking out loud", timeStart = 1, timeEnd?: number): Part =>
  ({
    ...baseIds,
    type: "reasoning",
    text,
    time: timeEnd === undefined ? { start: timeStart } : { start: timeStart, end: timeEnd },
  }) as Part

const filePart = (mime: string, url: string, filename?: string, sourcePath?: string): Part =>
  ({
    ...baseIds,
    type: "file",
    mime,
    url,
    ...(filename ? { filename } : {}),
    ...(sourcePath
      ? {
          source: {
            type: "file" as const,
            path: sourcePath,
            text: { value: "", start: 0, end: 0 },
          },
        }
      : {}),
  }) as Part

const toolPartPending = (input: Record<string, unknown> = { a: 1 }): Part =>
  ({
    ...baseIds,
    type: "tool",
    callID: "call-1",
    tool: "Read",
    state: { status: "pending", input, raw: JSON.stringify(input) },
  }) as Part

const toolPartRunning = (input: Record<string, unknown> = { a: 1 }): Part =>
  ({
    ...baseIds,
    type: "tool",
    callID: "call-1",
    tool: "Read",
    state: { status: "running", input, time: { start: 1 } },
  }) as Part

const toolPartCompleted = (output = "done", input: Record<string, unknown> = { a: 1 }): Part =>
  ({
    ...baseIds,
    type: "tool",
    callID: "call-1",
    tool: "Read",
    state: {
      status: "completed",
      input,
      output,
      title: "Read",
      metadata: {},
      time: { start: 1, end: 2 },
    },
  }) as Part

const toolPartError = (error = "boom", input: Record<string, unknown> = { a: 1 }): Part =>
  ({
    ...baseIds,
    type: "tool",
    callID: "call-1",
    tool: "Read",
    state: { status: "error", input, error, time: { start: 1, end: 2 } },
  }) as Part

const stepStartPart = (snapshot?: string): Part =>
  ({ ...baseIds, type: "step-start", ...(snapshot ? { snapshot } : {}) }) as Part

const stepFinishPart = (reason = "stop"): Part =>
  ({
    ...baseIds,
    type: "step-finish",
    reason,
    cost: 0.01,
    tokens: { input: 10, output: 20, reasoning: 5, cache: { read: 0, write: 0 } },
  }) as Part

const snapshotPart = (snapshot = "snap-1"): Part =>
  ({ ...baseIds, type: "snapshot", snapshot }) as Part

const patchPart = (hash = "abc123", files = ["a.ts", "b.ts"]): Part =>
  ({ ...baseIds, type: "patch", hash, files }) as Part

const agentPart = (name = "planner"): Part =>
  ({ ...baseIds, type: "agent", name }) as Part

const retryPart = (attempt = 1): Part =>
  ({
    ...baseIds,
    type: "retry",
    attempt,
    error: { name: "APIError" as const, data: { message: "rate limited", isRetryable: true } },
    time: { created: 1 },
  }) as Part

const compactionPart = (auto = true): Part =>
  ({ ...baseIds, type: "compaction", auto }) as Part

const subtaskPart = (prompt = "do thing", description = "child", agent = "general"): Part =>
  ({ ...baseIds, type: "subtask", prompt, description, agent }) as Part

const assistantMessage = (id = "m1", sessionId = "s1", completed?: number): Message =>
  ({
    id,
    sessionID: sessionId,
    role: "assistant",
    time: completed === undefined ? { created: 1 } : { created: 1, completed },
    parentID: "u1",
    modelID: "claude-x",
    providerID: "anthropic",
    mode: "build",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }) as Message

// ---------------------------------------------------------------------------
// Untyped field-access helper — bridges Block (currently LegacyBlock) to the
// canonical CanonicalBlock variants. Tests assert against the *target*
// shape; this helper lets the file compile during RED.
// ---------------------------------------------------------------------------

function f(b: Block | null): Record<string, unknown> {
  return b == null ? {} : (b as unknown as Record<string, unknown>)
}

function expectType<T extends string>(b: Block | null, type: T): Block & { type: T } {
  assert.ok(b, `expected block, got null`)
  assert.equal(b!.type, type, `expected block.type === '${type}', got '${b!.type}'`)
  return b as Block & { type: T }
}

// ---------------------------------------------------------------------------
// L1-T1..T25 — partToBlock / sdkMessageToChatMessage behavior
// ---------------------------------------------------------------------------

describe("sdkMessageConverter — Layer 1 RED (canonical CanonicalBlock projection)", () => {
  it("L1-T1: partToBlock returns text block for TextPart with text", () => {
    const b = expectType(partToBlock(textPart({ text: "hi" })), "text")
    assert.equal(f(b).text, "hi")
  })

  it("L1-T2: partToBlock returns null for synthetic TextPart", () => {
    assert.equal(partToBlock(textPart({ synthetic: true })), null)
  })

  it("L1-T3: partToBlock returns null for ignored TextPart", () => {
    assert.equal(partToBlock(textPart({ ignored: true })), null)
  })

  it("L1-T4: partToBlock returns reasoning block for ReasoningPart (canonical type 'reasoning', field 'text')", () => {
    const b = expectType(partToBlock(reasoningPart("hmm")), "reasoning")
    assert.equal(f(b).text, "hmm")
  })

  it("L1-T5: partToBlock preserves time range from ReasoningPart", () => {
    const b = expectType(partToBlock(reasoningPart("hmm", 100, 200)), "reasoning")
    assert.equal(f(b).timeStart, 100)
    assert.equal(f(b).timeEnd, 200)
  })

  it("L1-T6: partToBlock returns file block for image FilePart", () => {
    const b = expectType(partToBlock(filePart("image/png", "data:image/png;base64,abc", "shot.png")), "file")
    assert.equal(f(b).mime, "image/png")
    assert.equal(f(b).url, "data:image/png;base64,abc")
    assert.equal(f(b).filename, "shot.png")
  })

  it("L1-T7: partToBlock returns file block for non-image FilePart with source path", () => {
    const b = expectType(partToBlock(filePart("text/typescript", "file:///x.ts", "x.ts", "/x.ts")), "file")
    assert.equal(f(b).mime, "text/typescript")
    assert.equal(f(b).sourcePath, "/x.ts")
  })

  it("L1-T8: partToBlock returns tool block for pending ToolPart (canonical type 'tool')", () => {
    const b = expectType(partToBlock(toolPartPending({ p: 1 })), "tool")
    assert.equal(f(b).state, "pending")
    assert.equal(f(b).callID, "call-1")
    assert.equal(f(b).tool, "Read")
    assert.deepEqual(f(b).args, { p: 1 })
  })

  it("L1-T9: partToBlock returns tool block for running ToolPart with input", () => {
    const b = expectType(partToBlock(toolPartRunning({ q: 2 })), "tool")
    assert.equal(f(b).state, "running")
    assert.deepEqual(f(b).args, { q: 2 })
  })

  it("L1-T10: partToBlock returns tool block for completed ToolPart with output", () => {
    const b = expectType(partToBlock(toolPartCompleted("OUT")), "tool")
    assert.equal(f(b).state, "completed")
    assert.equal(f(b).result, "OUT")
  })

  it("L1-T11: partToBlock returns tool block for error ToolPart with message", () => {
    const b = expectType(partToBlock(toolPartError("err!")), "tool")
    assert.equal(f(b).state, "error")
    assert.equal(f(b).error, "err!")
  })

  it("L1-T11b: partToBlock returns an interactive question block for the question tool (flat args)", () => {
    const part = {
      ...baseIds,
      type: "tool",
      callID: "call-q",
      tool: "question",
      state: { status: "running", input: { question: "Pick a DB", options: ["Postgres", "MySQL"] }, time: { start: 1 } },
    } as Part
    const b = expectType(partToBlock(part), "question")
    assert.equal(f(b).toolCallId, "call-q")
    assert.equal(f(b).text, "Pick a DB")
    assert.deepEqual(f(b).options, ["Postgres", "MySQL"])
    const groups = f(b).groups as Array<Record<string, unknown>>
    assert.equal(groups.length, 1)
    assert.deepEqual(groups[0]!.options, ["Postgres", "MySQL"])
  })

  it("L1-T11c: question tool with nested questions[] yields multiple groups", () => {
    const part = {
      ...baseIds,
      type: "tool",
      callID: "call-q2",
      tool: "question",
      state: {
        status: "completed",
        input: { questions: [{ question: "DB?", header: "Database", options: ["PG"] }, { question: "Feat?", options: ["Auth"], multiSelect: true }] },
        output: "answered",
        title: "question",
        metadata: {},
        time: { start: 1, end: 2 },
      },
    } as Part
    const b = expectType(partToBlock(part), "question")
    const groups = f(b).groups as Array<Record<string, unknown>>
    assert.equal(groups.length, 2)
    assert.equal(groups[0]!.header, "Database")
    assert.equal(groups[1]!.multiSelect, true)
  })

  it("L1-T12: partToBlock returns step-start block", () => {
    const b = expectType(partToBlock(stepStartPart("snap")), "step-start")
    assert.equal(f(b).snapshot, "snap")
  })

  it("L1-T13: partToBlock returns step-finish block with tokens and cost", () => {
    const b = expectType(partToBlock(stepFinishPart("stop")), "step-finish")
    assert.equal(f(b).reason, "stop")
    assert.equal(f(b).cost, 0.01)
    const tokens = f(b).tokens as { input: number; output: number; reasoning: number } | undefined
    assert.ok(tokens, "tokens should be present on step-finish block")
    assert.equal(tokens!.input, 10)
    assert.equal(tokens!.output, 20)
    assert.equal(tokens!.reasoning, 5)
  })

  it("L1-T14: partToBlock returns snapshot block", () => {
    const b = expectType(partToBlock(snapshotPart("snap-x")), "snapshot")
    assert.equal(f(b).snapshot, "snap-x")
  })

  it("L1-T15: partToBlock returns patch block with file list", () => {
    const b = expectType(partToBlock(patchPart("h", ["x.ts"])), "patch")
    assert.equal(f(b).hash, "h")
    assert.deepEqual(f(b).files, ["x.ts"])
  })

  it("L1-T16: partToBlock returns agent block with name", () => {
    const b = expectType(partToBlock(agentPart("planner")), "agent")
    assert.equal(f(b).name, "planner")
  })

  it("L1-T17: partToBlock returns retry block with attempt and error", () => {
    const b = expectType(partToBlock(retryPart(3)), "retry")
    assert.equal(f(b).attempt, 3)
    assert.match(String(f(b).errorMessage ?? ""), /rate limited/)
  })

  it("L1-T18: partToBlock returns compaction block marking auto flag", () => {
    const b = expectType(partToBlock(compactionPart(true)), "compaction")
    assert.equal(f(b).auto, true)
  })

  it("L1-T19: partToBlock returns subtask block with prompt/description/agent", () => {
    const b = expectType(partToBlock(subtaskPart("p", "d", "a")), "subtask")
    assert.equal(f(b).prompt, "p")
    assert.equal(f(b).description, "d")
    assert.equal(f(b).agent, "a")
  })

  it("L1-T20: partToBlock passes streaming opt through to reasoning block", () => {
    const b = expectType(partToBlock(reasoningPart("mid"), { streaming: true }), "reasoning")
    assert.equal(f(b).streaming, true)
  })

  it("L1-T21: partToBlock uses part.id as block id for streaming identity", () => {
    const b = partToBlock(textPart({ text: "x" }))
    assert.equal(f(b).id, "p1")
  })

  it("L1-T22: sdkMessageToChatMessage drops messages whose parts are all synthetic/ignored", () => {
    const out = sdkMessageToChatMessage(assistantMessage(), [textPart({ synthetic: true })])
    assert.equal(out, null)
  })

  it("L1-T23: sdkMessageToChatMessage preserves message role, id, sessionId", () => {
    const out = sdkMessageToChatMessage(assistantMessage("m9", "s9"), [textPart({ text: "x" })])
    assert.ok(out)
    assert.equal(out!.role, "assistant")
    assert.equal(out!.id, "m9")
    assert.equal(out!.sessionId, "s9")
  })

  it("L1-T24: sdkMessageToChatMessage uses time.completed when present else time.created", () => {
    const completedOut = sdkMessageToChatMessage(assistantMessage("m1", "s1", 999), [textPart({ text: "x" })])
    assert.equal(completedOut!.timestamp, 999)
    const createdOut = sdkMessageToChatMessage(assistantMessage("m1", "s1"), [textPart({ text: "x" })])
    assert.equal(createdOut!.timestamp, 1)
  })

  it("L1-T25: sdkMessagesToChatMessages preserves order and drops nulls", () => {
    const rows = [
      { info: assistantMessage("a"), parts: [textPart({ text: "first" })] },
      { info: assistantMessage("b"), parts: [textPart({ synthetic: true })] },
      { info: assistantMessage("c"), parts: [textPart({ text: "third" })] },
    ]
    const out = sdkMessagesToChatMessages(rows)
    assert.equal(out.length, 2)
    assert.equal(out[0]!.id, "a")
    assert.equal(out[1]!.id, "c")
  })

  it("L1-T26 (meta/structural): only sdkMessageConverter switches on .type when it also imports SDK Part", () => {
    // Heuristic: a file is dispatching on the SDK `Part` union iff it BOTH
    // imports `Part` from `@opencode-ai/sdk` (or via the package's index
    // export) AND contains `switch (x.type)`. Plain enum switches in
    // unrelated modules (event.type, task.type, etc.) are excluded.
    const root = join(process.cwd(), "src")
    const offenders: string[] = []
    const expectedFile = "src/session/sdkMessageConverter.ts"
    const switchRe = /switch\s*\(\s*[A-Za-z_$][\w$]*\.type\s*\)/
    const partImportRe = /from\s+["']@opencode-ai\/sdk["']/

    function walk(dir: string): void {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "dist") continue
        const p = join(dir, entry)
        const st = statSync(p)
        if (st.isDirectory()) {
          walk(p)
          continue
        }
        if (!entry.endsWith(".ts") || entry.endsWith(".test.ts")) continue
        const src = readFileSync(p, "utf8")
        if (!partImportRe.test(src)) continue
        if (!/\bPart\b/.test(src)) continue
        if (switchRe.test(src)) offenders.push(p.slice(process.cwd().length + 1))
      }
    }
    walk(root)

    const filtered = offenders.filter(file => file !== expectedFile)
    assert.deepEqual(
      filtered,
      [],
      `Only ${expectedFile} may switch on .type for SDK Part dispatch. Offenders: ${filtered.join(", ")}`,
    )
  })
})

describe("sdkMessageConverter — partsToBlocks (Layer 1)", () => {
  it("partsToBlocks maps each part via partToBlock and skips nulls", () => {
    const out: Block[] = partsToBlocks([
      textPart({ text: "a" }),
      textPart({ synthetic: true }),
      reasoningPart("r"),
    ])
    assert.equal(out.length, 2)
    assert.equal(out[0]!.type, "text")
    assert.equal(out[1]!.type, "reasoning")
  })
})
