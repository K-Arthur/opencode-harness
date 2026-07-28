// ─── Multimodal Attachment Dispatcher ────────────────────────────────────
//
// Handles materialization of image attachments from various origins (local
// files, clipboard, drag-drop, blobs) into stable host-accessible URIs,
// validates them, and passes them to vision-capable stage dispatchers.

import * as crypto from "crypto";
import * as path from "path";

// ─── Attachment Types ──────────────────────────────────────────────────────

export type AttachmentOrigin = "local_file" | "clipboard" | "drag_drop" | "webview_blob" | "screenshot" | "generated";

export interface AttachmentDescriptor {
  id: string;
  origin: AttachmentOrigin;
  originalName?: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  /** Host-accessible URI (file:// or vscode-remote://) */
  uri: string;
  /** Whether the URI points to a temporary copy */
  isTempCopy: boolean;
  /** SHA-256 of the raw image bytes */
  contentHash: string;
}

export interface AttachmentValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  descriptor?: AttachmentDescriptor;
}

export interface VisionModelCapability {
  modelId: string;
  supported: boolean;
  maxImageSize?: number;
  supportedFormats: string[];
  maxImagesPerRequest?: number;
}

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
]);

const ALLOWED_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp",
]);

const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_IMAGE_DIMENSION = 8192; // pixels
const TEMP_FILE_RETENTION_MS = 30 * 60 * 1000; // 30 minutes

// ─── Attachment Materializer ───────────────────────────────────────────────

export class AttachmentMaterializer {
  private tempDir: string;
  private tempFiles = new Map<string, { path: string; expiresAt: number }>();
  private descriptors = new Map<string, AttachmentDescriptor>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(tempDir?: string) {
    this.tempDir = tempDir ?? "/tmp/opencode-attachments";
    this.startCleanupTimer();
  }

  /**
   * Materialize an attachment from various origins into a stable URI.
   */
  async materialize(
    input: AttachmentMaterializationInput,
  ): Promise<AttachmentValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate MIME type
    if (input.mimeType && !ALLOWED_MIME_TYPES.has(input.mimeType)) {
      // Try to infer from extension
      if (input.originalName) {
        const ext = path.extname(input.originalName).toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(ext)) {
          errors.push(`Unsupported format: ${input.mimeType} (${ext})`);
          return { valid: false, errors, warnings };
        }
      } else {
        errors.push(`Unsupported MIME type: ${input.mimeType}`);
        return { valid: false, errors, warnings };
      }
    }

    // Validate size
    if (input.data && input.data.length > MAX_IMAGE_SIZE) {
      errors.push(`Image too large: ${(input.data.length / 1024 / 1024).toFixed(1)}MB (max: ${MAX_IMAGE_SIZE / 1024 / 1024}MB)`);
      return { valid: false, errors, warnings };
    }

    let uri: string;
    let isTempCopy = false;
    let contentHash: string;

    try {
      if (input.uri && input.origin !== "webview_blob") {
        // Already has a URI — validate it
        uri = input.uri;
        contentHash = input.contentHash ?? (await this.computeHashFromUri(uri));
      } else if (input.data) {
        // Materialize to temp file
        const { filePath, hash } = await this.writeTempFile(input);
        uri = `file://${filePath}`;
        contentHash = hash;
        isTempCopy = true;
      } else {
        errors.push("No data or URI provided for attachment");
        return { valid: false, errors, warnings };
      }
    } catch (err) {
      errors.push(`Failed to materialize attachment: ${err instanceof Error ? err.message : String(err)}`);
      return { valid: false, errors, warnings };
    }

    // Validate URI scheme
    if (!uri.startsWith("file://") && !uri.startsWith("vscode-remote://") && !uri.startsWith("vscode-file://")) {
      warnings.push(`Unsupported URI scheme for image: ${uri.slice(0, 30)}`);
    }

    const id = `att-${crypto.randomBytes(8).toString("hex")}`;
    const descriptor: AttachmentDescriptor = {
      id,
      origin: input.origin,
      originalName: input.originalName,
      mimeType: input.mimeType ?? "image/png",
      sizeBytes: input.data?.length ?? 0,
      uri,
      isTempCopy,
      contentHash,
    };

    this.descriptors.set(id, descriptor);

    return { valid: true, errors, warnings, descriptor };
  }

  /**
   * Get a materialized attachment descriptor by ID.
   */
  getDescriptor(id: string): AttachmentDescriptor | undefined {
    return this.descriptors.get(id);
  }

  /**
   * Get all descriptors for a set of IDs.
   */
  getDescriptors(ids: string[]): AttachmentDescriptor[] {
    return ids.map((id) => this.descriptors.get(id)).filter(Boolean) as AttachmentDescriptor[];
  }

  /**
   * Remove an attachment and its temp file.
   */
  async remove(id: string): Promise<boolean> {
    const descriptor = this.descriptors.get(id);
    if (!descriptor) return false;

    if (descriptor.isTempCopy) {
      const filePath = descriptor.uri.replace(/^file:\/\//, "");
      try {
        const { unlink } = await import("fs/promises");
        await unlink(filePath);
      } catch {
        // Best-effort cleanup
      }
    }

    this.descriptors.delete(id);
    return true;
  }

  /**
   * Check if any vision-capable model is available.
   */
  hasVisionCapability(visionModels: VisionModelCapability[]): boolean {
    return visionModels.some((m) => m.supported);
  }

  /**
   * Get supported formats from available vision models.
   */
  getSupportedFormats(visionModels: VisionModelCapability[]): Set<string> {
    const formats = new Set<string>();
    for (const model of visionModels) {
      for (const fmt of model.supportedFormats) {
        formats.add(fmt);
      }
    }
    return formats;
  }

  /**
   * Clean up expired temp files.
   */
  cleanup(): void {
    const now = Date.now();
    for (const [id, entry] of this.tempFiles) {
      if (entry.expiresAt < now) {
        try {
          const { unlinkSync } = require("fs");
          unlinkSync(entry.path);
        } catch {
          // Best-effort
        }
        this.tempFiles.delete(id);
      }
    }
  }

  /**
   * Clean up all temp files.
   */
  async cleanupAll(): Promise<void> {
    for (const [, entry] of this.tempFiles) {
      try {
        const { unlink } = await import("fs/promises");
        await unlink(entry.path);
      } catch {
        // Best-effort
      }
    }
    this.tempFiles.clear();
    this.descriptors.clear();
  }

  /**
   * Get count of materialized attachments.
   */
  getAttachmentCount(): number {
    return this.descriptors.size;
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────

  private async writeTempFile(input: AttachmentMaterializationInput): Promise<{ filePath: string; hash: string }> {
    const { mkdir, writeFile } = await import("fs/promises");
    const ext = input.originalName ? path.extname(input.originalName) : ".png";

    // Ensure temp dir exists
    try {
      await mkdir(this.tempDir, { recursive: true });
    } catch {
      // Directory already exists
    }

    const hash = crypto.createHash("sha256").update(input.data!).digest("hex");
    const fileName = `oc-att-${hash.slice(0, 16)}${ext}`;
    const filePath = path.join(this.tempDir, fileName);

    // Write the file
    await writeFile(filePath, input.data!);

    // Track for cleanup
    this.tempFiles.set(fileName, {
      path: filePath,
      expiresAt: Date.now() + TEMP_FILE_RETENTION_MS,
    });

    return { filePath, hash };
  }

  private async computeHashFromUri(uri: string): Promise<string> {
    const filePath = uri.replace(/^file:\/\//, "");
    const { readFile } = await import("fs/promises");
    const data = await readFile(filePath);
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    if (typeof this.cleanupTimer === "object" && typeof (this.cleanupTimer as { unref?: () => void }).unref === "function") {
      (this.cleanupTimer as { unref: () => void }).unref();
    }
  }
}

// ─── Input Type ────────────────────────────────────────────────────────────

export interface AttachmentMaterializationInput {
  origin: AttachmentOrigin;
  originalName?: string;
  mimeType?: string;
  uri?: string;
  data?: Buffer | Uint8Array;
  contentHash?: string;
  width?: number;
  height?: number;
}

// ─── Shared Singleton ──────────────────────────────────────────────────────

let globalAttachmentMaterializer: AttachmentMaterializer | null = null;

export function getGlobalAttachmentMaterializer(tempDir?: string): AttachmentMaterializer {
  if (!globalAttachmentMaterializer) {
    globalAttachmentMaterializer = new AttachmentMaterializer(tempDir);
  }
  return globalAttachmentMaterializer;
}

export function setGlobalAttachmentMaterializer(materializer: AttachmentMaterializer): void {
  globalAttachmentMaterializer = materializer;
}
