import * as crypto from "crypto";
import * as path from "path";
import type { PersistedFileBaseline } from "./workflowSnapshot";

// ─── Lock Types ────────────────────────────────────────────────────────────

export type LockType = "read" | "write";

export interface FileLock {
  uri: string;
  normalizedUri: string;
  lockType: LockType;
  owner: LockOwner;
  acquiredAt: number;
  released: boolean;
}

export interface LockOwner {
  workflowId: string;
  sessionId: string;
  stageId: string;
}

export interface FileBaseline {
  uri: string;
  exists: boolean;
  documentVersion?: number;
  modifiedTimestamp?: number;
  fileSize?: number;
  contentHash?: string;
  gitBlobSha?: string;
  baselineRevision: string;
}

export interface FileConflict {
  uri: string;
  baseline: FileBaseline;
  currentState: {
    exists: boolean;
    documentVersion?: number;
    modifiedTimestamp?: number;
    fileSize?: number;
    contentHash: string;
  };
  category: "modified" | "deleted" | "recreated" | "version_changed" | "unknown";
  severity: "info" | "warning" | "blocking";
}

// ─── Lock Manager ──────────────────────────────────────────────────────────

export class WorkspaceLockManager {
  private locks = new Map<string, FileLock>();
  private ownerLocks = new Map<string, Set<string>>();
  private baselines = new Map<string, FileBaseline>();

  /**
   * Acquire a lock on a file.
   * Returns true if the lock was acquired, false if another writer holds it.
   */
  acquireLock(uri: string, owner: LockOwner, lockType: LockType): boolean {
    const normalizedUri = this.normalizeUri(uri);

    // Check for conflicting locks
    const existing = this.locks.get(normalizedUri);
    if (existing && !existing.released) {
      // Write locks conflict with everything
      if (existing.lockType === "write") return false;
      // Multiple read locks are allowed
      if (lockType === "read") {
        this.addOwnerTracking(normalizedUri, owner);
        return true;
      }
      // Write lock conflicts with any existing lock
      return false;
    }

    const lock: FileLock = {
      uri,
      normalizedUri,
      lockType,
      owner,
      acquiredAt: Date.now(),
      released: false,
    };

    this.locks.set(normalizedUri, lock);
    this.addOwnerTracking(normalizedUri, owner);
    return true;
  }

  /**
   * Acquire multiple file locks in canonical order (deadlock prevention).
   * Returns all acquired locks or releases partial acquisitions on failure.
   */
  acquireMulti(
    uris: string[],
    owner: LockOwner,
    lockType: LockType,
  ): { success: boolean; acquired: FileLock[] } {
    // Sort URIs for deterministic locking order
    const sorted = [...uris].sort((a, b) => this.normalizeUri(a).localeCompare(this.normalizeUri(b)));
    const acquired: FileLock[] = [];

    for (const uri of sorted) {
      if (this.acquireLock(uri, owner, lockType)) {
        acquired.push({ uri, normalizedUri: this.normalizeUri(uri), lockType, owner, acquiredAt: Date.now(), released: false });
      } else {
        // Release partial acquisitions
        for (const lock of acquired) {
          this.releaseLock(lock.normalizedUri, owner);
        }
        return { success: false, acquired: [] };
      }
    }

    return { success: true, acquired };
  }

  /**
   * Release a lock.
   */
  releaseLock(normalizedUri: string, owner: LockOwner): boolean {
    const lock = this.locks.get(normalizedUri);
    if (!lock || lock.released) return false;
    if (lock.owner.sessionId !== owner.sessionId && lock.lockType === "write") return false;

    lock.released = true;
    this.removeOwnerTracking(normalizedUri, owner);

    // Clean up released locks
    if (lock.lockType === "write") {
      this.locks.delete(normalizedUri);
    }

    return true;
  }

  /**
   * Release all locks owned by a session/stage.
   */
  releaseAllForOwner(owner: LockOwner): void {
    const key = this.ownerKey(owner);
    const lockUris = this.ownerLocks.get(key);
    if (!lockUris) return;

    for (const uri of lockUris) {
      const lock = this.locks.get(uri);
      if (lock && !lock.released) {
        lock.released = true;
        if (lock.lockType === "write") {
          this.locks.delete(uri);
        }
      }
    }

    this.ownerLocks.delete(key);
  }

  /**
   * Release all locks for a session.
   */
  releaseAllForSession(sessionId: string): void {
    for (const [key, uris] of this.ownerLocks) {
      if (key.startsWith(`${sessionId}:`)) {
        for (const uri of uris) {
          const lock = this.locks.get(uri);
          if (lock && !lock.released) {
            lock.released = true;
            if (lock.lockType === "write") {
              this.locks.delete(uri);
            }
          }
        }
        this.ownerLocks.delete(key);
      }
    }
  }

  /**
   * Check if a file is locked for writing.
   */
  isWriteLocked(uri: string): boolean {
    const normalizedUri = this.normalizeUri(uri);
    const lock = this.locks.get(normalizedUri);
    return !!lock && !lock.released && lock.lockType === "write";
  }

  /**
   * Check if a file is locked (any type).
   */
  isLocked(uri: string): boolean {
    const normalizedUri = this.normalizeUri(uri);
    const lock = this.locks.get(normalizedUri);
    return !!lock && !lock.released;
  }

  /**
   * Get the current lock holder for a file.
   */
  getLockOwner(uri: string): LockOwner | null {
    const normalizedUri = this.normalizeUri(uri);
    const lock = this.locks.get(normalizedUri);
    if (!lock || lock.released) return null;
    return lock.owner;
  }

  // ─── File Baselines ──────────────────────────────────────────────────

  /**
   * Capture a baseline for a file before writing.
   */
  async captureBaseline(
    uri: string,
    fileReader: (uri: string) => Promise<{ exists: boolean; content: string; size: number; mtime: number }>,
    documentVersion?: number,
    gitBlobSha?: string,
  ): Promise<FileBaseline> {
    const normalizedUri = this.normalizeUri(uri);
    let exists = false;
    let contentHash: string | undefined;
    let fileSize: number | undefined;
    let modifiedTimestamp: number | undefined;

    try {
      const fileInfo = await fileReader(uri);
      exists = fileInfo.exists;
      if (exists && fileInfo.content.length > 0) {
        contentHash = crypto.createHash("sha256").update(fileInfo.content, "utf8").digest("hex");
      }
      fileSize = fileInfo.size;
      modifiedTimestamp = fileInfo.mtime;
    } catch {
      exists = false;
    }

    const baseline: FileBaseline = {
      uri: normalizedUri,
      exists,
      documentVersion,
      modifiedTimestamp,
      fileSize,
      contentHash,
      gitBlobSha,
      baselineRevision: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };

    this.baselines.set(normalizedUri, baseline);
    return baseline;
  }

  /**
   * Revalidate a file against its baseline.
   * Returns null if unchanged, or a conflict report if changed.
   */
  async revalidateBaseline(
    uri: string,
    fileReader: (uri: string) => Promise<{ exists: boolean; content: string; size: number; mtime: number }>,
    documentVersion?: number,
  ): Promise<null | FileConflict> {
    const normalizedUri = this.normalizeUri(uri);
    const baseline = this.baselines.get(normalizedUri);
    if (!baseline) return null;

    let currentExists = false;
    let contentHash = "";
    let currentSize: number | undefined;
    let currentMtime: number | undefined;

    try {
      const fileInfo = await fileReader(uri);
      currentExists = fileInfo.exists;
      if (currentExists && fileInfo.content.length > 0) {
        contentHash = crypto.createHash("sha256").update(fileInfo.content, "utf8").digest("hex");
      }
      currentSize = fileInfo.size;
      currentMtime = fileInfo.mtime;
    } catch {
      currentExists = false;
    }

    // Compare
    if (baseline.exists === currentExists &&
        baseline.contentHash === contentHash &&
        baseline.fileSize === currentSize) {
      return null; // No change
    }

    // Categorize the conflict
    let category: FileConflict["category"];
    let severity: FileConflict["severity"];

    if (baseline.exists && !currentExists) {
      category = "deleted";
      severity = "blocking";
    } else if (!baseline.exists && currentExists) {
      category = "recreated";
      severity = "warning";
    } else if (documentVersion !== undefined && baseline.documentVersion !== undefined &&
               documentVersion !== baseline.documentVersion) {
      category = "version_changed";
      severity = documentVersion > (baseline.documentVersion + 2) ? "warning" : "info";
    } else {
      category = "modified";
      severity = "warning";
    }

    return {
      uri: normalizedUri,
      baseline,
      currentState: {
        exists: currentExists,
        documentVersion,
        modifiedTimestamp: currentMtime,
        fileSize: currentSize,
        contentHash,
      },
      category,
      severity,
    };
  }

  /**
   * Get the stored baseline for a file.
   */
  getBaseline(uri: string): FileBaseline | undefined {
    return this.baselines.get(this.normalizeUri(uri));
  }

  /**
   * Clear baselines for a session.
   */
  clearBaselines(sessionId: string): void {
    for (const [key, baseline] of this.baselines) {
      if (baseline.baselineRevision.startsWith(sessionId)) {
        this.baselines.delete(key);
      }
    }
  }

  /**
   * Get all baselines as persisted snapshot.
   */
  getPersistedBaselines(): PersistedFileBaseline[] {
    return Array.from(this.baselines.values()).map((b) => ({
      uri: b.uri,
      exists: b.exists,
      documentVersion: b.documentVersion,
      modifiedTimestamp: b.modifiedTimestamp,
      fileSize: b.fileSize,
      contentHash: b.contentHash,
      gitBlobSha: b.gitBlobSha,
      baselineRevision: b.baselineRevision,
    }));
  }

  /**
   * Restore baselines from a persisted snapshot.
   */
  restoreBaselines(baselines: PersistedFileBaseline[]): void {
    for (const b of baselines) {
      this.baselines.set(b.uri, {
        uri: b.uri,
        exists: b.exists,
        documentVersion: b.documentVersion,
        modifiedTimestamp: b.modifiedTimestamp,
        fileSize: b.fileSize,
        contentHash: b.contentHash,
        gitBlobSha: b.gitBlobSha,
        baselineRevision: b.baselineRevision,
      });
    }
  }

  // ─── URI Normalization ───────────────────────────────────────────────

  /**
   * Normalize a file URI for consistent lock keying.
   * Handles case sensitivity, trailing slashes, and symlinks where possible.
   */
  normalizeUri(uri: string): string {
    try {
      const parsed = new URL(uri);
      if (parsed.protocol === "file:") {
        let filePath = parsed.pathname;

        // Decode percent-encoded characters
        try {
          filePath = decodeURIComponent(filePath);
        } catch {
          // Keep as-is on decode failure
        }

        // Normalize path separators for the platform
        filePath = path.normalize(filePath);

        // Lowercase drive letter on Windows
        if (filePath.length >= 2 && filePath[1] === ":") {
          filePath = filePath[0]!.toLowerCase() + filePath.slice(1);
        }

        return `file://${filePath}`;
      }

      // For non-file URIs, lower the scheme and host
      return `${parsed.protocol}//${parsed.host ?? ""}${parsed.pathname}`;
    } catch {
      // If not a valid URI, treat as a path
      const normalized = path.normalize(uri);
      return `file://${normalized}`;
    }
  }

  // ─── Diagnostics ─────────────────────────────────────────────────────

  getLockCount(): number {
    let count = 0;
    for (const lock of this.locks.values()) {
      if (!lock.released) count++;
    }
    return count;
  }

  getBaselineCount(): number {
    return this.baselines.size;
  }

  releaseAll(): void {
    for (const lock of this.locks.values()) {
      lock.released = true;
    }
    this.locks.clear();
    this.ownerLocks.clear();
    this.baselines.clear();
  }

  // ─── Private ─────────────────────────────────────────────────────────

  private ownerKey(owner: LockOwner): string {
    return `${owner.sessionId}:${owner.stageId}`;
  }

  private addOwnerTracking(normalizedUri: string, owner: LockOwner): void {
    const key = this.ownerKey(owner);
    let uris = this.ownerLocks.get(key);
    if (!uris) {
      uris = new Set();
      this.ownerLocks.set(key, uris);
    }
    uris.add(normalizedUri);
  }

  private removeOwnerTracking(normalizedUri: string, owner: LockOwner): void {
    const key = this.ownerKey(owner);
    const uris = this.ownerLocks.get(key);
    if (uris) {
      uris.delete(normalizedUri);
      if (uris.size === 0) this.ownerLocks.delete(key);
    }
  }
}

// ─── Global Singleton ──────────────────────────────────────────────────────

let globalLockManager: WorkspaceLockManager | null = null;

export function getGlobalLockManager(): WorkspaceLockManager {
  if (!globalLockManager) {
    globalLockManager = new WorkspaceLockManager();
  }
  return globalLockManager;
}

export function setGlobalLockManager(manager: WorkspaceLockManager): void {
  globalLockManager = manager;
}
