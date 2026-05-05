import * as vscode from "vscode"
import * as os from "node:os"
import * as path from "node:path"
import { type OpenCodeSession } from "./SessionStore"
import { log } from "../utils/outputChannel"

export class SessionExporter {
  /**
   * Generate a Markdown string from a session.
   */
  markdown(session: OpenCodeSession): string {
    const lines: string[] = []

    const startDate = new Date(session.createdAt).toISOString()
    const endDate = new Date(session.lastActiveAt).toISOString()

    lines.push(`# ${session.name}`)
    lines.push("")
    lines.push(`- **Date Range:** ${startDate} — ${endDate}`)
    lines.push(`- **Model:** ${session.model || "default"}`)
    lines.push(`- **Message Count:** ${session.messages.length}`)

    const toolCalls = this.toolCount(session)
    const diffs = this.diffCount(session)
    lines.push(`- **Tool Calls:** ${toolCalls}`)
    lines.push(`- **Diffs:** ${diffs}`)
    lines.push(`- **Cost:** $${(session.cost || 0).toFixed(4)}`)
    lines.push("")
    lines.push("---")
    lines.push("")

    for (const msg of session.messages) {
      const ts = new Date(msg.timestamp || Date.now()).toISOString()
      const roleLabel = msg.role === "user" ? "User" : msg.role === "assistant" ? "OpenCode" : "System"
      lines.push(`### ${roleLabel} — ${ts}`)
      lines.push("")

      for (const block of msg.blocks) {
        if (block.type === "text" && block.text) {
          lines.push(String(block.text))
          lines.push("")
        } else if (block.type === "tool_call") {
          const name = String(block.toolName || "unknown")
          const args = block.args ? JSON.stringify(block.args, null, 2) : ""
          const result = block.result ? this.truncate(String(block.result), 2000) : ""
          lines.push(`<details>`)
          lines.push(`<summary>🔧 Tool: ${name}</summary>`)
          lines.push("")
          if (args) {
            lines.push("**Arguments:**")
            lines.push("```json")
            lines.push(args)
            lines.push("```")
            lines.push("")
          }
          if (result) {
            lines.push("**Result:**")
            lines.push("```")
            lines.push(result)
            lines.push("```")
            lines.push("")
          }
          lines.push(`</details>`)
          lines.push("")
        } else if (block.type === "diff") {
          const fileName = String(block.fileName || "unknown")
          const diffText = String(block.diffText || "")
          lines.push(`**File:** \`${fileName}\``)
          lines.push("")
          lines.push("```diff")
          lines.push(diffText)
          lines.push("```")
          lines.push("")
        }
      }

      lines.push("---")
      lines.push("")
    }

    return lines.join("\n")
  }

  /**
   * Show save dialog and write the Markdown file.
   * Defaults to ~/Desktop/{session-title}.md.
   */
  async exportMarkdown(session: OpenCodeSession): Promise<vscode.Uri | undefined> {
    const safeName = session.name.replace(/[^a-zA-Z0-9-_ ]/g, "").replace(/\s+/g, "_") || "session"
    const desktopPath = path.join(os.homedir(), "Desktop", `${safeName}.md`)
    const defaultUri = vscode.Uri.file(desktopPath)

    const uri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { "Markdown": ["md"], "All Files": ["*"] },
      title: "Export Session",
    })

    if (!uri) return undefined

    const content = this.markdown(session)
    const encoder = new TextEncoder()
    await vscode.workspace.fs.writeFile(uri, encoder.encode(content))

    log.info(`Session exported to ${uri.fsPath}`)
    vscode.window.showInformationMessage(`Session exported to ${uri.fsPath}`)

    return uri
  }

  private toolCount(session: OpenCodeSession): number {
    let count = 0
    for (const msg of session.messages) {
      for (const block of msg.blocks) {
        if (block.type === "tool_call") count++
      }
    }
    return count
  }

  private diffCount(session: OpenCodeSession): number {
    let count = 0
    for (const msg of session.messages) {
      for (const block of msg.blocks) {
        if (block.type === "diff") count++
      }
    }
    return count
  }

  private truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text
    return text.slice(0, maxLen) + "\n... (truncated)"
  }
}
