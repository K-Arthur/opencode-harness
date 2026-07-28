export interface ServerIdentity {
  url: string
  version: string
  protocolGeneration: "v1" | "v2"
  isRemote: boolean
  workspace?: string
  directory?: string
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
}

export type ProtocolGeneration = "v1" | "v2"

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
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(v)
  if (!match) return null
  return { major: parseInt(match[1] ?? "0", 10), minor: parseInt(match[2] ?? "0", 10), patch: parseInt(match[3] ?? "0", 10) }
}

function isV2OrLater(version: string): boolean {
  const parsed = parseVersion(version)
  if (!parsed) return false
  const minParsed = parseVersion(MINIMUM_V2_VERSION)
  if (!minParsed) return false
  if (parsed.major > minParsed.major) return true
  if (parsed.major < minParsed.major) return false
  if (parsed.minor > minParsed.minor) return true
  if (parsed.minor < minParsed.minor) return false
  return parsed.patch >= minParsed.patch
}

function classifyGeneration(version: string): ProtocolGeneration {
  return isV2OrLater(version) ? "v2" : "v1"
}

export function buildDefaultCapabilities(version: string): ServerCapabilities {
  const gen = classifyGeneration(version)
  if (gen === "v2") {
    return {
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
    }
  }
  return {
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
  }
}
