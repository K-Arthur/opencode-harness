export class ValidationError extends Error {
  readonly path: string
  readonly expectedType: string
  readonly actualValue: unknown

  constructor(path: string, expectedType: string, actualValue: unknown) {
    const actualDesc = actualValue === null ? "null" : actualValue === undefined ? "undefined" : typeof actualValue
    super(`Response validation failed at ${path}: expected ${expectedType}, got ${actualDesc}`)
    this.name = "ValidationError"
    this.path = path
    this.expectedType = expectedType
    this.actualValue = actualValue
  }
}

export function expectString(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === "string") return value
  if (typeof value === "number") return String(value)
  return undefined
}

export function expectNumber(value: unknown, path: string): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === "number") return value
  if (typeof value === "string") {
    const n = Number(value)
    if (!isNaN(n)) return n
  }
  return undefined
}

export function expectBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === "boolean") return value
  return undefined
}

export function expectObject(value: unknown, path: string): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  return undefined
}

export function expectArray(value: unknown, path: string): unknown[] {
  if (Array.isArray(value)) return value
  if (value === undefined || value === null) return []
  return []
}

export function expectEnum<T extends string, F = T | undefined>(value: unknown, allowed: readonly T[], path: string, fallback: F): T | F {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T
  return fallback
}

export interface ValidatedSession {
  id: string
  title: string
  directory: string
  projectID: string
  parentID?: string
  summary?: {
    additions: number
    deletions: number
    files: number
    diffs?: ValidatedSnapshotFileDiff[]
  }
  share?: { url: string }
  version: string
  time: { created: number; updated: number; compacting?: number; archived?: number }
  revert?: {
    messageID: string
    partID?: string
    snapshot?: string
    diff?: string
  }
  agent?: string
  model?: { id: string; providerID: string; variant?: string }
}

export interface ValidatedSnapshotFileDiff {
  file?: string
  patch?: string
  additions: number
  deletions: number
  status?: "added" | "deleted" | "modified"
}

export interface ValidatedAgent {
  name: string
  description?: string
  mode: string
  builtIn: boolean
}

export function validateSession(raw: unknown): ValidatedSession {
  const obj = expectObject(raw, "session")
  const timeObj = expectObject(obj?.time, "session.time")
  const summaryRaw = expectObject(obj?.summary, "session.summary")
  const revertRaw = expectObject(obj?.revert, "session.revert")
  const shareRaw = expectObject(obj?.share, "session.share")

  return {
    id: expectString(obj?.id, "session.id") ?? "",
    title: expectString(obj?.title, "session.title") ?? "",
    directory: expectString(obj?.directory, "session.directory") ?? "",
    projectID: expectString(obj?.projectID, "session.projectID") ?? "",
    parentID: expectString(obj?.parentID, "session.parentID"),
    summary: summaryRaw ? {
      additions: expectNumber(summaryRaw.additions, "session.summary.additions") ?? 0,
      deletions: expectNumber(summaryRaw.deletions, "session.summary.deletions") ?? 0,
      files: expectNumber(summaryRaw.files, "session.summary.files") ?? 0,
      diffs: expectArray(summaryRaw.diffs, "session.summary.diffs")
        .map(d => validateSnapshotFileDiff(d)),
    } : undefined,
    share: shareRaw ? { url: expectString(shareRaw.url, "session.share.url") ?? "" } : undefined,
    version: expectString(obj?.version, "session.version") ?? "",
    time: {
      created: expectNumber(timeObj?.created, "session.time.created") ?? 0,
      updated: expectNumber(timeObj?.updated, "session.time.updated") ?? 0,
      compacting: expectNumber(timeObj?.compacting, "session.time.compacting"),
      archived: expectNumber(timeObj?.archived, "session.time.archived"),
    },
    revert: revertRaw ? {
      messageID: expectString(revertRaw.messageID, "session.revert.messageID") ?? "",
      partID: expectString(revertRaw.partID, "session.revert.partID"),
      snapshot: expectString(revertRaw.snapshot, "session.revert.snapshot"),
      diff: expectString(revertRaw.diff, "session.revert.diff"),
    } : undefined,
    agent: expectString(obj?.agent, "session.agent"),
    model: obj?.model ? {
      id: expectString((obj.model as Record<string, unknown>).id, "session.model.id") ?? "",
      providerID: expectString((obj.model as Record<string, unknown>).providerID, "session.model.providerID") ?? "",
      variant: expectString((obj.model as Record<string, unknown>).variant, "session.model.variant"),
    } : undefined,
  }
}

export function validateSnapshotFileDiff(raw: unknown): ValidatedSnapshotFileDiff {
  const obj = expectObject(raw, "snapshotFileDiff")
  return {
    file: expectString(obj?.file, "snapshotFileDiff.file"),
    patch: expectString(obj?.patch, "snapshotFileDiff.patch"),
    additions: expectNumber(obj?.additions, "snapshotFileDiff.additions") ?? 0,
    deletions: expectNumber(obj?.deletions, "snapshotFileDiff.deletions") ?? 0,
    status: expectEnum<"added" | "deleted" | "modified">(obj?.status, ["added", "deleted", "modified"] as const, "snapshotFileDiff.status", undefined),
  }
}

export function validateAgent(raw: unknown): ValidatedAgent {
  const obj = expectObject(raw, "agent")
  return {
    name: expectString(obj?.name, "agent.name") ?? "",
    description: expectString(obj?.description, "agent.description"),
    mode: expectString(obj?.mode, "agent.mode") ?? "",
    builtIn: expectBoolean(obj?.native, "agent.native") ?? false,
  }
}

export function validateHealthResponse(raw: unknown): { healthy: boolean; version?: string } | null {
  const obj = expectObject(raw, "health")
  if (!obj) return null
  return {
    healthy: expectBoolean(obj.healthy, "health.healthy") ?? false,
    version: expectString(obj.version, "health.version"),
  }
}
