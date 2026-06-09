import * as vscode from "vscode"
import type { SessionManager, OpencodeEvent } from "../session/SessionManager"
import { log } from "../utils/outputChannel"

const WRITE_TOOL_NAMES = new Set([
  "write_file", "edit_file", "create_file", "patch_file",
  "Write", "Edit", "Patch", "Create",
  "write", "edit", "patch", "create",
])

function isWriteTool(toolName: string): boolean {
  return WRITE_TOOL_NAMES.has(toolName) ||
    toolName.toLowerCase().includes("write") ||
    toolName.toLowerCase().includes("edit")
}

function extractFilePath(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined
  const obj = input as Record<string, unknown>
  const p = obj["path"] ?? obj["file_path"] ?? obj["filePath"] ?? obj["filename"]
  return typeof p === "string" ? p : undefined
}

function findEditor(filePath: string): vscode.TextEditor | undefined {
  return vscode.window.visibleTextEditors.find((e) => {
    const editorPath = e.document.uri.fsPath
    return editorPath === filePath || editorPath.endsWith(filePath) || filePath.endsWith(e.document.uri.path)
  })
}

export class AgentGazeService implements vscode.Disposable {
  private disposables: vscode.Disposable[] = []
  private clearTimeouts = new Set<ReturnType<typeof setTimeout>>()

  private readonly readDecoration = vscode.window.createTextEditorDecorationType({
    overviewRulerLane: vscode.OverviewRulerLane.Left,
    overviewRulerColor: new vscode.ThemeColor("charts.blue"),
    backgroundColor: new vscode.ThemeColor("diffEditor.unchangedRegionBackground"),
    borderWidth: "0 0 0 3px",
    borderStyle: "solid",
    borderColor: new vscode.ThemeColor("charts.blue"),
  })

  private readonly writeProgressDecoration = vscode.window.createTextEditorDecorationType({
    overviewRulerLane: vscode.OverviewRulerLane.Left,
    overviewRulerColor: new vscode.ThemeColor("charts.yellow"),
    backgroundColor: new vscode.ThemeColor("diffEditor.insertedLineBackground"),
    borderWidth: "0 0 0 3px",
    borderStyle: "solid",
    borderColor: new vscode.ThemeColor("charts.yellow"),
  })

  private readonly writeAppliedDecoration = vscode.window.createTextEditorDecorationType({
    overviewRulerLane: vscode.OverviewRulerLane.Left,
    overviewRulerColor: new vscode.ThemeColor("charts.green"),
    backgroundColor: new vscode.ThemeColor("diffEditor.insertedTextBackground"),
    borderWidth: "0 0 0 3px",
    borderStyle: "solid",
    borderColor: new vscode.ThemeColor("charts.green"),
  })

  constructor(sessionManager: SessionManager) {
    const sub = sessionManager.subscribe("agent-gaze", (event: OpencodeEvent) => {
      this.handleEvent(event)
    })
    this.disposables.push(sub)
  }

  private handleEvent(event: OpencodeEvent): void {
    if (event.type === "tool_start") {
      this.onToolStart(event)
    } else if (event.type === "tool_end") {
      this.onToolEnd(event)
    }
  }

  private onToolStart(event: OpencodeEvent): void {
    const data = event.data as { tool?: string; input?: unknown } | undefined
    if (!data?.tool) return

    const filePath = extractFilePath(data.input)

    // Always clear previous read decorations on each new tool call
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.readDecoration, [])
    }

    if (!filePath) return

    const editor = findEditor(filePath)
    if (!editor) return

    const wholeDoc = new vscode.Range(0, 0, editor.document.lineCount - 1, 0)

    if (isWriteTool(data.tool)) {
      editor.setDecorations(this.writeProgressDecoration, [wholeDoc])
    } else {
      editor.setDecorations(this.readDecoration, [wholeDoc])
    }
  }

  private onToolEnd(event: OpencodeEvent): void {
    const data = event.data as { tool?: string; ok?: boolean } | undefined
    if (!data?.tool || !isWriteTool(data.tool)) return

    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.writeProgressDecoration, [])
      const wholeDoc = new vscode.Range(0, 0, editor.document.lineCount - 1, 0)
      if (data.ok !== false) {
        editor.setDecorations(this.writeAppliedDecoration, [wholeDoc])
        const t = setTimeout(() => {
          try {
            editor.setDecorations(this.writeAppliedDecoration, [])
          } catch {
            // editor may have been closed
          }
          this.clearTimeouts.delete(t)
        }, 3000)
        this.clearTimeouts.add(t)
      }
    }

    log.info(`AgentGaze: tool_end ${data.tool}`)
  }

  dispose(): void {
    for (const t of this.clearTimeouts) clearTimeout(t)
    this.clearTimeouts.clear()
    this.readDecoration.dispose()
    this.writeProgressDecoration.dispose()
    this.writeAppliedDecoration.dispose()
    for (const d of this.disposables) d.dispose()
    this.disposables = []
  }
}
