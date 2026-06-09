import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { randomUUID } from "crypto"
import type { SavedImage } from "./types"

function getTempDir(): string {
  const tempDir = path.join(os.tmpdir(), "opencode-easy-vision")
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true })
  }
  return tempDir
}

function mimeToExtension(mime: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/bmp": "bmp",
  }
  return map[mime] || "png"
}

function parseDataUrl(dataUrl: string): { mime: string; data: Buffer } | null {
  const match = dataUrl.match(/^data:([^;]+)(;base64)?,(.*)$/)
  if (!match) {
    return null
  }

  const mime = match[1]
  const isBase64 = !!match[2]
  const encodedData = match[3]

  if (isBase64) {
    try {
      return {
        mime,
        data: Buffer.from(encodedData, "base64"),
      }
    } catch {
      return null
    }
  }

  return {
    mime,
    data: Buffer.from(decodeURIComponent(encodedData)),
  }
}

export function saveImageFromDataUrl(dataUrl: string, partId?: string): SavedImage | null {
  const parsed = parseDataUrl(dataUrl)
  if (!parsed) {
    return null
  }

  const tempDir = getTempDir()
  const ext = mimeToExtension(parsed.mime)
  const filename = `${randomUUID()}.${ext}`
  const filePath = path.join(tempDir, filename)

  try {
    fs.writeFileSync(filePath, parsed.data)
    return {
      path: filePath,
      mime: parsed.mime,
      partId,
    }
  } catch (err) {
    console.warn(`[opencode-easy-vision] Failed to save image: ${err}`)
    return null
  }
}

export function cleanupOldImages(maxAgeMs: number = 60 * 60 * 1000): void {
  const tempDir = getTempDir()
  if (!fs.existsSync(tempDir)) {
    return
  }

  try {
    const files = fs.readdirSync(tempDir)
    const now = Date.now()

    for (const file of files) {
      const filePath = path.join(tempDir, file)
      try {
        const stats = fs.statSync(filePath)
        if (now - stats.mtimeMs > maxAgeMs) {
          fs.unlinkSync(filePath)
        }
      } catch {
        // Skip files we can't stat/delete
      }
    }
  } catch {
    // Ignore errors during cleanup
  }
}

export { getTempDir, parseDataUrl, mimeToExtension }
