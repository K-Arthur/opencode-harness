import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { ActiveFileTracker } from "./ActiveFileTracker"

interface FakeSelection {
  start: { line: number; character: number }
  end: { line: number; character: number }
  isEmpty: boolean
}

interface FakeEditor {
  document: {
    uri: { fsPath: string }
    languageId: string
    lineCount: number
    getText: (sel?: FakeSelection) => string
  }
  selection: FakeSelection
}

function makeDeps() {
  const posted: Array<Record<string, unknown>> = []
  let activeEditor: FakeEditor | undefined
  const fakeWorkspaceFileIndex = {
    asRelativePath: (uri: { fsPath: string }) => {
      const p = uri.fsPath
      if (!p.startsWith("/workspace/")) return null
      return p.replace("/workspace/", "")
    },
    handleGetFiles: () => {},
  }
  const deps = {
    vscode: {
      window: {
        onDidChangeActiveTextEditor: (cb: (editor: unknown) => void) => {
          ;(deps as unknown as { _editorCb: (e: unknown) => void })._editorCb = cb
          return { dispose: () => {} }
        },
        onDidChangeTextEditorSelection: (_cb: (event: { textEditor: unknown }) => void) => {
          return { dispose: () => {} }
        },
        get activeTextEditor() { return activeEditor },
        set activeTextEditor(v: typeof activeEditor) { activeEditor = v },
      },
      workspace: {
        workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
        asRelativePath: (uri: { fsPath: string }) => uri.fsPath.replace("/workspace/", ""),
        openTextDocument: async (_uri: { fsPath: string }) => ({
          getText: (sel?: FakeSelection) => sel && !sel.isEmpty ? "selected text" : "line1\nline2\nline3",
          languageId: "typescript",
          lineCount: 3,
        }),
      },
    } as unknown as typeof import("vscode"),
    postMessage: (m: Record<string, unknown>) => posted.push(m),
    workspaceFileIndex: fakeWorkspaceFileIndex as unknown as import("./WorkspaceFileIndex").WorkspaceFileIndex,
  }
  return { deps, posted, setActiveEditor: (e: typeof activeEditor) => { activeEditor = e } }
}

function makeEditor(fsPath: string, selection?: FakeSelection): FakeEditor {
  const sel: FakeSelection = selection ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 }, isEmpty: true }
  return {
    document: {
      uri: { fsPath },
      languageId: "typescript",
      lineCount: 10,
      getText: (s?: FakeSelection) => s && !s.isEmpty ? "selected text" : "line1\nline2\nline3",
    },
    selection: sel,
  }
}

function makeSelection(startLine: number, endLine: number): FakeSelection {
  return {
    start: { line: startLine - 1, character: 0 },
    end: { line: endLine - 1, character: 5 },
    isEmpty: false,
  }
}

describe("ActiveFileTracker", () => {
  it("posts active_file message with relative path on editor change", () => {
    const { deps, posted, setActiveEditor } = makeDeps()
    const tracker = new ActiveFileTracker(deps)
    setActiveEditor(makeEditor("/workspace/src/main.ts"))
    tracker.start()
    assert.equal(posted.length, 1)
    assert.equal(posted[0]!.type, "active_file")
    assert.equal(posted[0]!.path, "src/main.ts")
    tracker.dispose()
  })

  it("posts active_file with null path when no editor is open", () => {
    const { deps, posted, setActiveEditor } = makeDeps()
    const tracker = new ActiveFileTracker(deps)
    setActiveEditor(undefined)
    tracker.start()
    assert.equal(posted.length, 1)
    assert.equal(posted[0]!.type, "active_file")
    assert.equal(posted[0]!.path, null)
    tracker.dispose()
  })

  it("posts selection info when editor has a non-empty selection", () => {
    const { deps, posted, setActiveEditor } = makeDeps()
    const tracker = new ActiveFileTracker(deps)
    setActiveEditor(makeEditor("/workspace/src/main.ts", makeSelection(5, 10)))
    tracker.start()
    assert.equal(posted.length, 1)
    assert.equal(posted[0]!.type, "active_file")
    assert.equal(posted[0]!.path, "src/main.ts")
    const selection = posted[0]!.selection as { startLine: number; endLine: number; text: string } | null
    assert.ok(selection, "selection should be present")
    assert.equal(selection!.startLine, 5)
    assert.equal(selection!.endLine, 10)
    assert.equal(selection!.text, "selected text")
    tracker.dispose()
  })

  it("posts null selection when editor has no selection", () => {
    const { deps, posted, setActiveEditor } = makeDeps()
    const tracker = new ActiveFileTracker(deps)
    setActiveEditor(makeEditor("/workspace/src/main.ts"))
    tracker.start()
    assert.equal(posted[0]!.selection, null)
    tracker.dispose()
  })

  it("handleToggleActiveFile records include state per session", () => {
    const { deps } = makeDeps()
    const tracker = new ActiveFileTracker(deps)
    tracker.handleToggleActiveFile("session-1", true)
    assert.equal(tracker.isIncluded("session-1"), true)
    tracker.handleToggleActiveFile("session-1", false)
    assert.equal(tracker.isIncluded("session-1"), false)
    tracker.dispose()
  })

  it("isIncluded returns false for unknown sessions", () => {
    const { deps } = makeDeps()
    const tracker = new ActiveFileTracker(deps)
    assert.equal(tracker.isIncluded("unknown"), false)
    tracker.dispose()
  })

  it("getActiveFileContent returns full content when no selection", async () => {
    const { deps, setActiveEditor } = makeDeps()
    const tracker = new ActiveFileTracker(deps)
    setActiveEditor(makeEditor("/workspace/src/main.ts"))
    tracker.start()
    const content = await tracker.getActiveFileContent()
    assert.ok(content)
    assert.equal(content!.path, "src/main.ts")
    assert.equal(content!.languageId, "typescript")
    assert.equal(content!.content, "line1\nline2\nline3")
    assert.equal(content!.selection, undefined)
    tracker.dispose()
  })

  it("getActiveFileContent returns selected text when selection exists", async () => {
    const { deps, setActiveEditor } = makeDeps()
    const tracker = new ActiveFileTracker(deps)
    setActiveEditor(makeEditor("/workspace/src/main.ts", makeSelection(5, 10)))
    tracker.start()
    const content = await tracker.getActiveFileContent()
    assert.ok(content)
    assert.equal(content!.content, "selected text")
    assert.ok(content!.selection, "selection should be present")
    assert.equal(content!.selection!.startLine, 5)
    assert.equal(content!.selection!.endLine, 10)
    tracker.dispose()
  })

  it("getActiveFileContent returns null when no editor is open", async () => {
    const { deps, setActiveEditor } = makeDeps()
    const tracker = new ActiveFileTracker(deps)
    setActiveEditor(undefined)
    tracker.start()
    const content = await tracker.getActiveFileContent()
    assert.equal(content, null)
    tracker.dispose()
  })

  it("clearSession removes toggle state for that session", () => {
    const { deps } = makeDeps()
    const tracker = new ActiveFileTracker(deps)
    tracker.handleToggleActiveFile("session-1", true)
    tracker.clearSession("session-1")
    assert.equal(tracker.isIncluded("session-1"), false)
    tracker.dispose()
  })
})
