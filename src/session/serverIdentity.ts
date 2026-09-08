export interface ServerIdentity {
  url: string
  version: string
  protocolGeneration: ProtocolGeneration
  /** Runtime product selected by the handshake, independent of SDK package version. */
  runtime?: BackendRuntime
  /** HTTP route family verified by the handshake. */
  apiSurface?: ApiSurface
  isRemote: boolean
  /** Server-provided instance hint; not treated as process ownership proof. */
  instanceId?: string
  workspace?: string
  directory?: string
}

export type BackendRuntime = "opencode" | "opencode2" | "unknown"
export type ApiSurface = "legacy" | "opencode2" | "unknown"
export type RuntimePreference = "auto" | "opencode" | "opencode2"
export type CapabilityState = "supported" | "unsupported" | "unknown" | "temporarily-unavailable"

export interface CapabilityEvidence {
  state: CapabilityState
  /** Why this state was selected, suitable for diagnostics and the UI. */
  reason: string
  /** Evidence source, never a generated SDK method check. */
  source: "health" | "endpoint" | "version" | "default" | "unavailable"
  checkedAt?: number
}

export interface ServerCapabilities {
  supportsReview: boolean
  supportsTerminals: boolean
  supportsAsyncPrompts: boolean
  supportsSessionActions: boolean
  supportsMCP: boolean
  supportsV2Permissions: boolean
  supportsV2Questions: boolean
  supportsSessions: boolean
  supportsEventStream: boolean
  supportsDirectory: boolean
  supportsProject: boolean
  supportsPagination: boolean
  supportsSessionSearch: boolean
  supportsSessionRevert: boolean
  supportsSessionFork: boolean
  supportsSyncReplay: boolean
  supportsWorkspace: boolean
  /** Detailed state for callers that must distinguish false from unknown. */
  evidence?: Partial<Record<CapabilityName, CapabilityEvidence>>
}

export type CapabilityName = {
  [K in keyof Omit<ServerCapabilities, "evidence">]: K extends `supports${string}` ? K : never
}[keyof Omit<ServerCapabilities, "evidence">]

export type ProtocolGeneration = "v1" | "v2" | "unknown"

export interface CompatibilityProbeResult {
  identity: ServerIdentity
  capabilities: ServerCapabilities
  supported: boolean
  legacy: boolean
  reason?: string
  metadata?: Record<string, unknown>
}

const MINIMUM_V2_VERSION = "1.17.0"

function parseVersion(v: string): { major: number; minor: number; patch: number } | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/i.exec(v.trim())
  if (!match) return null
  return { major: parseInt(match[1] ?? "0", 10), minor: parseInt(match[2] ?? "0", 10), patch: parseInt(match[3] ?? "0", 10) }
}

function isV2OrLater(version: string): boolean {
  const parsed = parseVersion(version)
  if (!parsed) return false
  const minParsed = parseVersion(MINIMUM_V2_VERSION)
  if (!minParsed) return false
  // A future major is intentionally not classified here. Its routes and
  // semantics must be verified by a handshake instead of inheriting a stale
  // compatibility table.
  if (parsed.major > 1) return false
  if (parsed.major < minParsed.major) return false
  if (parsed.minor > minParsed.minor) return true
  if (parsed.minor < minParsed.minor) return false
  return parsed.patch >= minParsed.patch
}

export function classifyProtocolGeneration(version: string): ProtocolGeneration {
  const parsed = parseVersion(version)
  if (!parsed || parsed.major > 1) return "unknown"
  return isV2OrLater(version) ? "v2" : "v1"
}

const CAPABILITY_NAMES: CapabilityName[] = [
  "supportsReview", "supportsTerminals", "supportsAsyncPrompts", "supportsSessionActions", "supportsMCP",
  "supportsV2Permissions", "supportsV2Questions", "supportsSessions", "supportsEventStream", "supportsDirectory",
  "supportsProject", "supportsPagination", "supportsSessionSearch", "supportsSessionRevert", "supportsSessionFork",
  "supportsSyncReplay", "supportsWorkspace",
]

function withDefaultEvidence(capabilities: Omit<ServerCapabilities, "evidence">, reason: string): ServerCapabilities {
  const checkedAt = Date.now()
  const evidence = Object.fromEntries(CAPABILITY_NAMES.map((name) => [name, {
    state: capabilities[name] ? "supported" : "unsupported",
    reason,
    source: "default",
    checkedAt,
  }])) as Record<CapabilityName, CapabilityEvidence>
  return { ...capabilities, evidence }
}

export function buildDefaultCapabilities(version: string, runtime: BackendRuntime = "opencode"): ServerCapabilities {
  const gen = runtime === "opencode2" ? "v2" : classifyProtocolGeneration(version)
  if (gen === "v2") {
    return withDefaultEvidence({
      supportsReview: true,
      supportsTerminals: true,
      supportsAsyncPrompts: true,
      supportsSessionActions: true,
      supportsMCP: true,
      supportsV2Permissions: true,
      supportsV2Questions: true,
      supportsSessions: true,
      supportsEventStream: true,
      supportsDirectory: true,
      supportsProject: true,
      supportsPagination: true,
      supportsSessionSearch: true,
      supportsSessionRevert: true,
      supportsSessionFork: true,
      supportsSyncReplay: false,
      supportsWorkspace: false,
    }, runtime === "opencode2" ? "OpenCode 2 API defaults; individual endpoints must be verified" : `OpenCode ${version} compatibility defaults`)
  }
  return withDefaultEvidence({
    supportsReview: true,
    supportsTerminals: false,
    supportsAsyncPrompts: false,
    supportsSessionActions: false,
    supportsMCP: true,
    supportsV2Permissions: false,
    supportsV2Questions: false,
    supportsSessions: true,
    supportsEventStream: true,
    supportsDirectory: true,
    supportsProject: true,
    supportsPagination: false,
    supportsSessionSearch: false,
    supportsSessionRevert: false,
    supportsSessionFork: false,
    supportsSyncReplay: false,
    supportsWorkspace: false,
  }, gen === "unknown" ? `Unknown server version ${version}` : `OpenCode ${version} legacy compatibility defaults`)
}
