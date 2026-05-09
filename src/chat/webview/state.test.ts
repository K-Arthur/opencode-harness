import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "state.ts"), "utf8")

describe("state.ts", () => {
  it("exports createState", () => {
    assert.ok(source.includes("export function createState"))
  })

  it("defines DEFAULT_STATE with sessions, activeSessionId, globalModel, initialized", () => {
    assert.ok(source.includes("DEFAULT_STATE"))
    assert.ok(source.includes("sessions: {}"))
    assert.ok(source.includes("activeSessionId: null"))
    assert.ok(source.includes("globalModel"))
    assert.ok(source.includes("initialized"))
  })

  it("has migrateState function", () => {
    assert.ok(source.includes("function migrateState"))
  })

  it("migrates old 'normal' mode to 'build'", () => {
    assert.ok(source.includes('"normal" ? "build"'))
  })

  it("has save function with debounce", () => {
    assert.ok(source.includes("SAVE_DEBOUNCE_MS"))
    assert.ok(source.includes("function save()"))
  })

  it("has flush function for immediate save", () => {
    assert.ok(source.includes("function flush()"))
  })

  it("has restore, getState, createSession functions", () => {
    assert.ok(source.includes("function restore"))
    assert.ok(source.includes("function getState"))
    assert.ok(source.includes("function createSession"))
  })

  it("has loadSessions function", () => {
    assert.ok(source.includes("function loadSessions"))
  })

  it("returns the full API object", () => {
    const methods = [
      "getState", "save", "flush", "restore", "clear",
      "createSession", "ensureSession", "getSession", "getActiveSession",
	      "setActiveSession", "deleteSession", "renameSession",
	      "setSessionModel", "setSessionMode", "setStreaming", "appendMessage",
	      "getAllSessions", "getSessionCount", "setGlobalModel",
	      "loadSessions", "setInitialized", "isInitialized",
	      "toggleModelFavorite", "touchRecentModel", "applyModelState",
	    ]
    methods.forEach(m => {
      assert.ok(source.includes(m), `Missing method ${m} in return object`)
	  })

	  it("tracks model favorites and recents for selector sorting", () => {
	    assert.ok(source.includes("favoriteModels"), "must persist favorite models")
	    assert.ok(source.includes("recentModels"), "must persist recent models")
	    assert.ok(source.includes("recentRank"), "must annotate models with recent rank")
	  })
	})
})
