import { promises as fsp, existsSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"
import { randomBytes } from "node:crypto"

/**
 * Cross-platform attachment materialization for the opencode SDK prompt path.
 *
 * Why this exists:
 *  - The opencode server (and CLI) historically tries to read the system
 *    clipboard on Linux. When neither `wl-clipboard` nor `xclip` is installed,
 *    the server injects an error message ("no wl-clipboard/xclip available")
 *    into the prompt. The model then responds to that error instead of
 *    reading the image we attached via the SDK.
 *  - The server also stores pasted images as `data:` URLs, but several model
 *    providers and MCP image tools require a real file path they can read from
 *    disk. Sending a `file://` URL sidesteps both issues at once.
 *
 * Strategy:
 *  1. Decode the base64 attachment payload and write it to a real file under
 *     a per-extension temp directory.
 *  2. Hand the opencode server a `file://` URL that points at that file.
 *  3. Provide a `cleanup` API so we can delete the file once the server has
 *     read it (and a `cleanupAll` for extension shutdown).
 *  4. If writing to disk fails for any reason, fall back to a `data:` URL
 *     rather than failing the prompt — a degraded image is better than a
 *     missing message.
 */

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024 // 8 MiB per attachment (matches WebviewEventRouter cap)

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
}

export interface MaterializeInput {
  data: string // base64 (no `data:` prefix)
  mimeType: string
  /** Optional original filename, used as a hint for the on-disk extension. */
  filename?: string
}

export interface MaterializedAttachment {
  /** `file://...` on success, or `data:...` fallback if disk write failed. */
  url: string
  /** Echoes the MIME so the caller can wire it into FilePartInput. */
  mimeType: string
  /** True when we had to fall back to a data: URL because the filesystem rejected the write. */
  fellBackToDataUrl: boolean
}

export interface AttachmentStorageOptions {
  /** Directory under which attachment files are created. */
  rootDir?: string
  /** Node `process.platform` value (overridable for tests). */
  platform?: NodeJS.Platform
  /** Per-attachment decoded byte cap. Default 8 MiB. */
  maxBytes?: number
}

export interface AttachmentStorage {
  /** Decode a base64 attachment to disk and return a `file://` URL. */
  materialize(input: MaterializeInput): Promise<MaterializedAttachment>
  /** Remove the files referenced by the given URLs. Idempotent. */
  cleanup(urls: ReadonlyArray<string>): Promise<void>
  /** Remove every file this storage has materialized (extension teardown). */
  cleanupAll(): Promise<void>
  /** Remove every file AND the root directory. */
  dispose(): Promise<void>
}

/**
 * Convert an absolute filesystem path to a `file://` URL in a way that matches
 * what the opencode server expects on every platform.
 *
 *  - POSIX (linux, darwin, freebsd, ...): `file:///tmp/x.png`
 *  - Windows: `file:///C:/Users/.../x.png` (drive letter, forward slashes)
 *  - UNC Windows paths (`\\server\share\file`): `file://server/share/file`
 *    (Chromium-style; the opencode server reads via Node `fs` which is
 *    platform-native, so the server-side `file://` handler is the one that
 *    matters for the on-disk read — but the URL must round-trip cleanly).
 */
export function toFileUrl(absolutePath: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") {
    // Normalize backslashes to forward slashes — `file://` URLs are always
    // forward-slash per RFC 8089 even on Windows.
    const fwd = absolutePath.replace(/\\/g, "/")
    if (fwd.startsWith("//")) {
      // UNC: \\server\share\file -> file://server/share/file
      // (RFC 8089 allows file:// + //host/path; we collapse to a single /)
      return "file:" + fwd
    }
    // Drive letter (C:/, D:/, ...) or rooted path. Prepend file:///.
    if (/^[A-Za-z]:\//.test(fwd)) return "file:///" + fwd
    return "file://" + fwd
  }
  // POSIX: file:// + /absolute/path
  if (absolutePath.startsWith("/")) return "file://" + absolutePath
  return "file:///" + absolutePath
}

function extensionFor(mimeType: string, filename?: string): string {
  if (filename) {
    const dot = filename.lastIndexOf(".")
    if (dot > 0 && dot < filename.length - 1) {
      const ext = filename.slice(dot + 1).toLowerCase()
      // Whitelist so we never write e.g. ".exe" or ".sh" to disk.
      if (/^[a-z0-9]{1,5}$/.test(ext)) return ext
    }
  }
  return MIME_TO_EXT[mimeType] ?? "bin"
}

/**
 * Sentinel for input validation failures (malformed base64, oversize
 * payload). These propagate to the caller — they indicate a real bug in
 * the input, not a transient filesystem issue.
 */
export class AttachmentValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AttachmentValidationError"
  }
}

function freshRootDir(explicit?: string): string {
  if (explicit) {
    if (!existsSync(explicit)) mkdirSync(explicit, { recursive: true })
    return explicit
  }
  // `mkdtempSync` returns a unique empty dir; collision-free by construction.
  const dir = join(tmpdir(), `opencode-harness-attach-${randomBytes(6).toString("hex")}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function createAttachmentStorage(opts: AttachmentStorageOptions = {}): AttachmentStorage {
  const platform = opts.platform ?? process.platform
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  const rootDir = freshRootDir(opts.rootDir)
  const livePaths = new Set<string>()

  /** Magic byte prefixes for image formats supported by the opencode server. */
  const IMAGE_MAGIC_BYTES: Record<string, [number, ReadonlyArray<number>]> = {
    "image/png":  [0, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]],
    "image/jpeg": [0, [0xFF, 0xD8, 0xFF]],
    "image/gif":  [0, [0x47, 0x49, 0x46]],
    "image/webp": [0, [0x52, 0x49, 0x46, 0x46]], // RIFF header — the WEBP chunk marker at offset 8 is checked separately
  }

  /** Check that the decoded buffer starts with the expected magic bytes for the MIME type. */
  function validateMagicBytes(buf: Buffer, mimeType: string): void {
    // SVG is XML text, not a binary image format — skip magic-byte validation.
    if (mimeType === "image/svg+xml") return
    // Only validate image types that we have magic byte entries for.
    const entry = IMAGE_MAGIC_BYTES[mimeType]
    if (!entry) return // unknown/unsupported format — skip magic check
    const [offset, expected] = entry
    if (buf.length < offset + expected.length) {
      throw new AttachmentValidationError(
        `Attachment data too short (${buf.length} bytes) for ${mimeType} — expected at least ${offset + expected.length} bytes`,
      )
    }
    for (let i = 0; i < expected.length; i++) {
      if (buf[offset + i] !== expected[i]) {
        throw new AttachmentValidationError(
          `Attachment data has invalid magic bytes for ${mimeType} — file may be corrupted or mislabeled`,
        )
      }
    }
    // WebP: additionally verify the WEBP chunk marker at offset 8.
    if (mimeType === "image/webp") {
      if (buf.length < 12 || buf[8] !== 0x57 || buf[9] !== 0x45 || buf[10] !== 0x42 || buf[11] !== 0x50) {
        throw new AttachmentValidationError(
          "Attachment data has invalid WebP chunk marker — file may be corrupted",
        )
      }
      // Verify RIFF chunk size matches buffer length.
      const riffSize = buf.readUInt32LE(4)
      if (riffSize + 8 !== buf.length) {
        throw new AttachmentValidationError(
          `Attachment RIFF size mismatch: expected ${riffSize + 8} bytes, got ${buf.length}`,
        )
      }
    }
  }

  function decodeBase64(data: string, mimeType?: string): Buffer {
    if (typeof data !== "string" || data.length === 0) {
      throw new AttachmentValidationError("Attachment base64 payload is empty")
    }
    // Strict base64 alphabet: A-Z a-z 0-9 + / = (no whitespace, no URL-safe).
    // Node's Buffer.from is lenient (silently drops invalid chars and may
    // decode `!!!abc@@@` to a real but unrelated byte sequence) so we
    // pre-validate to surface clear errors instead of silent corruption.
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
      throw new AttachmentValidationError("Attachment base64 payload is malformed")
    }
    if (data.length % 4 !== 0) {
      throw new AttachmentValidationError("Attachment base64 payload has invalid length (not a multiple of 4)")
    }
    const buf = Buffer.from(data, "base64")
    if (buf.length === 0) {
      throw new AttachmentValidationError("Attachment base64 payload decoded to 0 bytes")
    }
    // Validate that the decoded bytes match the expected image format header.
    // This catches corrupted clipboard data and MIME-vs-content mismatches before
    // they reach the server and cause ImageDecodeError.
    if (mimeType) validateMagicBytes(buf, mimeType)
    return buf
  }

  async function writeFileAtomic(path: string, bytes: Buffer): Promise<void> {
    // Use a sibling temp path + rename so a partial write never leaves a
    // truncated file at the URL the server is about to fetch.
    const staging = `${path}.${randomBytes(4).toString("hex")}.tmp`
    await fsp.writeFile(staging, bytes)
    try {
      await fsp.rename(staging, path)
    } catch (err) {
      // Best-effort cleanup of the staging file.
      try { await fsp.unlink(staging) } catch { /* ignore */ }
      throw err
    }
  }

  function fallbackToDataUrl(input: MaterializeInput): MaterializedAttachment {
    return {
      url: `data:${input.mimeType};base64,${input.data}`,
      mimeType: input.mimeType,
      fellBackToDataUrl: true,
    }
  }

  return {
    async materialize(input: MaterializeInput): Promise<MaterializedAttachment> {
      try {
        const bytes = decodeBase64(input.data, input.mimeType)
        if (bytes.length > maxBytes) {
          throw new AttachmentValidationError(
            `Attachment decoded to ${bytes.length} bytes which exceeds the ${maxBytes}-byte per-item cap`,
          )
        }
        const ext = extensionFor(input.mimeType, input.filename)
        const filename = `${Date.now()}-${randomBytes(8).toString("hex")}.${ext}`
        const fullPath = join(rootDir, filename)
        await writeFileAtomic(fullPath, bytes)
        livePaths.add(fullPath)
        return {
          url: toFileUrl(fullPath, platform),
          mimeType: input.mimeType,
          fellBackToDataUrl: false,
        }
      } catch (err) {
        // Validation errors propagate to the caller — those are real
        // input bugs. Everything else (EACCES, ENOSPC, read-only mount,
        // path-too-long) is treated as a transient disk failure and
        // we degrade to a data: URL fallback rather than failing the
        // prompt.
        if (err instanceof AttachmentValidationError) throw err
        void err
        return fallbackToDataUrl(input)
      }
    },

    async cleanup(urls: ReadonlyArray<string>): Promise<void> {
      await Promise.all(urls.map(async (url) => {
        if (!url.startsWith("file://")) return // ignore data: and http(s): URLs
        const path = urlToPath(url, platform)
        if (!path) return
        livePaths.delete(path)
        try { await fsp.unlink(path) } catch { /* idempotent */ }
      }))
    },

    async cleanupAll(): Promise<void> {
      const paths = Array.from(livePaths)
      livePaths.clear()
      await Promise.all(paths.map(async (p) => {
        try { await fsp.unlink(p) } catch { /* idempotent */ }
      }))
    },

    async dispose(): Promise<void> {
      await this.cleanupAll()
      try { await fsp.rm(rootDir, { recursive: true, force: true }) } catch { /* ignore */ }
    },
  }
}

/**
 * Inverse of `toFileUrl`. Returns null for non-file URLs so callers can
 * safely ignore data: / http: / https: URLs in cleanup.
 */
export function urlToPath(url: string, platform: NodeJS.Platform = process.platform): string | null {
  if (!url.startsWith("file://")) return null
  const stripped = url.slice("file://".length)
  if (platform === "win32") {
    // file:///C:/... -> C:\...   (Node fs on Windows accepts both, but we
    // want to match the canonical form we wrote with toFileUrl).
    return stripped.replace(/\//g, sep)
  }
  return "/" + stripped
}
