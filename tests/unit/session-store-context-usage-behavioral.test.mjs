/**
 * Behavioral tests for SessionStore context usage persistence.
 *
 * SessionStore imports the VS Code API at module load, so this test bundles the
 * real module with a tiny vscode stub instead of duplicating store logic.
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
                return (listener) => {
                  this.listeners.add(listener)
                  return { dispose: () => this.listeners.delete(listener) }
                }
              }
              fire(value) { for (const listener of this.listeners) listener(value) }
              dispose() { this.listeners.clear() }
            }
            export const window = {
              createOutputChannel() {
                return { appendLine() {}, show() {}, dispose() {} }
              },
            }
            export const workspace = {
              workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
              getConfiguration() {
                return { get(_key, defaultValue) { return defaultValue } }
              },
            }
          `,
        }))
      },
    }],
  })

  const bundled = result.outputFiles?.[0]?.text
  assert.ok(bundled, "esbuild must return bundled SessionStore source")
  const dir = await mkdtemp(path.join(tmpdir(), "session-store-context-"))
  const file = path.join(dir, "SessionStore.bundle.mjs")
  await writeFile(file, bundled, "utf8")
  return import(pathToFileURL(file).href)
}

function addMessage(store, sessionId) {
  store.appendMessage(sessionId, {
    role: "user",
    blocks: [{ type: "text", text: "hello" }],
    timestamp: Date.now(),
  })
}

function createStore(SessionStore, memento = new MockMemento()) {
  return new SessionStore(memento)
}

let SessionStore

before(async () => {
  ({ SessionStore } = await loadSessionStore())
})

describe("SessionStore — context usage behavior", () => {
  it("persists and restores context usage with source and timestamp", async () => {
    const memento = new MockMemento()
    const store = createStore(SessionStore, memento)
    const session = store.create("Context session", { id: "ctx-1", cliSessionId: "ctx-1" })
    addMessage(store, session.id)

    store.updateContextUsage(session.id, {
      percent: 25,
      tokens: 250,
      maxTokens: 1000,
      source: "actual",
      updatedAt: 2000,
      breakdown: { system: 10, history: 20, workspace: 220 },
      cost: 0.01,
    })
    await store.flush()
    store.dispose()

    const restored = createStore(SessionStore, memento)
    const usage = restored.getContextUsage(session.id)
    assert.equal(usage?.tokens, 250)
    assert.equal(usage?.maxTokens, 1000)
    assert.equal(usage?.percent, 25)
    assert.equal(usage?.source, "actual")
    assert.equal(usage?.updatedAt, 2000)
    assert.deepEqual(usage?.breakdown, { system: 10, history: 20, workspace: 220 })
    assert.equal(usage?.cost, 0.01)
    restored.dispose()
  })

  it("does not let a zero fallback update erase valid prior usage", () => {
    const store = createStore(SessionStore)
    const session = store.create("Context session", { id: "ctx-2" })
    addMessage(store, session.id)

    store.updateContextUsage(session.id, { percent: 50, tokens: 500, maxTokens: 1000, source: "actual", updatedAt: 3000 })
    store.updateContextUsage(session.id, { percent: 0, tokens: 0, maxTokens: 1000, source: "estimated", updatedAt: 4000 })

    const usage = store.getContextUsage(session.id)
    assert.equal(usage?.tokens, 500)
    assert.equal(usage?.percent, 50)
    assert.equal(usage?.source, "actual")
    assert.equal(usage?.updatedAt, 3000)
    store.dispose()
  })

  it("ignores stale estimates after newer actual usage", () => {
    const store = createStore(SessionStore)
    const session = store.create("Context session", { id: "ctx-3" })
    addMessage(store, session.id)

    store.updateContextUsage(session.id, { percent: 80, tokens: 800, maxTokens: 1000, source: "actual", updatedAt: 5000 })
    store.updateContextUsage(session.id, { percent: 20, tokens: 200, maxTokens: 1000, source: "estimated", updatedAt: 1000 })

    const usage = store.getContextUsage(session.id)
    assert.equal(usage?.tokens, 800)
    assert.equal(usage?.percent, 80)
    assert.equal(usage?.source, "actual")
    assert.equal(usage?.updatedAt, 5000)
    store.dispose()
  })

  it("removes context usage when a session is deleted or cleared", () => {
    const store = createStore(SessionStore)
    const deleted = store.create("Delete me", { id: "ctx-delete" })
    addMessage(store, deleted.id)
    store.updateContextUsage(deleted.id, { percent: 60, tokens: 600, maxTokens: 1000, source: "actual", updatedAt: 6000 })
    store.delete(deleted.id)
    assert.equal(store.getContextUsage(deleted.id), undefined)

    const cleared = store.create("Session context cleanup", { id: "ctx-clear" })
    addMessage(store, cleared.id)
    store.updateContextUsage(cleared.id, { percent: 70, tokens: 700, maxTokens: 1000, source: "actual", updatedAt: 7000 })
    const preview = store.clearAll(false)
    assert.ok(preview.totalRemovable > 0)
    assert.equal(store.getContextUsage(cleared.id), undefined)
    store.dispose()
  })
})
