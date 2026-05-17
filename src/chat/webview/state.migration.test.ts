/**
 * Layer 5 RED tests — versioned, lossless migration of WebviewState.
 *
 * Spec: docs/specs/2026-05-16-message-pipeline-alignment.md §5.5
 * Plan: docs/test-plans/2026-05-16-message-pipeline-tdd.md (L5-T1..T11)
 *
 * Goal: ensure legacy persisted state (blocks with `tool_call`/`thinking`
 * types, `content` field on reasoning, sessions with `name`) is normalised
 * to canonical shape on first load and the result is idempotent.
 *
 * The migration function is exported from `state.ts` for testability;
 * `createState`'s `restore()` path calls it on `vscode.getState()` output.
 */
import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { migrateWebviewState, CURRENT_SCHEMA_VERSION } from "./state"

describe("WebviewState migration — Layer 5 RED", () => {
  it("L5-T1: legacy state without schemaVersion gets CURRENT_SCHEMA_VERSION", () => {
    const legacy = {
      sessions: { s1: { id: "s1", name: "Session 1", model: "", mode: "build", messages: [], isStreaming: false } },
      sessionOrder: ["s1"],
    }
    const migrated = migrateWebviewState(legacy)
    assert.equal(migrated.schemaVersion, CURRENT_SCHEMA_VERSION)
  })

  it("L5-T2: block type 'tool_call' renamed to 'tool'", () => {
    const legacy = {
      sessions: {
        s1: {
          id: "s1",
          name: "S",
          model: "",
          mode: "build",
          isStreaming: false,
          messages: [
            {
              role: "assistant",
              blocks: [{ type: "tool_call", name: "Read", state: "completed", result: "ok" }],
            },
          ],
        },
      },
      sessionOrder: ["s1"],
    }
    const migrated = migrateWebviewState(legacy)
    const block = (migrated.sessions["s1"]!.messages[0]!.blocks[0] as unknown as Record<string, unknown>)
    assert.equal(block.type, "tool")
  })

  it("L5-T2b: block type 'tool-call' renamed to 'tool'", () => {
    const legacy = {
      sessions: {
        s1: {
          id: "s1",
          name: "S",
          model: "",
          mode: "build",
          isStreaming: false,
          messages: [
            { role: "assistant", blocks: [{ type: "tool-call", name: "Read", state: "result" }] },
          ],
        },
      },
      sessionOrder: ["s1"],
    }
    const migrated = migrateWebviewState(legacy)
    const block = (migrated.sessions["s1"]!.messages[0]!.blocks[0] as unknown as Record<string, unknown>)
    assert.equal(block.type, "tool")
  })

  it("L5-T3: reasoning block's legacy 'content' field copies to canonical 'text'", () => {
    const legacy = {
      sessions: {
        s1: {
          id: "s1",
          name: "S",
          model: "",
          mode: "build",
          isStreaming: false,
          messages: [
            { role: "assistant", blocks: [{ type: "thinking", content: "I was thinking..." }] },
          ],
        },
      },
      sessionOrder: ["s1"],
    }
    const migrated = migrateWebviewState(legacy)
    const block = (migrated.sessions["s1"]!.messages[0]!.blocks[0] as unknown as Record<string, unknown>)
    assert.equal(block.text, "I was thinking...")
  })

  it("L5-T4: block type 'thinking' renamed to 'reasoning'", () => {
    const legacy = {
      sessions: {
        s1: {
          id: "s1",
          name: "S",
          model: "",
          mode: "build",
          isStreaming: false,
          messages: [{ role: "assistant", blocks: [{ type: "thinking", content: "x" }] }],
        },
      },
      sessionOrder: ["s1"],
    }
    const migrated = migrateWebviewState(legacy)
    const block = (migrated.sessions["s1"]!.messages[0]!.blocks[0] as unknown as Record<string, unknown>)
    assert.equal(block.type, "reasoning")
  })

  it("L5-T5: session.name copied to session.title (and name retained for transition)", () => {
    const legacy = {
      sessions: {
        s1: { id: "s1", name: "My session", model: "", mode: "build", messages: [], isStreaming: false },
      },
      sessionOrder: ["s1"],
    }
    const migrated = migrateWebviewState(legacy)
    const sess = migrated.sessions["s1"]! as unknown as Record<string, unknown>
    assert.equal(sess.title, "My session")
    // Layer 6 will rename `name` everywhere; for now keep both fields.
    assert.equal(sess.name, "My session")
  })

  it("L5-T6: message order is preserved across migration", () => {
    const msgs = [
      { role: "user", blocks: [{ type: "text", text: "first" }] },
      { role: "assistant", blocks: [{ type: "thinking", content: "mid" }] },
      { role: "user", blocks: [{ type: "text", text: "third" }] },
      { role: "assistant", blocks: [{ type: "tool_call", name: "Read" }] },
    ]
    const legacy = {
      sessions: {
        s1: { id: "s1", name: "S", model: "", mode: "build", isStreaming: false, messages: msgs },
      },
      sessionOrder: ["s1"],
    }
    const migrated = migrateWebviewState(legacy)
    const out = migrated.sessions["s1"]!.messages
    assert.equal(out.length, 4)
    assert.equal(out[0]!.role, "user")
    assert.equal((out[0]!.blocks[0] as unknown as Record<string, unknown>).text, "first")
    assert.equal((out[1]!.blocks[0] as unknown as Record<string, unknown>).type, "reasoning")
    assert.equal((out[2]!.blocks[0] as unknown as Record<string, unknown>).text, "third")
    assert.equal((out[3]!.blocks[0] as unknown as Record<string, unknown>).type, "tool")
  })

  it("L5-T7: migration is idempotent when schemaVersion already current", () => {
    const legacy = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      sessions: {
        s1: {
          id: "s1",
          name: "S",
          title: "S",
          model: "",
          mode: "build",
          isStreaming: false,
          messages: [{ role: "assistant", blocks: [{ type: "reasoning", text: "x", streaming: false, timeStart: 0 }] }],
        },
      },
      sessionOrder: ["s1"],
    }
    const a = migrateWebviewState(legacy)
    const b = migrateWebviewState(a)
    assert.deepEqual(b.sessions, a.sessions)
    assert.equal(b.schemaVersion, CURRENT_SCHEMA_VERSION)
  })

  it("L5-T8: migration refuses state with schemaVersion higher than current (downgrade guard)", () => {
    const futureState = {
      schemaVersion: CURRENT_SCHEMA_VERSION + 99,
      sessions: {},
      sessionOrder: [],
    }
    assert.throws(
      () => migrateWebviewState(futureState),
      /schemaVersion .* unsupported|downgrade/i,
      "migration must refuse to load state from a newer schema version",
    )
  })

  it("L5-T9/T10/T11 (golden fixtures): deferred — requires captured user state snapshots", () => {
    // The three golden-fixture round-trip tests will be added once we
    // capture 3 anonymised real-user state snapshots. Until then, the
    // assertion below is just a checkpoint that the migration function
    // is wired and callable.
    const result = migrateWebviewState({})
    assert.ok(result)
    assert.equal(result.schemaVersion, CURRENT_SCHEMA_VERSION)
  })
})
