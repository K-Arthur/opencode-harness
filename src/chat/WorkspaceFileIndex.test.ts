import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as vscode from "vscode"
import { WorkspaceFileIndex } from "./WorkspaceFileIndex"

function makeWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "ofh-wfi-"))
  mkdirSync(join(root, "src", "controllers"), { recursive: true })
  mkdirSync(join(root, "node_modules", "foo"), { recursive: true })
  writeFileSync(join(root, "src", "controllers", "DashboardController.php"), "")
  writeFileSync(join(root, "src", "controllers", "HomeController.php"), "")
  writeFileSync(join(root, "README.md"), "")
  writeFileSync(join(root, "node_modules", "foo", "index.js"), "")
  return root
}

function fakeWorkspaceFsPath(root: string): vscode.Uri {
  return { fsPath: root } as vscode.Uri
}

describe("WorkspaceFileIndex", () => {
  let root: string
  let index: WorkspaceFileIndex
  let posted: Array<Record<string, unknown>>

  beforeEach(() => {
    root = makeWorkspace()
    posted = []
  })

  afterEach(() => {
    index?.dispose()
    rmSync(root, { recursive: true, force: true })
  })

  it("indexes workspace files excluding node_modules", async () => {
    const deps = {
      vscode: {
        workspace: {
          workspaceFolders: [{ uri: fakeWorkspaceFsPath(root) }],
          findFiles: async () => [
            fakeWorkspaceFsPath(join(root, "src", "controllers", "DashboardController.php")),
            fakeWorkspaceFsPath(join(root, "src", "controllers", "HomeController.php")),
            fakeWorkspaceFsPath(join(root, "README.md")),
            fakeWorkspaceFsPath(join(root, "node_modules", "foo", "index.js")),
          ],
          asRelativePath: (uri: vscode.Uri) => uri.fsPath.replace(root + "/", ""),
          onDidCreateFiles: () => ({ dispose: () => {} }),
          onDidDeleteFiles: () => ({ dispose: () => {} }),
          onDidRenameFiles: () => ({ dispose: () => {} }),
        },
      } as unknown as typeof vscode,
      postMessage: (m: Record<string, unknown>) => posted.push(m),
    }
    index = new WorkspaceFileIndex(deps)
    await index.refresh()
    const files = index.getFiles()
    assert.deepEqual(files.sort(), [
      "README.md",
      "src/controllers/DashboardController.php",
      "src/controllers/HomeController.php",
    ])
    assert.ok(!files.some((f) => f.includes("node_modules")), "node_modules must be excluded")
  })

  it("responds to get_workspace_files by posting workspace_files", async () => {
    const deps = {
      vscode: {
        workspace: {
          workspaceFolders: [{ uri: fakeWorkspaceFsPath(root) }],
          findFiles: async () => [fakeWorkspaceFsPath(join(root, "README.md"))],
          asRelativePath: (uri: vscode.Uri) => uri.fsPath.replace(root + "/", ""),
          onDidCreateFiles: () => ({ dispose: () => {} }),
          onDidDeleteFiles: () => ({ dispose: () => {} }),
          onDidRenameFiles: () => ({ dispose: () => {} }),
        },
      } as unknown as typeof vscode,
      postMessage: (m: Record<string, unknown>) => posted.push(m),
    }
    index = new WorkspaceFileIndex(deps)
    await index.refresh()
    index.handleGetFiles()
    assert.equal(posted.length, 1)
    const msg = posted[0]
    if (!msg) {
      assert.fail("expected workspace_files message")
      return
    }
    assert.equal(msg.type, "workspace_files")
    assert.deepEqual(msg.files, ["README.md"])
  })

  it("returns empty list when no workspace folder is open", async () => {
    const deps = {
      vscode: {
        workspace: {
          workspaceFolders: undefined,
          findFiles: async () => [],
          asRelativePath: (uri: vscode.Uri) => uri.fsPath,
          onDidCreateFiles: () => ({ dispose: () => {} }),
          onDidDeleteFiles: () => ({ dispose: () => {} }),
          onDidRenameFiles: () => ({ dispose: () => {} }),
        },
      } as unknown as typeof vscode,
      postMessage: () => {},
    }
    index = new WorkspaceFileIndex(deps)
    await index.refresh()
    assert.deepEqual(index.getFiles(), [])
  })

  it("asRelativePath returns the workspace-relative path or null", () => {
    const deps = {
      vscode: {
        workspace: {
          workspaceFolders: [{ uri: fakeWorkspaceFsPath(root) }],
          findFiles: async () => [],
          asRelativePath: (uri: vscode.Uri) => uri.fsPath,
          onDidCreateFiles: () => ({ dispose: () => {} }),
          onDidDeleteFiles: () => ({ dispose: () => {} }),
          onDidRenameFiles: () => ({ dispose: () => {} }),
        },
      } as unknown as typeof vscode,
      postMessage: () => {},
    }
    index = new WorkspaceFileIndex(deps)
    assert.equal(index.asRelativePath(fakeWorkspaceFsPath(join(root, "src", "a.ts"))), "src/a.ts")
    assert.equal(index.asRelativePath(fakeWorkspaceFsPath("/tmp/other.ts")), null)
  })

  it("asRelativePath handles Windows-style backslash separators", () => {
    const winRoot = "C:\\workspace"
    const deps = {
      vscode: {
        workspace: {
          workspaceFolders: [{ uri: { fsPath: winRoot } as vscode.Uri }],
          findFiles: async () => [],
          asRelativePath: (uri: vscode.Uri) => uri.fsPath,
          onDidCreateFiles: () => ({ dispose: () => {} }),
          onDidDeleteFiles: () => ({ dispose: () => {} }),
          onDidRenameFiles: () => ({ dispose: () => {} }),
        },
      } as unknown as typeof vscode,
      postMessage: () => {},
    }
    index = new WorkspaceFileIndex(deps)
    assert.equal(index.asRelativePath({ fsPath: "C:\\workspace\\src\\a.ts" } as vscode.Uri), "src\\a.ts")
    assert.equal(index.asRelativePath({ fsPath: "C:\\other\\a.ts" } as vscode.Uri), null)
  })

  it("pushes workspace_files to webview after file watcher fires", async () => {
    let createHandler: (() => void) | null = null
    const deps = {
      vscode: {
        workspace: {
          workspaceFolders: [{ uri: fakeWorkspaceFsPath(root) }],
          findFiles: async () => [fakeWorkspaceFsPath(join(root, "README.md"))],
          asRelativePath: (uri: vscode.Uri) => uri.fsPath.replace(root + "/", ""),
          onDidCreateFiles: (handler: () => void) => { createHandler = handler; return { dispose: () => {} } },
          onDidDeleteFiles: () => ({ dispose: () => {} }),
          onDidRenameFiles: () => ({ dispose: () => {} }),
        },
      } as unknown as typeof vscode,
      postMessage: (m: Record<string, unknown>) => posted.push(m),
    }
    index = new WorkspaceFileIndex(deps)
    await index.refresh()
    index.watch()
    assert.equal(posted.length, 0)
    const handler = createHandler as (() => void) | null
    if (handler) {
      handler()
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(posted.length, 1)
    const msg = posted[0]
    if (msg) {
      assert.equal(msg.type, "workspace_files")
      assert.deepEqual(msg.files, ["README.md"])
    }
  })
})
