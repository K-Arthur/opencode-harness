import { log } from "../utils/outputChannel"
import type { V2OpencodeClient } from "./opencodeClientFactory"
import {
  type ApiSurface,
  type BackendRuntime,
  type CapabilityName,
  type CapabilityState,
  type CompatibilityProbeResult,
  type ServerIdentity,
  type ServerCapabilities,
  type RuntimePreference,
  buildDefaultCapabilities,
  classifyProtocolGeneration,
} from "./serverIdentity"

export interface ProbeOptions {
  baseUrl: string
  authHeader?: string
  v2Client: V2OpencodeClient | null
  directory?: string
  isRemote: boolean
  runtimePreference?: RuntimePreference
  abortSignal?: AbortSignal
  /** Injectable for contract tests; production uses the platform fetch. */
  fetchFn?: typeof fetch
}

interface HealthResponse {
  healthy: true
  version: string
  pid?: number
}

interface HealthAttempt {
  surface: ApiSurface
  response?: HealthResponse
  status?: number
  kind: "ok" | "auth" | "unsupported" | "unavailable" | "invalid"
  detail?: string
}

const PROBE_TIMEOUT_MS = 10_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "")
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

function validateHealthResponse(value: unknown): HealthResponse | null {
  if (!isRecord(value) || value.healthy !== true || typeof value.version !== "string" || value.version.trim() === "") return null
  if (value.pid !== undefined && (typeof value.pid !== "number" || !Number.isInteger(value.pid) || value.pid < 0)) return null
  return {
    healthy: true,
    version: value.version,
    ...(value.pid !== undefined ? { pid: value.pid } : {}),
  }
}

async function responsePreview(response: Response): Promise<string> {
  try {
    return (await response.text()).replace(/[\r\n]+/g, " ").slice(0, 180)
  } catch {
    return "<unreadable response body>"
  }
}

async function probeHealth(
  baseUrl: string,
  surface: ApiSurface,
  authHeader: string | undefined,
  signal: AbortSignal,
  fetchFn: typeof fetch,
): Promise<HealthAttempt> {
  const path = surface === "opencode2" ? "/api/health" : "/global/health"
  const headers: Record<string, string> = { Accept: "application/json" }
  if (authHeader) headers.Authorization = authHeader

  try {
    const response = await fetchFn(`${baseUrl}${path}`, { signal, headers })
    if (response.status === 401 || response.status === 403) {
      return { surface, status: response.status, kind: "auth", detail: `HTTP ${response.status}` }
    }
    if (response.status === 404) {
      return { surface, status: response.status, kind: "unsupported", detail: "health route not found" }
    }
    if (!response.ok) {
      return { surface, status: response.status, kind: "unavailable", detail: `HTTP ${response.status}: ${await responsePreview(response)}` }
    }
    let raw: unknown
    try {
      raw = await response.json()
    } catch {
      return { surface, status: response.status, kind: "invalid", detail: "health response was not JSON" }
    }
    const health = validateHealthResponse(raw)
    if (!health) return { surface, status: response.status, kind: "invalid", detail: "health response failed shape validation" }
    return { surface, status: response.status, response: health, kind: "ok" }
  } catch (error) {
    if (isAbortError(error)) return { surface, kind: "unavailable", detail: "probe timed out or was cancelled" }
    return { surface, kind: "unavailable", detail: error instanceof Error ? error.message : String(error) }
  }
}

function setCapabilityEvidence(
  capabilities: ServerCapabilities,
  name: CapabilityName,
  state: CapabilityState,
  reason: string,
  source: "health" | "endpoint" | "version" | "default" | "unavailable",
): void {
  capabilities.evidence ??= {}
  capabilities.evidence[name] = { state, reason, source, checkedAt: Date.now() }
}

function markUnavailable(capabilities: ServerCapabilities, reason: string): ServerCapabilities {
  const names = Object.keys(capabilities).filter((name): name is CapabilityName => name.startsWith("supports"))
  for (const name of names) setCapabilityEvidence(capabilities, name, "temporarily-unavailable", reason, "unavailable")
  return capabilities
}

async function probeEndpointCapabilities(
  client: V2OpencodeClient,
  runtime: BackendRuntime,
  directory: string | undefined,
  capabilities: ServerCapabilities,
): Promise<ServerCapabilities> {
  try {
    const response = runtime === "opencode2"
      ? await client.v2.session.list({ ...(directory ? { directory } : {}), limit: 1 })
      : await client.session.list({ ...(directory ? { directory } : {}), limit: 1 })
    if (isRecord(response) && response.error) {
      setCapabilityEvidence(capabilities, "supportsSessions", "unsupported", "session list returned an API error", "endpoint")
      return capabilities
    }
    const data = isRecord(response) ? response.data : undefined
    const isPaged = runtime === "opencode2" && isRecord(data) && Array.isArray(data.data) && isRecord(data.cursor)
    capabilities.supportsSessions = true
    setCapabilityEvidence(capabilities, "supportsSessions", "supported", "session list returned a validated response", "endpoint")
    if (runtime === "opencode2" && isPaged) {
      capabilities.supportsPagination = true
      capabilities.supportsSessionSearch = true
      setCapabilityEvidence(capabilities, "supportsPagination", "supported", "V2 session list returned a cursor envelope", "endpoint")
      setCapabilityEvidence(capabilities, "supportsSessionSearch", "supported", "V2 session list accepts the documented search query", "endpoint")
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    setCapabilityEvidence(capabilities, "supportsSessions", "temporarily-unavailable", `session list probe failed: ${detail}`, "unavailable")
  }
  return capabilities
}

function chooseAttempt(attempts: readonly HealthAttempt[], preference: RuntimePreference): HealthAttempt | undefined {
  if (preference === "opencode2") return attempts.find((attempt) => attempt.surface === "opencode2")
  if (preference === "opencode") return attempts.find((attempt) => attempt.surface === "legacy")
  return attempts.find((attempt) => attempt.kind === "ok") ?? attempts.at(-1)
}

function runtimeForSurface(surface: ApiSurface): BackendRuntime {
  return surface === "opencode2" ? "opencode2" : surface === "legacy" ? "opencode" : "unknown"
}

function identityForFailure(baseUrl: string, isRemote: boolean): ServerIdentity {
  return {
    url: baseUrl,
    version: "unknown",
    protocolGeneration: "unknown",
    runtime: "unknown",
    apiSurface: "unknown",
    isRemote,
  }
}

export async function probeServerCompatibility(options: ProbeOptions): Promise<CompatibilityProbeResult> {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const preference = options.runtimePreference ?? "auto"
  const fetchFn = options.fetchFn ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  const combined = combineAbortSignals(options.abortSignal, controller.signal)

  try {
    const surfaces: ApiSurface[] = preference === "opencode2"
      ? ["opencode2"]
      : preference === "opencode"
        ? ["legacy"]
        : ["opencode2", "legacy"]
    const attempts: HealthAttempt[] = []
    for (const surface of surfaces) {
      const attempt = await probeHealth(baseUrl, surface, options.authHeader, combined.signal, fetchFn)
      attempts.push(attempt)
      // Never probe a fallback route after an authentication or shape failure.
      // That could turn an auth/protocol problem into a misleading downgrade.
      if (attempt.kind === "ok" || attempt.kind === "auth" || attempt.kind === "invalid" || preference !== "auto") break
    }

    const selected = chooseAttempt(attempts, preference)
    if (!selected || selected.kind !== "ok" || !selected.response) {
      const detail = selected?.detail ?? "no compatible health endpoint responded"
      const reason = selected?.kind === "auth"
        ? `Authentication rejected by ${selected.surface} health endpoint (${detail})`
        : selected?.kind === "invalid"
          ? `Server health response is malformed (${detail})`
          : `Server is unavailable or does not expose the selected API (${detail})`
      const capabilities = markUnavailable(buildDefaultCapabilities("0.0.0"), reason)
      return {
        identity: identityForFailure(baseUrl, options.isRemote),
        capabilities,
        supported: false,
        legacy: false,
        reason,
        metadata: { probedAt: Date.now(), attempts: attempts.map((attempt) => ({ surface: attempt.surface, kind: attempt.kind, status: attempt.status })) },
      }
    }

    const runtime = runtimeForSurface(selected.surface)
    const version = selected.response.version
    const protocolGeneration = runtime === "opencode2" ? "v2" : classifyProtocolGeneration(version)
    const identity: ServerIdentity = {
      url: baseUrl,
      version,
      protocolGeneration,
      runtime,
      apiSurface: selected.surface,
      isRemote: options.isRemote,
      ...(options.directory ? { directory: options.directory } : {}),
      ...(selected.response.pid !== undefined ? { instanceId: String(selected.response.pid) } : {}),
    }

    const capabilities = buildDefaultCapabilities(version, runtime)
    setCapabilityEvidence(capabilities, "supportsEventStream", "supported", `${selected.surface} health endpoint is available; stream is probed by the owned subscriber`, "health")
    if (options.v2Client) await probeEndpointCapabilities(options.v2Client, runtime, options.directory, capabilities)

    return {
      identity,
      capabilities,
      supported: protocolGeneration !== "unknown" || runtime === "opencode2",
      legacy: runtime === "opencode" && protocolGeneration === "v1",
      ...(protocolGeneration === "unknown" ? { reason: `Unrecognized OpenCode version ${version}; only verified health/session contracts are enabled` } : {}),
      metadata: {
        probedAt: Date.now(),
        healthPath: selected.surface === "opencode2" ? "/api/health" : "/global/health",
        pid: selected.response.pid,
      },
    }
  } catch (error) {
    const reason = isAbortError(error) ? "Compatibility probe timed out or was cancelled" : error instanceof Error ? error.message : String(error)
    log.error(`Compatibility probe failed: ${reason}`, error)
    const capabilities = markUnavailable(buildDefaultCapabilities("0.0.0"), reason)
    return {
      identity: identityForFailure(baseUrl, options.isRemote),
      capabilities,
      supported: false,
      legacy: false,
      reason,
    }
  } finally {
    clearTimeout(timer)
    combined.dispose()
  }
}

function combineAbortSignals(...signals: Array<AbortSignal | undefined>): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController()
  const listeners: Array<() => void> = []
  for (const signal of signals) {
    if (!signal) continue
    if (signal.aborted) {
      controller.abort(signal.reason)
      break
    }
    const onAbort = () => controller.abort(signal.reason)
    signal.addEventListener("abort", onAbort, { once: true })
    listeners.push(() => signal.removeEventListener("abort", onAbort))
  }
  return { signal: controller.signal, dispose: () => listeners.forEach((remove) => remove()) }
}

export function serverIdentityCacheKey(identity: ServerIdentity, connectionGeneration?: string): string {
  const parts = [
    identity.url,
    identity.directory,
    identity.workspace,
    identity.runtime,
    identity.apiSurface,
    identity.version,
    identity.instanceId,
    connectionGeneration,
  ].filter((part): part is string => typeof part === "string" && part.length > 0)
  return `server-identity:${parts.join("|")}`
}
