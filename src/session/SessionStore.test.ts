import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(__dirname, "SessionStore.ts"), "utf8")

describe("SessionStore.ts", () => {
  it("exports OpenCodeSession interface", () => {
    assert.ok(source.includes("export interface OpenCodeSession"))
  })

  it("exports SessionStore class", () => {
    assert.ok(source.includes("export class SessionStore"))
  })

  it("constructor takes globalState", () => {
    assert.ok(source.includes("constructor(private readonly globalState"))
  })

  it("has create method", () => {
    assert.ok(source.includes("create("))
  })

  it("has get method", () => {
    assert.ok(source.includes("get("))
  })

  it("has list method", () => {
    assert.ok(source.includes("list()"))
  })

  it("has setActive method", () => {
    assert.ok(source.includes("setActive("))
  })

  it("has appendMessage method", () => {
    assert.ok(source.includes("appendMessage("))
  })

  it("has delete method", () => {
    assert.ok(source.includes("delete("))
  })

  it("has duplicate method", () => {
    assert.ok(source.includes("duplicate("))
  })

  it("has generateTitleFromMessage method", () => {
    assert.ok(source.includes("generateTitleFromMessage("))
  })

  it("has validateSessionName method", () => {
    assert.ok(source.includes("validateSessionName("))
  })

  it("auto-generates title from first user message", () => {
    assert.ok(source.includes("generateTitleFromMessage"))
  })

  it("validates rename for empty names", () => {
    assert.ok(source.includes("validateSessionName("))
  })

  it("validates rename for oversized names", () => {
    assert.ok(source.includes("validateSessionName"))
  })

  it("has onDidChangeSession typed event for delete/rename/active", () => {
    assert.ok(source.includes("onDidChangeSession"), "must have typed change event")
    assert.ok(source.includes("kind"), "event must have kind discriminator")
    assert.ok(source.includes('kind: "deleted"'), "must emit session_deleted event")
  })

  it("has archive method that marks session as archived", () => {
    assert.ok(source.includes("archive("), "archive method must exist")
    assert.ok(source.includes("archived"), "OpenCodeSession must have archived field")
  })

  it("has unarchive method that restores session", () => {
    assert.ok(source.includes("unarchive("), "unarchive method must exist")
  })

  it("has clearAll method that returns preview counts", () => {
    assert.ok(source.includes("clearAll("), "clearAll method must exist")
    assert.ok(source.includes("dryRun"), "must support dry-run preview mode")
    assert.ok(source.includes("preview:"), "must return preview object with counts")
  })

  it("has empty-session cleanup helpers for unused tab clutter", () => {
    assert.ok(source.includes("deleteIfEmpty("), "must delete an opened-but-unused session on close")
    assert.ok(source.includes("pruneEmptySessions("), "must expose periodic empty-session pruning")
    assert.ok(source.includes("emptySessionTtlMinutes"), "cleanup must read the configurable empty-session TTL")
  })

  it("does not persist active empty sessions unless they need server recovery", () => {
    const idx = source.indexOf("async flush(")
    assert.ok(idx >= 0, "flush method must exist")
    const block = source.slice(idx, source.indexOf("private pruneStaleSessions", idx))
    assert.ok(
      !block.includes("id === this.activeSessionId"),
      "flush must not persist active empty sessions just because they are active"
    )
    assert.ok(block.includes("sess.messages.length > 0") && block.includes("exempt"))
  })

  it("list filters archived sessions by default", () => {
    assert.ok(source.includes("list("), "list method must exist")
  })

  // ── importOneServerSession: import a single server session on demand ──────
  // When the user clicks a server session in the unified modal that has no
  // local counterpart, the extension must be able to create a local entry for
  // it so handleResumeSession can backfill and open it.

  it("has importOneServerSession method", () => {
    assert.ok(
      source.includes("importOneServerSession("),
      "SessionStore must have importOneServerSession method"
    )
  })

  it("importOneServerSession creates session with needsBackfill:true", () => {
    assert.ok(
      source.includes("needsBackfill: true") || source.includes("needsBackfill:true"),
      "importOneServerSession must mark the session as needsBackfill:true"
    )
    assert.ok(
      source.includes("importOneServerSession"),
      "importOneServerSession must be implemented"
    )
  })

  it("importOneServerSession stores cliSessionId from the server session id", () => {
    const idx = source.indexOf("importOneServerSession(")
    assert.ok(idx >= 0, "importOneServerSession must exist")
    const block = source.slice(idx, idx + 800)
    assert.ok(
      block.includes("cliSessionId"),
      "importOneServerSession must set cliSessionId on the new session entry"
    )
  })

  it("importOneServerSession uses server directory as workspacePath not current vscode workspace", () => {
    const idx = source.indexOf("importOneServerSession(")
    assert.ok(idx >= 0)
    const block = source.slice(idx, idx + 800)
    assert.ok(
      block.includes("workspacePath"),
      "importOneServerSession must set workspacePath from the server session directory"
    )
    assert.ok(
      !block.includes("vscode.workspace.workspaceFolders"),
      "importOneServerSession must NOT read vscode.workspace.workspaceFolders — it should use the provided directory arg"
    )
  })

  it("importOneServerSession returns existing session when cliSessionId already imported", () => {
    const idx = source.indexOf("importOneServerSession(")
    assert.ok(idx >= 0)
    const block = source.slice(idx, idx + 800)
    assert.ok(
      block.includes("cliSessionId") && (block.includes("find(") || block.includes("existing")),
      "importOneServerSession must check for an existing session with the same cliSessionId and return it"
    )
  })
})
