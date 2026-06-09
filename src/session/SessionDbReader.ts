import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import { log } from "../utils/outputChannel"

export interface DbSession {
  id: string
  name: string
  model: string
  mode: string
  createdAt: number
  lastActiveAt: number
  messageCount: number
  cost?: number
}

export interface DbMessage {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  timestamp: number
}

/**
 * Read-only fallback reader for ~/.local/share/opencode/opencode.db
 * Uses Python3's sqlite3 module via child_process.
 * Only used when the OpenCode CLI server is not running.
 */
export class SessionDbReader {
  private readonly dbPath: string

  constructor() {
    if (process.platform === "win32") {
      const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Roaming")
      this.dbPath = path.join(appData, "opencode", "opencode.db")
    } else {
      const home = process.env.HOME || "~"
      this.dbPath = path.join(home, ".local", "share", "opencode", "opencode.db")
    }
  }

  getDbPath(): string {
    return this.dbPath
  }

  async isAvailable(): Promise<boolean> {
    try {
      await fs.promises.access(this.dbPath, fs.constants.R_OK)
      // Also verify it's a valid SQLite DB
      const { stdout } = await this.execPython(`
import sqlite3, os
try:
    conn = sqlite3.connect(${JSON.stringify(this.dbPath)})
    conn.execute("SELECT 1")
    conn.close()
    print("ok")
except Exception as e:
    print(f"error: {e}")
`)
      return stdout.trim() === "ok"
    } catch {
      return false
    }
  }

  async listSessions(): Promise<DbSession[]> {
    const sql = `
import sqlite3, json
try:
    conn = sqlite3.connect(${JSON.stringify(this.dbPath)})
    cur = conn.cursor()
    cur.execute("""
        SELECT id, name, model, mode, created_at, last_active_at, 
               (SELECT COUNT(*) FROM messages WHERE session_id = sessions.id) as msg_count,
               (SELECT SUM(cost) FROM messages WHERE session_id = sessions.id) as total_cost
        FROM sessions 
        ORDER BY last_active_at DESC 
        LIMIT 50
    """)
    rows = cur.fetchall()
    result = []
    for row in rows:
        result.append({
            "id": row[0],
            "name": row[1],
            "model": row[2] or "",
            "mode": row[3] or "build",
            "createdAt": row[4] or 0,
            "lastActiveAt": row[5] or 0,
            "messageCount": row[6] or 0,
            "cost": row[7]
        })
    print(json.dumps(result))
    conn.close()
except Exception as e:
    print(f"error: {e}")
`
    try {
      const { stdout } = await this.execPython(sql)
      if (stdout.trim().startsWith("error:")) return []
      const sessions = JSON.parse(stdout) as DbSession[]
      return sessions
    } catch (err) {
      log.error("Failed to list sessions from DB", err)
      return []
    }
  }

  async getMessages(sessionId: string): Promise<DbMessage[]> {
    const sql = `
import sqlite3, json
try:
    conn = sqlite3.connect(${JSON.stringify(this.dbPath)})
    cur = conn.cursor()
    cur.execute("""
        SELECT id, role, content, timestamp 
        FROM messages 
        WHERE session_id = ? 
        ORDER BY timestamp ASC
    """, [${JSON.stringify(sessionId)}])
    rows = cur.fetchall()
    result = []
    for row in rows:
        result.append({
            "id": row[0],
            "role": row[1],
            "content": row[2],
            "timestamp": row[3] or 0
        })
    print(json.dumps(result))
    conn.close()
except Exception as e:
    print(f"error: {e}")
`
    try {
      const { stdout } = await this.execPython(sql)
      if (stdout.trim().startsWith("error:")) return []
      const messages = JSON.parse(stdout) as DbMessage[]
      return messages
    } catch (err) {
      log.error("Failed to get messages from DB", err)
      return []
    }
  }

  private execPython(script: string): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const { exec } = require("child_process")
      const pythonCmd = process.platform === "win32" ? "python" : "python3"
      const proc = exec(`${pythonCmd} -c ${JSON.stringify(script)}`, { timeout: 10000 })
      let stdout = ""
      let stderr = ""
      proc.stdout?.on("data", (d: string) => { stdout += d })
      proc.stderr?.on("data", (d: string) => { stderr += d })
      proc.on("close", (code: number | null) => {
        if (code === 0) resolve({ stdout, stderr })
        else reject(new Error(stderr || `Python exited with code ${code}`))
      })
      proc.on("error", reject)
    })
  }
}
