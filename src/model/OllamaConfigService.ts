import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

/**
 * Canonical Ollama host. Every endpoint (tags, show, OpenAI-compatible
 * `/v1`) is derived from this so the address can never drift between the
 * URL we probe and the `baseURL` we write into opencode config.
 */
export const DEFAULT_OLLAMA_HOST = "http://127.0.0.1:11434"
export const DEFAULT_OLLAMA_BASE_URL = `${DEFAULT_OLLAMA_HOST}/v1`
export const DEFAULT_OLLAMA_TAGS_URL = `${DEFAULT_OLLAMA_HOST}/api/tags`
export const DEFAULT_OLLAMA_SHOW_URL = `${DEFAULT_OLLAMA_HOST}/api/show`

/**
 * Fallback context window used when Ollama's `/api/show` does not report a
 * `*.context_length`. Without a declared limit the webview token gauge is
 * blank and context management can't reason about the model, so we always
 * write *something* sane.
 */
export const DEFAULT_OLLAMA_CONTEXT = 8192

export interface OllamaModelDetail {
  id: string
  contextLength?: number
  supportsTools?: boolean
}

export interface OllamaEndpoints {
  host: string
  tagsUrl: string
  showUrl: string
  baseURL: string
}

export interface OpenCodeProviderModelConfig {
  id?: string
  name?: string
  reasoning?: boolean
  temperature?: boolean
  tool_call?: boolean
  limit?: {
    context?: number
    output?: number
    [key: string]: unknown
  }
  options?: Record<string, unknown>
  [key: string]: unknown
}

export interface OpenCodeProviderConfig {
  api?: string
  name?: string
  env?: string[]
  id?: string
  npm?: string
  models?: Record<string, OpenCodeProviderModelConfig>
  whitelist?: string[]
  blacklist?: string[]
  options?: {
    apiKey?: string
    baseURL?: string
    timeout?: number | boolean
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface OpenCodeConfig {
  provider?: Record<string, OpenCodeProviderConfig>
  model?: string
  small_model?: string
  mcp?: Record<string, unknown>
  plugin?: unknown
  [key: string]: unknown
}

export interface WriteOpenCodeConfigResult {
  backupPath?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isProviderConfig(value: unknown): value is OpenCodeProviderConfig {
  return isRecord(value)
}

function isModelConfig(value: unknown): value is OpenCodeProviderModelConfig {
  return isRecord(value)
}

function safeModelId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return undefined
  return trimmed
}

/**
 * Normalize a user-supplied Ollama address into a bare `scheme://host:port`
 * origin. Tolerates a missing scheme, trailing slashes, and accidentally
 * pasted `/v1` or `/api/...` suffixes so the caller can paste whatever they
 * copied from Ollama's docs.
 */
export function normalizeOllamaHost(input: string | undefined, fallback = DEFAULT_OLLAMA_HOST): string {
  const trimmed = (input ?? "").trim()
  if (!trimmed) return fallback
  let host = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  host = host.replace(/\/+$/, "")
  host = host.replace(/\/(v1|api(?:\/.*)?)$/i, "")
  host = host.replace(/\/+$/, "")
  return host || fallback
}

/** Derive every Ollama endpoint we touch from a single host origin. */
export function resolveOllamaEndpoints(host: string | undefined = DEFAULT_OLLAMA_HOST): OllamaEndpoints {
  const base = normalizeOllamaHost(host)
  return {
    host: base,
    tagsUrl: `${base}/api/tags`,
    showUrl: `${base}/api/show`,
    baseURL: `${base}/v1`,
  }
}

/**
 * Pull the context length and tool-calling capability out of an Ollama
 * `/api/show` response. `model_info` keys are architecture-prefixed
 * (e.g. `qwen2.context_length`), so we match on the suffix.
 */
export function extractOllamaModelInfo(payload: unknown): { contextLength?: number; supportsTools?: boolean } {
  const result: { contextLength?: number; supportsTools?: boolean } = {}
  if (!isRecord(payload)) return result

  const modelInfo = payload.model_info
  if (isRecord(modelInfo)) {
    for (const [key, value] of Object.entries(modelInfo)) {
      if (key.endsWith(".context_length") && typeof value === "number" && value > 0) {
        result.contextLength = value
        break
      }
    }
  }

  if (Array.isArray(payload.capabilities)) {
    result.supportsTools = payload.capabilities.some(
      (cap) => typeof cap === "string" && cap.toLowerCase() === "tools",
    )
  }

  return result
}

export function extractOllamaModelIds(payload: unknown): string[] {
  if (!isRecord(payload) || !Array.isArray(payload.models)) return []
  const seen = new Set<string>()
  const modelIds: string[] = []

  for (const item of payload.models) {
    if (!isRecord(item)) continue
    const id = safeModelId(item.name) ?? safeModelId(item.model)
    if (!id || seen.has(id)) continue
    seen.add(id)
    modelIds.push(id)
  }

  return modelIds
}

function toModelDetail(entry: string | OllamaModelDetail): OllamaModelDetail {
  return typeof entry === "string" ? { id: entry } : entry
}

export function buildOllamaProviderConfig(
  models: ReadonlyArray<string | OllamaModelDetail>,
  baseURL = DEFAULT_OLLAMA_BASE_URL,
): OpenCodeProviderConfig {
  const out: Record<string, OpenCodeProviderModelConfig> = {}
  for (const entry of models) {
    const detail = toModelDetail(entry)
    const modelId = safeModelId(detail.id)
    if (!modelId) continue
    const context =
      typeof detail.contextLength === "number" && detail.contextLength > 0
        ? detail.contextLength
        : DEFAULT_OLLAMA_CONTEXT
    out[modelId] = {
      id: modelId,
      name: modelId,
      // Honest capability: only advertise tool calling when /api/show
      // reported it. Unknown (string-only input) defaults to true because
      // the coding agent is unusable without tools.
      tool_call: detail.supportsTools ?? true,
      temperature: true,
      limit: { context },
    }
  }

  return {
    npm: "@ai-sdk/openai-compatible",
    name: "Ollama (local)",
    options: { baseURL },
    models: out,
  }
}

export function mergeOllamaConfig(
  existing: OpenCodeConfig,
  models: ReadonlyArray<string | OllamaModelDetail>,
  baseURL = DEFAULT_OLLAMA_BASE_URL,
): OpenCodeConfig {
  const provider = isRecord(existing.provider) ? existing.provider as Record<string, OpenCodeProviderConfig> : {}
  const existingOllama = isProviderConfig(provider.ollama) ? provider.ollama : {}
  const existingOptions = isRecord(existingOllama.options) ? existingOllama.options : {}
  const existingModels = isRecord(existingOllama.models)
    ? existingOllama.models as Record<string, OpenCodeProviderModelConfig>
    : {}
  const generatedOllama = buildOllamaProviderConfig(models, baseURL)
  const mergedModels: Record<string, OpenCodeProviderModelConfig> = { ...existingModels }

  for (const [id, generatedModel] of Object.entries(generatedOllama.models ?? {})) {
    const existingModel = existingModels[id]
    mergedModels[id] = isModelConfig(existingModel)
      ? { ...generatedModel, ...existingModel }
      : generatedModel
  }

  return {
    ...existing,
    provider: {
      ...provider,
      ollama: {
        ...existingOllama,
        npm: "@ai-sdk/openai-compatible",
        name: "Ollama (local)",
        options: {
          ...existingOptions,
          baseURL,
        },
        models: mergedModels,
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Generic (non-Ollama) OpenAI-compatible provider support. Writes a provider
// block into opencode.json — the single source of truth — exactly like the
// Ollama path, so a "connected" provider actually reaches the server.
// ---------------------------------------------------------------------------

export interface CustomProviderInput {
  /** opencode provider id, e.g. `together` (lowercase, slug). */
  id: string
  /** Human-facing name shown in the model picker. */
  name: string
  /** OpenAI-compatible base URL, e.g. `https://api.together.xyz/v1`. */
  baseURL: string
  /** Optional API key. Omitted for keyless/local endpoints. */
  apiKey?: string
  modelIds: string[]
}

/**
 * Derive a safe opencode provider id from a display name. opencode keys
 * providers by id, so we restrict to `[a-z0-9_.-]` and trim separators.
 */
export function normalizeProviderId(input: string): string {
  return (input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 64)
}

export function buildCustomProviderConfig(input: CustomProviderInput): OpenCodeProviderConfig {
  const models: Record<string, OpenCodeProviderModelConfig> = {}
  for (const id of input.modelIds) {
    const modelId = safeModelId(id)
    if (!modelId) continue
    models[modelId] = {
      id: modelId,
      name: modelId,
      tool_call: true,
      temperature: true,
    }
  }

  const options: Record<string, unknown> = { baseURL: input.baseURL }
  const apiKey = input.apiKey?.trim()
  if (apiKey) options.apiKey = apiKey

  return {
    npm: "@ai-sdk/openai-compatible",
    name: input.name,
    options,
    models,
  }
}

export function mergeCustomProviderConfig(
  existing: OpenCodeConfig,
  input: CustomProviderInput,
): OpenCodeConfig {
  const provider = isRecord(existing.provider) ? existing.provider as Record<string, OpenCodeProviderConfig> : {}
  const existingRaw = provider[input.id]
  const existingProvider: OpenCodeProviderConfig = isProviderConfig(existingRaw) ? existingRaw : {}
  const existingOptions = isRecord(existingProvider.options) ? existingProvider.options : {}
  const existingModels = isRecord(existingProvider.models)
    ? existingProvider.models as Record<string, OpenCodeProviderModelConfig>
    : {}
  const generated = buildCustomProviderConfig(input)
  const mergedModels: Record<string, OpenCodeProviderModelConfig> = { ...existingModels }

  for (const [id, generatedModel] of Object.entries(generated.models ?? {})) {
    const existingModel = existingModels[id]
    mergedModels[id] = isModelConfig(existingModel)
      ? { ...generatedModel, ...existingModel }
      : generatedModel
  }

  const mergedOptions: Record<string, unknown> = { ...existingOptions, baseURL: input.baseURL }
  const apiKey = input.apiKey?.trim()
  if (apiKey) mergedOptions.apiKey = apiKey

  return {
    ...existing,
    provider: {
      ...provider,
      [input.id]: {
        ...existingProvider,
        npm: "@ai-sdk/openai-compatible",
        name: input.name,
        options: mergedOptions,
        models: mergedModels,
      },
    },
  }
}

const SECRET_KEY_PATTERN = /(api[-_]?key|secret|token|password|authorization|bearer)/i
const REDACTED_PLACEHOLDER = "••••••••"

/**
 * Deep-clone `value` with any string under a secret-looking key masked.
 * Used to render config previews without leaking other providers' API keys
 * into an editor tab; the real (unredacted) config is what gets written.
 */
export function redactConfigSecrets<T>(value: T): T {
  return redactValue(value) as T
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue)
  if (isRecord(value)) {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      out[key] = typeof child === "string" && child.length > 0 && SECRET_KEY_PATTERN.test(key)
        ? REDACTED_PLACEHOLDER
        : redactValue(child)
    }
    return out
  }
  return value
}

export function stripJsonComments(content: string): string {
  let result = ""
  let inString = false
  let escaped = false

  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    const next = content[i + 1]
    if (char === undefined) break

    if (inString) {
      result += char
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === "\"") {
        inString = false
      }
      continue
    }

    if (char === "\"") {
      inString = true
      result += char
      continue
    }

    if (char === "/" && next === "/") {
      i += 2
      while (i < content.length && content[i] !== "\n" && content[i] !== "\r") i++
      i--
      continue
    }

    if (char === "/" && next === "*") {
      i += 2
      while (i < content.length && !(content[i] === "*" && content[i + 1] === "/")) {
        if (content[i] === "\n" || content[i] === "\r") result += content[i]
        i++
      }
      i++
      continue
    }

    result += char
  }

  return result
}

export function removeJsonTrailingCommas(content: string): string {
  let result = ""
  let inString = false
  let escaped = false

  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    if (char === undefined) break

    if (inString) {
      result += char
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === "\"") {
        inString = false
      }
      continue
    }

    if (char === "\"") {
      inString = true
      result += char
      continue
    }

    if (char === ",") {
      let j = i + 1
      while (j < content.length && /\s/.test(content[j] ?? "")) j++
      if (content[j] === "}" || content[j] === "]") continue
    }

    result += char
  }

  return result
}

export function parseOpenCodeConfig(content: string): OpenCodeConfig {
  const normalized = removeJsonTrailingCommas(stripJsonComments(content)).trim()
  if (!normalized) return {}
  const parsed = JSON.parse(normalized) as unknown
  if (!isRecord(parsed)) throw new Error("OpenCode config must be a JSON object")
  return parsed as OpenCodeConfig
}

export function serializeOpenCodeConfig(config: OpenCodeConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`
}

export async function readOpenCodeConfigFile(filePath: string): Promise<OpenCodeConfig> {
  try {
    const content = await fs.readFile(filePath, "utf8")
    return parseOpenCodeConfig(content)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === "ENOENT") return {}
    throw err
  }
}

export async function writeOpenCodeConfigWithBackup(
  filePath: string,
  config: OpenCodeConfig,
): Promise<WriteOpenCodeConfigResult> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  let backupPath: string | undefined
  try {
    await fs.stat(filePath)
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    backupPath = `${filePath}.bak-${timestamp}`
    await fs.copyFile(filePath, backupPath)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
  }

  await fs.writeFile(filePath, serializeOpenCodeConfig(config), "utf8")
  return backupPath ? { backupPath } : {}
}

export function expandHomePath(input: string, homeDir = os.homedir()): string {
  if (input === "~") return homeDir
  if (input.startsWith("~/") || input.startsWith("~\\")) return path.join(homeDir, input.slice(2))
  return input
}

export function getWritableOpenCodeConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  homeDir = os.homedir(),
): string {
  const explicit = env.OPENCODE_CONFIG?.trim()
  if (explicit) return path.resolve(expandHomePath(explicit, homeDir))
  const configHome = env.XDG_CONFIG_HOME?.trim()
    ? path.resolve(expandHomePath(env.XDG_CONFIG_HOME.trim(), homeDir))
    : path.join(homeDir, ".config")
  return path.join(configHome, "opencode", "opencode.json")
}

/**
 * Detect the "Ollama isn't running" class of failure (connection refused,
 * DNS miss) that `fetch` surfaces as a generic `TypeError: fetch failed`
 * with the real reason hidden on `.cause`.
 */
function isOllamaUnreachable(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const cause = (err as { cause?: { code?: string } }).cause
  const code = cause?.code
  if (code && ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET"].includes(code)) return true
  return /fetch failed|ECONNREFUSED|ENOTFOUND/i.test(err.message)
}

export async function fetchOllamaModelIds(
  fetchImpl: typeof fetch = fetch,
  tagsUrl = DEFAULT_OLLAMA_TAGS_URL,
  timeoutMs = 2_000,
): Promise<string[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(tagsUrl, { signal: controller.signal })
    if (!response.ok) throw new Error(`Ollama tags request failed with HTTP ${response.status}`)
    const payload = await response.json()
    return extractOllamaModelIds(payload)
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Ollama did not respond within ${timeoutMs}ms at ${tagsUrl}. Is it running? Start it with \`ollama serve\`.`)
    }
    if (isOllamaUnreachable(err)) {
      throw new Error(`Could not reach Ollama at ${tagsUrl}. Start it with \`ollama serve\`, or set the correct host.`)
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Best-effort probe of `/api/show` for a single model. Never throws — a
 * failed probe just yields empty info and the caller falls back to the
 * default context window.
 */
export async function fetchOllamaModelInfo(
  modelId: string,
  fetchImpl: typeof fetch = fetch,
  showUrl = DEFAULT_OLLAMA_SHOW_URL,
  timeoutMs = 2_000,
): Promise<{ contextLength?: number; supportsTools?: boolean }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(showUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelId, name: modelId }),
      signal: controller.signal,
    })
    if (!response.ok) return {}
    return extractOllamaModelInfo(await response.json())
  } catch {
    return {}
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Enrich a list of model IDs with context length and tool capability by
 * probing `/api/show` for each in parallel. Probes are independent and
 * best-effort, so one slow/failed model never blocks the rest.
 */
export async function fetchOllamaModelDetails(
  modelIds: string[],
  fetchImpl: typeof fetch = fetch,
  showUrl = DEFAULT_OLLAMA_SHOW_URL,
  timeoutMs = 2_000,
): Promise<OllamaModelDetail[]> {
  return Promise.all(
    modelIds.map(async (id) => ({ id, ...(await fetchOllamaModelInfo(id, fetchImpl, showUrl, timeoutMs)) })),
  )
}
