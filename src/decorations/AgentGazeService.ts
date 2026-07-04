import * as vscode from "vscode"
import type { SessionManager, OpencodeEvent } from "../session/SessionManager"
import { log } from "../utils/outputChannel"
import { recordToolStart, resolveToolEndTarget } from "./agentGazePolicy"

function findEditor(filePath: string): vscode.TextEditor | undefined {
  return vscode.window.visibleTextEditors.find((e) => {
    const editorPath = e.document.uri.fsPath
    return editorPath === filePath || editorPath.endsWith(filePath) || filePath.endsWith(e.document.uri.path)
  })
}

export class AgentGazeService implements vscode.Disposable {
  private disposables: vscode.Disposable[] = []
  private clearTimeouts = new Set<ReturnType<typeof setTimeout>>()
  private toolPathMap = new Map<string, string>()

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

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("opencode.agentGaze.enabled")) {
          if (!this.isEnabled()) this.clearAllDecorations()
        }
      }),
    )
  }

  private isEnabled(): boolean {
    return vscode.workspace.getConfiguration("opencode").get<boolean>("agentGaze.enabled", true)
  }

  private clearAllDecorations(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.readDecoration, [])
      editor.setDecorations(this.writeProgressDecoration, [])
      editor.setDecorations(this.writeAppliedDecoration, [])
    }
  }

  private handleEvent(event: OpencodeEvent): void {
    if (!this.isEnabled()) return
    if (event.type === "tool_start") {
      this.onToolStart(event)
    } else if (event.type === "tool_end") {
      this.onToolEnd(event)
    }
  }

  private onToolStart(event: OpencodeEvent): void {
    const data = event.data as { id?: string; tool?: string; input?: unknown } | undefined
    if (!data?.tool) return

    // Record the file path for this tool call id so onToolEnd can resolve it
    if (data.id) {
      recordToolStart(this.toolPathMap, data.id, data.input)
    }

    // Clear previous read decorations only on the editor that had them
    // (clearing all visibleTextEditors here is acceptable at tool_start cadence)
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.readDecoration, [])
    }

    if (!data.id) return
    const filePath = this.toolPathMap.get(data.id)
    if (!filePath) return

    const editor = findEditor(filePath)
    if (!editor) return

    const wholeDoc = new vscode.Range(0, 0, editor.document.lineCount - 1, 0)
    editor.setDecorations(this.writeProgressDecoration, [wholeDoc])
  }

  private onToolEnd(event: OpencodeEvent): void {
    const data = event.data as { id?: string; tool?: string; ok?: boolean } | undefined
    if (!data?.tool) return

    // Resolve the target file path from the policy map (only write tools have one)
    const filePath = data.id ? resolveToolEndTarget(this.toolPathMap, data.id) : undefined

    // Clear write-progress decoration — only on the target editor if known,
    // otherwise fall back to clearing all visible editors (e.g. if tool_start
    // was missed and we have no mapping). This avoids stale yellow highlights.
    if (filePath) {
      findEditor(filePath)?.setDecorations(this.writeProgressDecoration, [])
    } else {
      for (const editor of vscode.window.visibleTextEditors) {
        editor.setDecorations(this.writeProgressDecoration, [])
      }
    }

    if (data.ok === false || !filePath) {
      log.info(`AgentGaze: tool_end ${data.tool}`)
      return
    }

    const editor = findEditor(filePath)
    if (editor) {
      const wholeDoc = new vscode.Range(0, 0, editor.document.lineCount - 1, 0)
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
