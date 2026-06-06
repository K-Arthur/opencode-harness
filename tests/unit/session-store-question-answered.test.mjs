/**
 * Behavioral tests for SessionStore.markQuestionAnswered.
 *
 * When the user answers (or skips) a `question` tool via the panel, the host
 * must flip the originating question block to an answered record so the
 * transcript stops showing a pending pointer and a reload doesn't re-prompt.
 *
 * SessionStore imports the VS Code API at module load, so this bundles the real
 * module with a tiny vscode stub instead of duplicating store logic.
 */
import { before, describe, it } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "esbuild"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

class MockMemento {
  constructor() {
    this.store = new Map()
  }
  get(key, defaultValue) {
    return this.store.has(key) ? this.store.get(key) : defaultValue
  }
  async update(key, value) {
    this.store.set(key, value)
  }
}

async function loadSessionStore() {
  const result = await build({
    entryPoints: [path.join(repoRoot, "src", "session", "SessionStore.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    sourcemap: false,
    plugins: [{
      name: "vscode-stub",
      setup(build) {
        build.onResolve({ filter: /^vscode$/ }, () => ({ path: "vscode", namespace: "vscode-stub" }))
        build.onLoad({ filter: /.*/, namespace: "vscode-stub" }, () => ({
          loader: "js",
          contents: `
            export class EventEmitter {
              constructor() { this.listeners = new Set() }
              get event() {
                return (listener) => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) } }
              }
              fire(value) { for (const listener of this.listeners) listener(value) }
              dispose() { this.listeners.clear() }
            }
            export const window = { createOutputChannel() { return { appendLine() {}, show() {}, dispose() {} } } }
            export const workspace = {
              workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
              getConfiguration() { return { get(_key, defaultValue) { return defaultValue } } },
            }
          `,
        }))
      },
    }],
  })
  const bundled = result.outputFiles?.[0]?.text
  assert.ok(bundled, "esbuild must return bundled SessionStore source")
  const dir = await mkdtemp(path.join(tmpdir(), "session-store-question-"))
  const file = path.join(dir, "SessionStore.bundle.mjs")
  await writeFile(file, bundled, "utf8")
  return import(pathToFileURL(file).href)
}

let SessionStore

function seedPendingQuestion(store, sessionId, toolCallId = "tool-q-1") {
  store.appendMessage(sessionId, {
    role: "assistant",
    id: "asst-1",
    timestamp: Date.now(),
    sessionId,
    blocks: [
      { type: "text", text: "Let me check." },
      {
        type: "question",
        id: toolCallId,
        toolCallId,
        sessionId,
        groups: [{ question: "Pick one", options: ["A", "B"], multiSelect: false }],
        text: "Pick one",
        options: ["A", "B"],
        allowFreeText: true,
      },
    ],
  })
}

function questionBlock(store, sessionId) {
  const session = store.get(sessionId)
  return session.messages.flatMap((m) => m.blocks).find((b) => b.type === "question")
}

before(async () => {
  ;({ SessionStore } = await loadSessionStore())
})

describe("SessionStore.markQuestionAnswered", () => {
  it("flips a pending question block to an answered record (option)", () => {
    const store = new SessionStore(new MockMemento())
    const session = store.create("Q session", { id: "q-1" })
    seedPendingQuestion(store, session.id)

    const ok = store.markQuestionAnswered(session.id, "tool-q-1", "Pick one: A", "option")
    assert.equal(ok, true, "returns true when a matching pending block is found")

    const block = questionBlock(store, session.id)
    assert.equal(block.answered, true)
    assert.equal(block.answer, "Pick one: A")
    assert.equal(block.answerSource, "option")
    store.dispose()
  })

  it("stores a friendly summary for a skipped question", () => {
    const store = new SessionStore(new MockMemento())
    const session = store.create("Q session", { id: "q-2" })
    seedPendingQuestion(store, session.id)

    const ok = store.markQuestionAnswered(session.id, "tool-q-1", "Skip this question — please use your best judgment and continue.", "skip")
    assert.equal(ok, true)
    const block = questionBlock(store, session.id)
    assert.equal(block.answered, true)
    assert.equal(block.answerSource, "skip")
    assert.match(block.answer, /best judgment|judgement/i, "shows a friendly skip summary, not the raw prompt")
    store.dispose()
  })

  it("does not re-answer an already-answered block and returns false", () => {
    const store = new SessionStore(new MockMemento())
    const session = store.create("Q session", { id: "q-3" })
    seedPendingQuestion(store, session.id)
    store.markQuestionAnswered(session.id, "tool-q-1", "Pick one: A", "option")

    const second = store.markQuestionAnswered(session.id, "tool-q-1", "Pick one: B", "option")
    assert.equal(second, false, "won't overwrite an answered question")
    assert.equal(questionBlock(store, session.id).answer, "Pick one: A", "keeps the first answer")
    store.dispose()
  })

  it("returns false when no question block matches the toolCallId", () => {
    const store = new SessionStore(new MockMemento())
    const session = store.create("Q session", { id: "q-4" })
    seedPendingQuestion(store, session.id)
    assert.equal(store.markQuestionAnswered(session.id, "nope", "x", "option"), false)
    store.dispose()
  })

  it("survives a persist/restore round-trip (no re-prompt on reload)", async () => {
    const memento = new MockMemento()
    const store = new SessionStore(memento)
    const session = store.create("Q session", { id: "q-5" })
    seedPendingQuestion(store, session.id)
    store.markQuestionAnswered(session.id, "tool-q-1", "Pick one: B", "option")
    await store.flush()
    store.dispose()

    const restored = new SessionStore(memento)
    const block = questionBlock(restored, session.id)
    assert.equal(block.answered, true)
    assert.equal(block.answer, "Pick one: B")
    restored.dispose()
  })
})
