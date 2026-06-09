import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

const contextEngineSource = readFileSync(path.join(__dirname, "ContextEngine.ts"), "utf8")
const adapterSource = readFileSync(path.join(__dirname, "WorkspaceAdapter.ts"), "utf8")
const extensionSource = readFileSync(path.join(__dirname, "..", "extension.ts"), "utf8")

void describe("WorkspaceAdapter interface", () => {
  void it("exports WorkspaceAdapter interface", () => {
    assert.ok(adapterSource.includes("export interface WorkspaceAdapter"))
  })

  void it("defines listOpenTabs method", () => {
    assert.ok(adapterSource.includes("listOpenTabs"))
  })

  void it("defines readFile method", () => {
    assert.ok(adapterSource.includes("readFile"))
  })

  void it("defines getRelativePath method", () => {
    assert.ok(adapterSource.includes("getRelativePath"))
  })

  void it("defines getDiagnostics method", () => {
    assert.ok(adapterSource.includes("getDiagnostics"))
  })

  void it("defines getWorkspaceFolders method", () => {
    assert.ok(adapterSource.includes("getWorkspaceFolders"))
  })

  void it("defines findFiles method", () => {
    assert.ok(adapterSource.includes("findFiles"))
  })

  void it("defines getGitInfo method", () => {
    assert.ok(adapterSource.includes("getGitInfo"))
  })

  void it("defines getActiveSelection method", () => {
    assert.ok(adapterSource.includes("getActiveSelection"))
  })

  void it("returns plain data, not vscode types", () => {
    assert.ok(!adapterSource.includes("import * as vscode"))
    assert.ok(!adapterSource.includes("vscode."))
  })
})

void describe("ContextEngine adapter integration", () => {
  void it("constructor accepts WorkspaceAdapter parameter", () => {
    assert.ok(
      contextEngineSource.includes("constructor(") && contextEngineSource.includes("WorkspaceAdapter"),
      "ContextEngine constructor must accept WorkspaceAdapter",
    )
  })

  void it("stores adapter as private field", () => {
    assert.ok(
      contextEngineSource.includes("private readonly adapter") || contextEngineSource.includes("private adapter"),
      "ContextEngine must store adapter as private field",
    )
  })

  void it("no longer directly imports vscode for context gathering", () => {
    const importSection = contextEngineSource.split("\n").slice(0, 10).join("\n")
    assert.ok(importSection.includes('import type { WorkspaceAdapter }'))
  })

  void it("gatherOpenFiles calls this.adapter.listOpenTabs()", () => {
    assert.ok(contextEngineSource.includes("this.adapter.listOpenTabs()") || contextEngineSource.includes("this.adapter.listOpenTabs("), "gatherOpenFiles must delegate to adapter.listOpenTabs()")
  })

  void it("gatherDiagnostics calls this.adapter.getDiagnostics()", () => {
    assert.ok(contextEngineSource.includes("this.adapter.getDiagnostics()") || contextEngineSource.includes("this.adapter.getDiagnostics("), "gatherDiagnostics must delegate to adapter.getDiagnostics()")
  })

  void it("gatherWorkspaceTree calls this.adapter.getWorkspaceFolders()", () => {
    assert.ok(contextEngineSource.includes("this.adapter.getWorkspaceFolders()") || contextEngineSource.includes("this.adapter.getWorkspaceFolders("), "gatherWorkspaceTree must delegate to adapter.getWorkspaceFolders()")
  })

  void it("gatherGitStatus calls this.adapter.getGitInfo()", () => {
    assert.ok(contextEngineSource.includes("this.adapter.getGitInfo()") || contextEngineSource.includes("this.adapter.getGitInfo("), "gatherGitStatus must delegate to adapter.getGitInfo()")
  })

  void it("uses adapter.readFile for document reads", () => {
    assert.ok(contextEngineSource.includes("this.adapter.readFile("), "open file reads must go through adapter.readFile")
  })

  void it("uses adapter.getRelativePath for path conversion", () => {
    assert.ok(contextEngineSource.includes("this.adapter.getRelativePath("), "path conversion must go through adapter.getRelativePath")
  })
})

void describe("VSCodeWorkspaceAdapter", () => {
  const adapterImplDir = path.join(__dirname, "VSCodeWorkspaceAdapter.ts")
  let vscodeAdapterSource: string
  try {
    vscodeAdapterSource = readFileSync(adapterImplDir, "utf8")
  } catch {
    vscodeAdapterSource = ""
  }

  void it("exists as a file", () => {
    assert.ok(vscodeAdapterSource.length > 0, "VSCodeWorkspaceAdapter.ts must exist")
  })

  void it("exports VSCodeWorkspaceAdapter class", () => {
    assert.ok(vscodeAdapterSource.includes("export class VSCodeWorkspaceAdapter"))
  })

  void it("implements WorkspaceAdapter", () => {
    assert.ok(vscodeAdapterSource.includes("implements WorkspaceAdapter"))
  })

  void it("imports vscode for real API access", () => {
    assert.ok(vscodeAdapterSource.includes('import * as vscode'))
  })
})

void describe("extension.ts initContextEngine", () => {
  void it("creates VSCodeWorkspaceAdapter and passes to ContextEngine", () => {
    assert.ok(
      extensionSource.includes("new VSCodeWorkspaceAdapter()") || extensionSource.includes("VSCodeWorkspaceAdapter"),
      "initContextEngine must create VSCodeWorkspaceAdapter",
    )
  })

  void it("passes adapter to new ContextEngine(adapter)", () => {
    assert.ok(
      extensionSource.includes("new ContextEngine(") && (extensionSource.includes("adapter") || extensionSource.includes("VSCodeWorkspaceAdapter")),
      "initContextEngine must pass adapter to ContextEngine constructor",
    )
  })
})
