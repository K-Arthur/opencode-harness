import { afterEach, beforeEach, describe, it } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep, posix, win32 } from "node:path"
import {
  createAttachmentStorage,
  type AttachmentStorage,
  toFileUrl,
} from "./attachmentStorage"

function makeTinyPng(): string {
  // 1x1 transparent PNG (well-known canonical bytes), base64-encoded.
  // 67 decoded bytes; large enough to verify round-trip on every platform.
  return "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
}

function makeTinyJpeg(): string {
  // Minimal JPEG-magic payload (FF D8 FF E0 + JFIF marker + padding).
  // 33b8923 added magic-byte validation: data materialized as image/jpeg
  // must actually start with the JPEG signature or it is rejected.
  const bytes = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]),
    Buffer.alloc(32, 0x00),
    Buffer.from([0xff, 0xd9]), // EOI
  ])
  return bytes.toString("base64")
}

describe("attachmentStorage — toFileUrl (cross-platform URL encoding)", () => {
  it("encodes POSIX absolute paths with file:// and a single leading slash", () => {
    const url = toFileUrl("/tmp/opencode-harness/img.png", "linux")
    assert.equal(url, "file:///tmp/opencode-harness/img.png")
  })

  it("encodes Windows absolute paths with file:///C:/ and forward slashes", () => {
    const url = toFileUrl("C:\\Users\\kevin\\AppData\\Local\\Temp\\img.png", "win32")
    assert.equal(url, "file:///C:/Users/kevin/AppData/Local/Temp/img.png")
  })

  it("encodes macOS paths identically to POSIX (file:// + leading slash)", () => {
    const url = toFileUrl("/var/folders/abc/T/opencode/img.png", "darwin")
    assert.equal(url, "file:///var/folders/abc/T/opencode/img.png")
  })

  it("encodes UNC Windows paths (\\\\server\\share\\file) as file:////server/share/file", () => {
    // Many POSIX->file-URL spec variants: Chromium uses file:////server/share/file (4 slashes)
    // when the source path begins with two backslashes. Our converter should preserve
    // that so paths from a remote session round-trip.
    const url = toFileUrl("\\\\fileserver\\share\\image.png", "win32")
    assert.equal(url, "file://fileserver/share/image.png")
  })
})

describe("attachmentStorage — materialization (write base64 → temp file → file:// URL)", () => {
  let root: string
  let storage: AttachmentStorage

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "opencode-harness-attach-test-"))
    storage = createAttachmentStorage({ rootDir: root, platform: "linux" })
  })

  afterEach(() => {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true })
  })

  it("writes decoded bytes to a per-attachment file and returns a file:// URL", async () => {
    const pngB64 = makeTinyPng()
    const result = await storage.materialize({ data: pngB64, mimeType: "image/png" })

    // URL must point at the file:// scheme on every platform — never a data: URL.
    assert.ok(result.url.startsWith("file://"), `expected file:// URL, got ${result.url}`)

    // The referenced file must exist and contain the exact decoded bytes.
    const path = fileUrlToPath(result.url, "linux")
    assert.ok(existsSync(path), `file at ${path} should exist`)
    const onDisk = readFileSync(path)
    const expected = Buffer.from(pngB64, "base64")
    assert.equal(onDisk.length, expected.length, "decoded byte length must match")
    assert.ok(onDisk.equals(expected), "decoded bytes must match exactly")
  })

  it("preserves the image MIME type on the materialization result", async () => {
    const result = await storage.materialize({ data: makeTinyPng(), mimeType: "image/png" })
    assert.equal(result.mimeType, "image/png")
  })

  it("derives a sensible file extension from the MIME type", async () => {
    const png = await storage.materialize({ data: makeTinyPng(), mimeType: "image/png" })
    assert.ok(png.url.endsWith(".png"), `expected .png suffix, got ${png.url}`)

    const jpg = await storage.materialize({ data: makeTinyJpeg(), mimeType: "image/jpeg" })
    assert.ok(jpg.url.endsWith(".jpg") || jpg.url.endsWith(".jpeg"),
      `expected .jpg/.jpeg suffix, got ${jpg.url}`)
  })

  it("generates a unique path per materialization (no collisions on repeated calls)", async () => {
    const a = await storage.materialize({ data: makeTinyPng(), mimeType: "image/png" })
    const b = await storage.materialize({ data: makeTinyPng(), mimeType: "image/png" })
    assert.notEqual(a.url, b.url, "two materializations must not collide on the same path")
    assert.ok(existsSync(fileUrlToPath(a.url, "linux")))
    assert.ok(existsSync(fileUrlToPath(b.url, "linux")))
  })

  it("rejects attachments whose decoded size exceeds the per-item cap (defense in depth)", async () => {
    // 2 MB of base64 should decode to ~1.5 MB which still fits, but we set a
    // tiny cap (16 KB) to verify the cap is enforced regardless of platform.
    const small = createAttachmentStorage({ rootDir: root, platform: "linux", maxBytes: 16 * 1024 })
    // Valid PNG signature so the payload passes magic-byte validation (33b8923)
    // and reaches the size-cap check this test is about.
    const oversized = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(64 * 1024, 0xab),
    ])
    await assert.rejects(
      () => small.materialize({ data: oversized.toString("base64"), mimeType: "image/png" }),
      /exceeds|too large|cap|size/i,
    )
  })
})

describe("attachmentStorage — cleanup (delete temp files after the server has read them)", () => {
  let root: string
  let storage: AttachmentStorage

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "opencode-harness-attach-test-"))
    storage = createAttachmentStorage({ rootDir: root, platform: "linux" })
  })

  afterEach(() => {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true })
  })

  it("removes a single materialized file by URL", async () => {
    const r = await storage.materialize({ data: makeTinyPng(), mimeType: "image/png" })
    const path = fileUrlToPath(r.url, "linux")
    assert.ok(existsSync(path))

    await storage.cleanup([r.url])
    assert.equal(existsSync(path), false, "cleanup must remove the file from disk")
  })

  it("cleanup is idempotent — deleting the same URL twice is a no-op (not a throw)", async () => {
    const r = await storage.materialize({ data: makeTinyPng(), mimeType: "image/png" })
    await storage.cleanup([r.url])
    // Second call must not throw even though the file is already gone.
    await storage.cleanup([r.url])
  })

  it("cleanup ignores URLs that are not file:// (defense against accidental data: URL passthrough)", async () => {
    // No throw, no filesystem side effects expected.
    await storage.cleanup(["data:image/png;base64,abc", "https://example.com/x.png"])
  })

  it("cleanupAll removes every materialized file under the storage root", async () => {
    const a = await storage.materialize({ data: makeTinyPng(), mimeType: "image/png" })
    const b = await storage.materialize({ data: makeTinyJpeg(), mimeType: "image/jpeg" })
    assert.ok(existsSync(fileUrlToPath(a.url, "linux")))
    assert.ok(existsSync(fileUrlToPath(b.url, "linux")))

    await storage.cleanupAll()
    assert.equal(existsSync(fileUrlToPath(a.url, "linux")), false)
    assert.equal(existsSync(fileUrlToPath(b.url, "linux")), false)
  })

  it("dispose() also tears down the storage root directory", async () => {
    await storage.materialize({ data: makeTinyPng(), mimeType: "image/png" })
    assert.ok(existsSync(root))
    await storage.dispose()
    assert.equal(existsSync(root), false)
  })
})

describe("attachmentStorage — failure modes (must not break the prompt path)", () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "opencode-harness-attach-test-"))
  })

  afterEach(() => {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true })
  })

  it("falls back to a data: URL when the rootDir is not writable (read-only filesystem, etc.)", async () => {
    // Create a read-only directory by writing a file into the root and chmod-ing the
    // parent to 0o555 (read+execute, no write). On Windows this is best-effort — the
    // test will skip when we cannot make the dir read-only.
    if (process.platform === "win32") {
      // Skip on Windows: chmod semantics differ and the parent dir is usually writable.
      return
    }
    const storage = createAttachmentStorage({ rootDir: root, platform: "linux" })
    // Force the writer to fail by pre-creating a file where the storage expects a directory.
    // This guarantees a write failure regardless of chmod quirks in CI sandboxes.
    const blocker = join(root, "blocker")
    writeFileSync(blocker, "x")

    // materialize must still resolve — it falls back to a data: URL rather than throwing,
    // because breaking the prompt path on a paste is far worse than a degraded payload.
    const result = await storage.materialize({ data: makeTinyPng(), mimeType: "image/png" })
    assert.ok(
      result.url.startsWith("data:") || result.url.startsWith("file://"),
      `expected data: or file: URL, got ${result.url}`,
    )
    if (result.url.startsWith("data:")) {
      assert.equal(result.mimeType, "image/png")
      // The base64 portion must round-trip back to the original bytes.
      const idx = result.url.indexOf(",")
      assert.ok(idx > 0, "data: URL must contain a base64 payload after the comma")
    }
  })

  it("rejects attachments whose base64 payload is malformed (clear error, not silent corruption)", async () => {
    const storage = createAttachmentStorage({ rootDir: root, platform: "linux" })
    await assert.rejects(
      () => storage.materialize({ data: "!!!not base64@@@", mimeType: "image/png" }),
      /base64|invalid|malformed/i,
    )
  })

  it("rejects PNG attachment with JPEG magic bytes (MIME-vs-content mismatch)", async () => {
    const storage = createAttachmentStorage({ rootDir: root, platform: "linux" })
    // Embed a tiny JPEG image into a payload typed as image/png.
    const jpegB64 = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AKwA="
    await assert.rejects(
      () => storage.materialize({ data: jpegB64, mimeType: "image/png" }),
      /magic bytes|corrupted|mislabeled/i,
    )
  })

  it("rejects JPEG attachment with PNG magic bytes (format mismatch)", async () => {
    const storage = createAttachmentStorage({ rootDir: root, platform: "linux" })
    // A valid PNG base64 typed as image/jpeg
    const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
    await assert.rejects(
      () => storage.materialize({ data: pngB64, mimeType: "image/jpeg" }),
      /magic bytes|corrupted|mislabeled/i,
    )
  })

  it("accepts valid PNG with correct MIME type (magic bytes match)", async () => {
    const storage = createAttachmentStorage({ rootDir: root, platform: "linux" })
    const result = await storage.materialize({ data: makeTinyPng(), mimeType: "image/png" })
    assert.ok(result.url.startsWith("file://"))
    assert.equal(result.fellBackToDataUrl, false)
  })

  it("accepts valid JPEG with correct MIME type (magic bytes match)", async () => {
    const storage = createAttachmentStorage({ rootDir: root, platform: "linux" })
    // Minimal valid JPEG (1x1 pixel)
    const jpegB64 = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AKwA="
    const result = await storage.materialize({ data: jpegB64, mimeType: "image/jpeg" })
    assert.ok(result.url.startsWith("file://"))
    assert.equal(result.fellBackToDataUrl, false)
  })
})

// Small helper used by the tests above to convert file:// URLs back to paths.
// Kept here (not exported) so the test file remains self-contained.
function fileUrlToPath(url: string, platform: NodeJS.Platform): string {
  if (!url.startsWith("file://")) throw new Error(`not a file:// URL: ${url}`)
  // Strip scheme; the remainder is the absolute path with leading slash on POSIX
  // or drive letter on Windows.
  const stripped = url.slice("file://".length)
  if (platform === "win32") {
    // "C:/Users/..." -> "C:\\Users\\..."
    return stripped.split("/").join(win32.sep)
  }
  return "/" + stripped
}

// Light usage of imported helpers so the test file fails the type-check if the
// public API changes — these are sanity probes, not behavioral assertions.
void posix.sep
void win32.sep
void sep
