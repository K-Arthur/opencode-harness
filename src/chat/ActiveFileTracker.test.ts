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
        get visibleTextEditors() { return activeEditor ? [activeEditor] : [] },
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

  it("repost re-delivers the current active file (covers the webview_ready race)", () => {
    const { deps, posted, setActiveEditor } = makeDeps()
    const tracker = new ActiveFileTracker(deps)
    setActiveEditor(makeEditor("/workspace/src/main.ts"))
    tracker.start()
    // start() posts once; the webview may not be ready to receive it yet.
    assert.equal(posted.length, 1)
    // The webview signals ready → host calls repost() to re-deliver.
    tracker.repost()
    assert.equal(posted.length, 2)
    assert.equal(posted[1]!.type, "active_file")
    assert.equal(posted[1]!.path, "src/main.ts")
    tracker.dispose()
  })

  it("repost reflects the editor active at repost time", () => {
    const { deps, posted, setActiveEditor } = makeDeps()
    const tracker = new ActiveFileTracker(deps)
    setActiveEditor(undefined)
    tracker.start()
    assert.equal(posted[0]!.path, null)
    setActiveEditor(makeEditor("/workspace/src/other.ts"))
    tracker.repost()
    assert.equal(posted[1]!.path, "src/other.ts")
    tracker.dispose()
  })

  it("suppresses active file for binary file types", () => {
    const { deps, posted, setActiveEditor } = makeDeps()
    const tracker = new ActiveFileTracker(deps)
    const editor = makeEditor("/workspace/image.png")
    editor.document.languageId = "png"
    setActiveEditor(editor)
    tracker.start()
    assert.equal(posted.length, 1)
    assert.equal(posted[0]!.type, "active_file")
    assert.equal(posted[0]!.path, null)
    assert.equal(posted[0]!.reason, "binary_file")
    tracker.dispose()
  })

  it("suppresses active file for files larger than 1 MB", () => {
    const { deps, posted, setActiveEditor } = makeDeps()
    const tracker = new ActiveFileTracker(deps)
    const editor = makeEditor("/workspace/large.ts")
    editor.document.getText = () => "x".repeat(2 * 1024 * 1024) // 2 MB
    setActiveEditor(editor)
    tracker.start()
    assert.equal(posted.length, 1)
    assert.equal(posted[0]!.type, "active_file")
    assert.equal(posted[0]!.path, null)
    assert.equal(posted[0]!.reason, "file_too_large")
    tracker.dispose()
  })

  it("allows active file for text files under 1 MB", () => {
    const { deps, posted, setActiveEditor } = makeDeps()
    const tracker = new ActiveFileTracker(deps)
    const editor = makeEditor("/workspace/src/main.ts")
    editor.document.getText = () => "x".repeat(500 * 1024) // 500 KB
    setActiveEditor(editor)
    tracker.start()
    assert.equal(posted.length, 1)
    assert.equal(posted[0]!.type, "active_file")
    assert.equal(posted[0]!.path, "src/main.ts")
    assert.equal(posted[0]!.reason, undefined)
    tracker.dispose()
  })
})
