import { log } from "../utils/outputChannel"
import type { V2OpencodeClient } from "./opencodeClientFactory"
import {
  type ServerIdentity,
  type ServerCapabilities,
  type CompatibilityProbeResult,
  buildDefaultCapabilities,
} from "./serverIdentity"

export interface ProbeOptions {
  baseUrl: string
  authHeader?: string
  v2Client: V2OpencodeClient | null
  directory?: string
  isRemote: boolean
  abortSignal?: AbortSignal
}

interface HealthResponse {
  healthy?: boolean
  version?: string
}

const PROBE_TIMEOUT_MS = 10_000

async function fetchHealth(baseUrl: string, authHeader?: string, signal?: AbortSignal): Promise<HealthResponse | null> {
  const headers: Record<string, string> = {}
  if (authHeader) headers["Authorization"] = authHeader
  try {
    const resp = await fetch(`${baseUrl}/global/health`, { signal, headers })
    if (!resp.ok) {
      log.warn(`Health probe returned HTTP ${resp.status}`)
      return null
    }
    const data = (await resp.json()) as HealthResponse
    return data
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      log.warn("Health probe aborted")
      return null
    }
    log.warn(`Health probe failed: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

function probeV2Capabilities(v2Client: V2OpencodeClient, directory?: string): ServerCapabilities {
  const caps = buildDefaultCapabilities("1.18.0")
  try {
    if (v2Client.experimental) {
      const v2Caps = v2Client.experimental.capabilities.get({ directory })
      if (v2Caps && typeof v2Caps === "object" && "data" in v2Caps) {
        const capData = (v2Caps as { data?: Record<string, boolean> }).data
        if (capData) {
          if (capData.workspace !== undefined) caps.supportsWorkspace = !!capData.workspace
          if (capData.syncReplay !== undefined) caps.supportsSyncReplay = !!capData.syncReplay
        }
      }
    }
  } catch {
    log.debug("Capabilities endpoint not available, using defaults")
  }
  return caps
}

function probeEndpoints(v2Client: V2OpencodeClient, directory?: string): Partial<ServerCapabilities> {
  const result: Partial<ServerCapabilities> = {}
  try {
    const sessions = v2Client.session.list({ directory, limit: 1 })
    if (sessions && "error" in (sessions as object)) {
      result.supportsSessions = false
    }
  } catch {
    result.supportsSessions = false
  }
  return result
}

export async function probeServerCompatibility(options: ProbeOptions): Promise<CompatibilityProbeResult> {
  const { baseUrl, authHeader, v2Client, directory, isRemote } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  const signal = options.abortSignal
    ? combineAbortSignals(options.abortSignal, controller.signal)
    : controller.signal

  try {
    const health = await fetchHealth(baseUrl, authHeader, signal)
    if (!health) {
      return {
        identity: { url: baseUrl, version: "unknown", protocolGeneration: "v1", isRemote },
        capabilities: buildDefaultCapabilities("0.0.0"),
        supported: false,
        legacy: false,
        reason: "Server unreachable or unhealthy",
      }
    }

    const version = health.version ?? "unknown"
    const gen = version === "unknown" ? "v1" : version.startsWith("1.") && parseFloat(version.split(".")[1] ?? "0") >= 17 ? "v2" : "v1"
    const isLegacy = gen === "v1" || (version !== "unknown" && !version.startsWith("1."))

    const identity: ServerIdentity = {
      url: baseUrl,
      version,
      protocolGeneration: gen as "v1" | "v2",
      isRemote,
      directory,
    }

    let capabilities: ServerCapabilities
    if (v2Client && gen === "v2") {
      capabilities = probeV2Capabilities(v2Client, directory)
      const endpointCaps = probeEndpoints(v2Client, directory)
      capabilities = { ...capabilities, ...endpointCaps }
    } else {
      capabilities = buildDefaultCapabilities(version)
    }

    return {
      identity,
      capabilities,
      supported: true,
      legacy: isLegacy,
      metadata: { probedAt: Date.now() },
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    log.error(`Compatibility probe failed: ${reason}`, err)
    return {
      identity: { url: baseUrl, version: "unknown", protocolGeneration: "v1", isRemote },
      capabilities: buildDefaultCapabilities("0.0.0"),
      supported: false,
      legacy: false,
      reason,
    }
  } finally {
    clearTimeout(timer)
  }
}

function combineAbortSignals(...signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController()
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      return controller.signal
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true })
  }
  return controller.signal
}

export function serverIdentityCacheKey(identity: ServerIdentity): string {
  const parts = [identity.url, identity.directory].filter(Boolean)
  return `server-identity:${parts.join("|")}`
}
