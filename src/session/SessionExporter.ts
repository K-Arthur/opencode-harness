import type * as vscode from "vscode"
import * as os from "node:os"
import * as path from "node:path"
import { type OpenCodeSession } from "./SessionStore"

export class SessionExporter {
  /**
   * Generate a Markdown string from a session.
   */
  markdown(session: OpenCodeSession, selection?: number[]): string {
    const lines: string[] = []

    const startDate = new Date(session.createdAt).toISOString()
    const endDate = new Date(session.lastActiveAt).toISOString()

    lines.push(`# ${session.name}`)
    lines.push("")
    lines.push(`- **Date Range:** ${startDate} — ${endDate}`)
    lines.push(`- **Model:** ${session.model || "default"}`)
    lines.push(`- **Message Count:** ${session.messages.length}`)

    const toolCalls = this.toolCount(session, selection)
    const diffs = this.diffCount(session, selection)
    lines.push(`- **Tool Calls:** ${toolCalls}`)
    lines.push(`- **Diffs:** ${diffs}`)
    lines.push(`- **Cost:** $${(session.cost || 0).toFixed(4)}`)
    lines.push("")
    lines.push("---")
    lines.push("")

    const messages = selection ? selection.map(i => session.messages[i]).filter((m): m is NonNullable<typeof m> => m !== undefined) : session.messages

    for (const msg of messages) {
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
   * Generate a JSON string from a session.
   */
  json(session: OpenCodeSession, selection?: number[]): string {
    const messages = selection ? selection.map(i => session.messages[i]).filter((m): m is NonNullable<typeof m> => m !== undefined) : session.messages

    const exportData = {
      id: session.id,
      name: session.name,
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
      model: session.model,
      cost: session.cost || 0,
      messages: messages.map(msg => ({
        id: msg.id,
        role: msg.role,
        timestamp: msg.timestamp,
        blocks: msg.blocks.map(block => {
          if (block.type === "text") {
            return { type: "text", text: block.text }
          } else if (block.type === "tool_call") {
            return {
              type: "tool_call",
              toolName: block.toolName,
              args: block.args,
              result: block.result ? this.truncate(String(block.result), 5000) : undefined,
            }
          } else if (block.type === "diff") {
            return {
              type: "diff",
              fileName: block.fileName,
              diffText: block.diffText,
            }
          }
          return block
        }),
      })),
    }

    return JSON.stringify(exportData, null, 2)
  }

  /**
   * Generate a plain text string from a session.
   */
  plainText(session: OpenCodeSession, selection?: number[]): string {
    const lines: string[] = []

    const startDate = new Date(session.createdAt).toISOString()
    const endDate = new Date(session.lastActiveAt).toISOString()

    lines.push(`Session: ${session.name}`)
    lines.push(`Date Range: ${startDate} — ${endDate}`)
    lines.push(`Model: ${session.model || "default"}`)
    lines.push(`Message Count: ${session.messages.length}`)
    lines.push(`Tool Calls: ${this.toolCount(session, selection)}`)
    lines.push(`Diffs: ${this.diffCount(session, selection)}`)
    lines.push(`Cost: $${(session.cost || 0).toFixed(4)}`)
    lines.push("")
    lines.push("".padEnd(50, "="))
    lines.push("")

    const messages = selection ? selection.map(i => session.messages[i]).filter((m): m is NonNullable<typeof m> => m !== undefined) : session.messages

    for (const msg of messages) {
      const ts = new Date(msg.timestamp || Date.now()).toISOString()
      const roleLabel = msg.role === "user" ? "User" : msg.role === "assistant" ? "OpenCode" : "System"
      lines.push(`${roleLabel} — ${ts}`)
      lines.push("")

      for (const block of msg.blocks) {
        if (block.type === "text" && block.text) {
          lines.push(String(block.text))
          lines.push("")
        } else if (block.type === "tool_call") {
          const name = String(block.toolName || "unknown")
          lines.push(`[Tool: ${name}]`)
          if (block.args) {
            lines.push(`Arguments: ${JSON.stringify(block.args)}`)
          }
          if (block.result) {
            lines.push(`Result: ${this.truncate(String(block.result), 2000)}`)
          }
          lines.push("")
        } else if (block.type === "diff") {
          const fileName = String(block.fileName || "unknown")
          lines.push(`[Diff for: ${fileName}]`)
          lines.push(String(block.diffText || ""))
          lines.push("")
        }
      }

      lines.push("".padEnd(30, "-"))
      lines.push("")
    }

    return lines.join("\n")
  }

  /**
   * Show save dialog and write the Markdown file.
   * Defaults to ~/Desktop/{session-title}.md.
   */
  async exportMarkdown(session: OpenCodeSession, selection?: number[]): Promise<vscode.Uri | undefined> {
    const vscode = await import("vscode")
    const safeName = session.name.replace(/[^a-zA-Z0-9-_ ]/g, "").replace(/\s+/g, "_") || "session"
    const desktopPath = path.join(os.homedir(), "Desktop", `${safeName}.md`)
    const defaultUri = vscode.Uri.file(desktopPath)

    const uri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { "Markdown": ["md"], "All Files": ["*"] },
      title: "Export Session",
    })

    if (!uri) return undefined

    const content = this.markdown(session, selection)
    const encoder = new TextEncoder()
    await vscode.workspace.fs.writeFile(uri, encoder.encode(content))

    vscode.window.showInformationMessage(`Session exported to ${uri.fsPath}`)

    return uri
  }

  /**
   * Show save dialog and write the JSON file.
   * Defaults to ~/Desktop/{session-title}.json.
   */
  async exportJson(session: OpenCodeSession, selection?: number[]): Promise<vscode.Uri | undefined> {
    const vscode = await import("vscode")
    const safeName = session.name.replace(/[^a-zA-Z0-9-_ ]/g, "").replace(/\s+/g, "_") || "session"
    const desktopPath = path.join(os.homedir(), "Desktop", `${safeName}.json`)
    const defaultUri = vscode.Uri.file(desktopPath)

    const uri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { "JSON": ["json"], "All Files": ["*"] },
      title: "Export Session as JSON",
    })

    if (!uri) return undefined

    const content = this.json(session, selection)
    const encoder = new TextEncoder()
    await vscode.workspace.fs.writeFile(uri, encoder.encode(content))

    vscode.window.showInformationMessage(`Session exported to ${uri.fsPath}`)

    return uri
  }

  /**
   * Show save dialog and write the plain text file.
   * Defaults to ~/Desktop/{session-title}.txt.
   */
  async exportPlainText(session: OpenCodeSession, selection?: number[]): Promise<vscode.Uri | undefined> {
    const vscode = await import("vscode")
    const safeName = session.name.replace(/[^a-zA-Z0-9-_ ]/g, "").replace(/\s+/g, "_") || "session"
    const desktopPath = path.join(os.homedir(), "Desktop", `${safeName}.txt`)
    const defaultUri = vscode.Uri.file(desktopPath)

    const uri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { "Plain Text": ["txt"], "All Files": ["*"] },
      title: "Export Session as Plain Text",
    })

    if (!uri) return undefined

    const content = this.plainText(session, selection)
    const encoder = new TextEncoder()
    await vscode.workspace.fs.writeFile(uri, encoder.encode(content))

    vscode.window.showInformationMessage(`Session exported to ${uri.fsPath}`)

    return uri
  }

  private toolCount(session: OpenCodeSession, selection?: number[]): number {
    let count = 0
    const messages = selection ? selection.map(i => session.messages[i]).filter((m): m is NonNullable<typeof m> => m !== undefined) : session.messages
    for (const msg of messages) {
      for (const block of msg.blocks) {
        if (block.type === "tool_call") count++
      }
    }
    return count
  }

  private diffCount(session: OpenCodeSession, selection?: number[]): number {
    let count = 0
    const messages = selection ? selection.map(i => session.messages[i]).filter((m): m is NonNullable<typeof m> => m !== undefined) : session.messages
    for (const msg of messages) {
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
