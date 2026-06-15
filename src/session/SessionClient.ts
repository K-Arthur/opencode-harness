import {
  type OpencodeClient,
  type Session,
  type Message,
  type Part,
  type TextPartInput,
  type FilePartInput,
  type AgentPartInput,
  type SubtaskPartInput,
} from "@opencode-ai/sdk"
import { randomUUID } from "crypto"
import { log } from "../utils/outputChannel"
import type { McpServerManager } from "../mcp/McpServerManager"
import type { V2OpencodeClient } from "./opencodeClientFactory"
import {
  mapV2Session,
  mapV2SessionArray,
  mapV2MessageWithParts,
  mapV2MessageWithPartsArray,
} from "./v2ResponseMappers"
import type { ModelRef, PromptOptions as BasePromptOptions } from "./sessionTypes"
import { isLocalPlaceholderSessionId } from "./sessionUtils"
import { logStreamTrace } from "./streamTrace"
import { extractLiveToolOutput, type LiveToolOutputSnapshot } from "./liveToolOutput"

const MAX_RESPONSE_SIZE = 50 * 1024 * 1024

interface PromptOptions extends BasePromptOptions {
  signal?: AbortSignal
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function unavailableToolSnapshot(callId: string, token = 0): LiveToolOutputSnapshot {
  return {
    available: false,
    callId,
    stdout: "",
    stderr: "",
    token,
    stdoutLength: 0,
    stderrLength: 0,
    stdoutLineCount: 0,
    stderrLineCount: 0,
  }
}

export class SessionClient {
  private _currentModel: ModelRef | null = null
  private readonly MAX_RETRIES = 3
  private readonly BASE_BACKOFF_MS = 1000

  constructor(
    private readonly getClient: () => OpencodeClient | null,
    private readonly mcpServerManager?: McpServerManager,
    private readonly disposed: () => boolean = () => false,
    // v2 SDK client — the question reply/reject API exists only on v2.
    private readonly getV2Client: () => V2OpencodeClient | null = () => null,
  ) {}

  get model(): ModelRef | null {
    return this._currentModel
  }

  setModel(providerID: string, modelID: string): void {
    this._currentModel = { providerID, modelID }
    log.info(`Model set to ${providerID}/${modelID}`)
  }

  clearModel(): void {
    this._currentModel = null
    log.info("Model cleared – will use server default")
  }

  private guard(): OpencodeClient {
    if (this.disposed()) throw new Error("SessionManager has been disposed")
    const client = this.getClient()
    if (!client) throw new Error("Server not running")
    return client
  }

  private guardV2(): V2OpencodeClient {
    if (this.disposed()) throw new Error("SessionManager has been disposed")
    const client = this.getV2Client()
    if (!client) throw new Error("Server not running")
    return client
  }

  private throwOnV2Error(resp: { error?: unknown }, label: string): void {
    if (resp.error) throw new Error(`${label}: ${JSON.stringify(resp.error)}`)
  }

  private assertResponseSize(data: unknown, label: string): void {
    try {
      const size = JSON.stringify(data).length
      if (size > MAX_RESPONSE_SIZE) {
        throw new Error(`${label} response exceeds maximum size (${(size / 1024 / 1024).toFixed(1)}MB > ${(MAX_RESPONSE_SIZE / 1024 / 1024).toFixed(0)}MB)`)
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("exceeds maximum size")) throw err
    }
  }

  private filterToolsForModel(
    tools: Record<string, boolean> | undefined,
    modelRef: ModelRef | null | undefined,
  ): Record<string, boolean> | undefined {
    if (!tools || !this.mcpServerManager || !modelRef) return tools
    return this.mcpServerManager.getFilteredTools(modelRef.providerID, modelRef.modelID, tools)
  }

  async createSession(title?: string): Promise<Session> {
    const client = this.guardV2()
    const resp = await client.session.create({ title })
    this.throwOnV2Error(resp, "Failed to create session")
    const session = mapV2Session(resp.data as Record<string, unknown>)
    log.info(`Created session: ${session.id}`)
    return session
  }

  async deleteSession(id: string): Promise<boolean> {
    // v2 migration (Phase 2): flat `{ sessionID }` replaces v1 `{ path: { id } }`.
    const client = this.guardV2()
    await client.session.delete({ sessionID: id })
    log.info(`Deleted session: ${id}`)
    return true
  }

  async getSession(id: string): Promise<Session> {
    const client = this.guardV2()
    const resp = await client.session.get({ sessionID: id })
    this.throwOnV2Error(resp, "Failed to get session")
    return mapV2Session(resp.data as Record<string, unknown>)
  }

  async updateSessionTitle(id: string, title: string): Promise<Session> {
    const client = this.guardV2()
    const resp = await client.session.update({ sessionID: id, title })
    this.throwOnV2Error(resp, "Failed to update session title")
    return mapV2Session(resp.data as Record<string, unknown>)
  }

  async getSessionMessages(id: string): Promise<Array<{ info: Message; parts: Part[] }>> {
    const client = this.guardV2()
    const resp = await client.session.messages({ sessionID: id })
    this.throwOnV2Error(resp, "Failed to get session messages")
    const data = mapV2MessageWithPartsArray((resp.data as Array<Record<string, unknown>>) ?? [])
    this.assertResponseSize(data, "getSessionMessages")
    return data
  }

  private stableToolPartId(part: Record<string, unknown>, messageId?: string): string | undefined {
    return stringValue(part.id) || stringValue(part.callID) || (messageId && stringValue(part.tool) ? `${messageId}:${stringValue(part.tool)}` : undefined)
  }

  async getToolPartialOutput(sessionId: string, callId: string, sinceToken = 0): Promise<LiveToolOutputSnapshot> {
    if (!callId) return unavailableToolSnapshot(callId, sinceToken)
    const client = this.guardV2()
    const resp = await client.session.messages({ sessionID: sessionId })
    this.throwOnV2Error(resp, "Failed to get tool partial output")
    const data = mapV2MessageWithPartsArray((resp.data as Array<Record<string, unknown>>) ?? [])
    this.assertResponseSize(data, "getToolPartialOutput")

    for (let i = data.length - 1; i >= 0; i--) {
      const message = data[i]
      if (!message) continue
      const messageId = stringValue((message.info as Record<string, unknown> | undefined)?.id)
      for (const rawPart of message.parts ?? []) {
        const part = asRecord(rawPart)
        if (!part || part.type !== "tool") continue
        if (part.id === callId || part.callID === callId || this.stableToolPartId(part, messageId) === callId) {
          return extractLiveToolOutput({
            callId,
            state: part.state,
            part,
            fallbackToken: sinceToken,
          })
        }
      }
    }

    return unavailableToolSnapshot(callId, sinceToken)
  }

  async listSessions(): Promise<Session[]> {
    const client = this.guardV2()
    const resp = await client.session.list()
    this.throwOnV2Error(resp, "Failed to list sessions")
    const data = mapV2SessionArray((resp.data as Array<Record<string, unknown>>) ?? [])
    this.assertResponseSize(data, "listSessions")
    return data
  }

  async sendPrompt(
    sessionId: string,
    parts: (TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput)[],
    options?: PromptOptions,
  ): Promise<{ info: Message; parts: Part[] }> {
    const client = this.guard()
    const modelRef = options?.model ?? this._currentModel ?? undefined
    const agent = options?.agent
    const variant = options?.variant
    const messageID = options?.messageID
    const filteredTools = this.filterToolsForModel(options?.tools, modelRef)
    const idempotencyKey = `${sessionId}-${randomUUID()}`
    log.info(`Sending prompt to session ${sessionId} (idempotency: ${idempotencyKey.slice(0, 16)}..., model=${modelRef ? `${modelRef.providerID}/${modelRef.modelID}` : "default"}, agent=${agent ?? "default"}, variant=${variant ?? "none"}, tools=${JSON.stringify(options?.tools ?? {})}, filteredTools=${JSON.stringify(filteredTools ?? {})})`)

    const resp = await client.session.prompt({
      path: { id: sessionId },
      headers: { "Idempotency-Key": idempotencyKey },
      body: {
        parts,
        ...(messageID ? { messageID } : {}),
        ...(modelRef ? { model: modelRef } : {}),
        ...(agent ? { agent } : {}),
        ...(variant ? { variant } : {}),
        ...(filteredTools ? { tools: filteredTools } : {}),
      },
    })

    if (resp.error) throw new Error(`Prompt failed: ${JSON.stringify(resp.error)}`)
    const data = resp.data as { info: Message; parts: Part[] } | undefined
    if (!data) throw new Error("Prompt returned no data")
    return { info: data.info, parts: data.parts }
  }

  async sendPromptAsync(
    sessionId: string,
    parts: (TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput)[],
    options?: PromptOptions,
    eventStreamState?: string,
    lastRawEventType?: string,
  ): Promise<void> {
    const client = this.guard()
    const modelRef = options?.model ?? this._currentModel ?? undefined
    const agent = options?.agent
    const variant = options?.variant
    const messageID = options?.messageID
    const clientRequestId = options?.clientRequestId
    const filteredTools = this.filterToolsForModel(options?.tools, modelRef)
    const idempotencyKey = `${sessionId}-${randomUUID()}`
    const signal = options?.signal
    log.info(`Sending async prompt to session ${sessionId} (idempotency: ${idempotencyKey.slice(0, 16)}..., model=${modelRef ? `${modelRef.providerID}/${modelRef.modelID}` : "default"}, agent=${agent ?? "default"}, variant=${variant ?? "none"}, tools=${JSON.stringify(options?.tools ?? {})}, filteredTools=${JSON.stringify(filteredTools ?? {})}, eventStream=${eventStreamState ?? "unknown"}, lastRaw=${lastRawEventType ?? "none"})`)
    logStreamTrace("prompt_async.send", {
      cliSessionId: sessionId,
      clientRequestId,
      userMessageId: messageID,
      agent,
      model: modelRef ? `${modelRef.providerID}/${modelRef.modelID}` : undefined,
      eventStreamState,
      lastRawEventType,
      promptText: parts
        .filter((part): part is TextPartInput => part.type === "text" && typeof (part as TextPartInput).text === "string")
        .map(part => part.text)
        .join("\n"),
    })

    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      if (signal?.aborted) return

      try {
        const resp = await (signal
          ? Promise.race([
              client.session.promptAsync({
                path: { id: sessionId },
                body: {
                  parts,
                  ...(messageID ? { messageID } : {}),
                  ...(modelRef ? { model: modelRef } : {}),
                  ...(agent ? { agent } : {}),
                  ...(variant ? { variant } : {}),
                  ...(filteredTools ? { tools: filteredTools } : {}),
                },
                headers: { "Idempotency-Key": idempotencyKey },
              }) as { error?: unknown; data?: unknown },
              new Promise<never>((_, reject) => {
                if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"))
                const onAbort = () => reject(new DOMException("Aborted", "AbortError"))
                signal.addEventListener("abort", onAbort, { once: true })
              }),
            ])
          : client.session.promptAsync({
              path: { id: sessionId },
              body: {
                parts,
                ...(messageID ? { messageID } : {}),
                ...(modelRef ? { model: modelRef } : {}),
                ...(agent ? { agent } : {}),
                ...(variant ? { variant } : {}),
                ...(filteredTools ? { tools: filteredTools } : {}),
              },
              headers: { "Idempotency-Key": idempotencyKey },
            }))

        const responseData = resp as { error?: unknown; data?: unknown }
        if (responseData.error) {
          const errorMsg = JSON.stringify(responseData.error)
          if (this.isRetryableError(responseData.error) && attempt < this.MAX_RETRIES) {
            lastError = new Error(`Async prompt failed: ${errorMsg}`)
            log.warn(`Prompt attempt ${attempt + 1} failed, retrying...`, lastError)
            await this.exponentialDelay(attempt)
            continue
          }
          throw new Error(`Async prompt failed: ${errorMsg}`)
        }

        return
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return
        lastError = err instanceof Error ? err : new Error(String(err))
        if (this.isRetryableError(err) && attempt < this.MAX_RETRIES) {
          log.warn(`Prompt attempt ${attempt + 1} failed, retrying...`, lastError)
          await this.exponentialDelay(attempt)
        } else {
          throw lastError
        }
      }
    }

    throw lastError || new Error("Prompt failed after retries")
  }

  async sendCommand(sessionId: string, command: string, args?: string): Promise<{ info: Message; parts: Part[] }> {
    const client = this.guard()
    const resp = await client.session.command({
      path: { id: sessionId },
      body: { command, arguments: args ?? "" },
    })
    if (resp.error) throw new Error(`Command failed: ${JSON.stringify(resp.error)}`)
    return resp.data as { info: Message; parts: Part[] }
  }

  async compactSession(sessionId: string, model?: ModelRef): Promise<boolean> {
    const client = this.guard()
    const modelRef = model ?? this._currentModel ?? undefined
    const resp = await client.session.summarize({
      path: { id: sessionId },
      body: modelRef ? { providerID: modelRef.providerID, modelID: modelRef.modelID } : undefined,
    })
    if (resp.error) throw new Error(`Compaction failed: ${JSON.stringify(resp.error)}`)
    log.info(`Session compacted: ${sessionId}`)
    return resp.data as boolean
  }

  async listCommands(): Promise<Array<{ name: string; description?: string; template: string; agent?: string; source?: string }>> {
    const client = this.guard()
    const resp = await client.command.list()
    if (resp.error) throw new Error(`Failed to list commands: ${JSON.stringify(resp.error)}`)
    return (resp.data as Array<{ name: string; description?: string; template: string; agent?: string; source?: string }>) ?? []
  }

  async abortSession(sessionId: string): Promise<boolean> {
    // v2 migration (Phase 2): flat `{ sessionID }` replaces v1 `{ path: { id } }`.
    const client = this.guardV2()
    await client.session.abort({ sessionID: sessionId })
    log.info(`Aborted session: ${sessionId}`)
    return true
  }

  async getMessages(sessionId: string, limit?: number): Promise<{ info: unknown; parts: Part[] }[]> {
    const client = this.guardV2()
    const resp = await client.session.messages({
      sessionID: sessionId,
      ...(limit !== undefined ? { limit } : {}),
    })
    this.throwOnV2Error(resp, "Failed to get messages")
    const data = mapV2MessageWithPartsArray((resp.data as Array<Record<string, unknown>>) ?? [])
    this.assertResponseSize(data, "getMessages")
    return data
  }

  async getSessionDiff(sessionId: string, messageId?: string): Promise<unknown> {
    const client = this.guard()
    const resp = await client.session.diff({
      path: { id: sessionId },
      query: { messageID: messageId },
    })
    if (resp.error) throw new Error(`Failed to get diff: ${JSON.stringify(resp.error)}`)
    return resp.data
  }

  /**
   * Read a workspace file from the server, including its diff vs the original.
   * opencode applies edits server-side; this is how the extension obtains the
   * authoritative per-file diff (structured `patch.hunks` and/or unified
   * `diff` string) for the changed-files view.
   */
  async readFile(path: string, directory?: string): Promise<unknown> {
    const client = this.guard()
    const resp = await client.file.read({ query: { path, directory } })
    if (resp.error) throw new Error(`Failed to read file '${path}': ${JSON.stringify(resp.error)}`)
    return resp.data
  }

  async revertMessage(sessionId: string, messageId: string): Promise<boolean> {
    // v2 migration (Phase 2): flat `{ sessionID, messageID }` replaces v1
    // `{ path: { id }, body: { messageID } }`.
    const client = this.guardV2()
    await client.session.revert({ sessionID: sessionId, messageID: messageId })
    log.info(`Reverted message ${messageId} in session ${sessionId}`)
    return true
  }

  async respondToPermission(sessionId: string, permissionId: string, response: string): Promise<void> {
    const client = this.guard()
    if (!sessionId) throw new Error("Permission response missing session ID")
    if (!permissionId) throw new Error("Permission response missing permission ID")
    const normalized = this.normalizePermissionResponse(response)
    const modernPermission = (client as unknown as {
      permission?: {
        reply?: (parameters: { requestID: string; reply?: "once" | "always" | "reject"; message?: string }) => Promise<{ error?: unknown }>
      }
    }).permission
    if (modernPermission?.reply) {
      const modernResp = await modernPermission.reply({ requestID: permissionId, reply: normalized })
      if (!modernResp.error) {
        log.info(`Permission ${permissionId} responded with v2 API: ${normalized}`)
        return
      }
      log.warn(`Permission v2 reply failed for ${permissionId}; falling back to session permission API`, modernResp.error)
    }
    const resp = await client.postSessionIdPermissionsPermissionId({
      path: { id: sessionId, permissionID: permissionId },
      body: { response: normalized },
    })
    if (resp.error) throw new Error(`Permission response failed: ${JSON.stringify(resp.error)}`)
    log.info(`Permission ${permissionId} responded with: ${normalized}`)
  }

  async replyToQuestion(requestID: string, answers: string[][]): Promise<void> {
    // The question reply/reject API exists only on the v2 SDK client; the v1
    // client has no `question` namespace (which is why this previously always
    // threw "API is unavailable" and the question panel never dismissed).
    const client = this.guardV2()
    const resp = await client.question.reply({ requestID, answers })
    if (resp.error) throw new Error(`Question reply failed: ${JSON.stringify(resp.error)}`)
    log.info(`Question ${requestID} replied with ${answers.length} answer group(s)`)
  }

  async rejectQuestion(requestID: string): Promise<void> {
    const client = this.guardV2()
    const resp = await client.question.reject({ requestID })
    if (resp.error) throw new Error(`Question reject failed: ${JSON.stringify(resp.error)}`)
    log.info(`Question ${requestID} rejected`)
  }

  async getSessionTodos(id: string): Promise<Array<{ id: string; content: string; status: string; priority: string }>> {
    const client = this.guard()
    const resp = await client.session.todo({ path: { id } })
    this.assertResponseSize(resp.data, "getSessionTodos")
    return (resp.data ?? []) as Array<{ id: string; content: string; status: string; priority: string }>
  }

  async getChildSessions(parentId: string): Promise<Session[]> {
    const client = this.guardV2()
    const resp = await client.session.children({ sessionID: parentId })
    this.throwOnV2Error(resp, "Failed to get child sessions")
    const data = mapV2SessionArray((resp.data as Array<Record<string, unknown>>) ?? [])
    this.assertResponseSize(data, "getChildSessions")
    return data
  }

  async getSessionDetails(id: string): Promise<Session> {
    return this.getSession(id)
  }

  async listAgents(directory?: string): Promise<Array<{ name: string; description?: string; mode: string; builtIn: boolean }>> {
    const client = this.guard()
    const resp = await client.app.agents(directory ? { query: { directory } } : undefined)
    this.assertResponseSize(resp.data, "listAgents")
    return (resp.data ?? []) as Array<{ name: string; description?: string; mode: string; builtIn: boolean }>
  }

  async sessionExists(id: string): Promise<boolean> {
    const client = this.getClient()
    if (!client) return false
    try {
      await this.getSession(id)
      return true
    } catch {
      return false
    }
  }

  async ensureSession(cliSessionId: string | undefined, title?: string): Promise<string> {
    this.guard()
    if (cliSessionId && !isLocalPlaceholderSessionId(cliSessionId)) {
      const exists = await this.sessionExists(cliSessionId)
      if (exists) {
        log.info(`Re-attached to existing server session: ${cliSessionId}`)
        return cliSessionId
      }
      log.info(`Server session ${cliSessionId} no longer exists – creating new one`)
    } else if (cliSessionId) {
      log.info(`Local placeholder session ${cliSessionId} needs a server session`)
    }
    const session = await this.createSession(title)
    return session.id
  }

  private normalizePermissionResponse(response: string): "once" | "always" | "reject" {
    if (response === "always") return "always"
    if (response === "reject" || response === "deny") return "reject"
    return "once"
  }

  private isRetryableError(error: unknown): boolean {
    if (!error) return false
    const errorStr = typeof error === "string" ? error : JSON.stringify(error)
    const retryablePatterns = [
      /timeout/i, /network/i, /econnrefused/i, /econnreset/i, /etimedout/i,
      /enotfound/i, /enetunreach/i, /fetch failed/i, /socket hang up/i, /request failed/i,
    ]
    return retryablePatterns.some(pattern => pattern.test(errorStr))
  }

  private async exponentialDelay(attempt: number): Promise<void> {
    const baseDelay = this.BASE_BACKOFF_MS * Math.pow(2, attempt)
    const jitter = Math.random() * 0.3 * baseDelay
    const delay = Math.min(baseDelay + jitter, 30000)
    log.info(`Retrying in ${Math.round(delay)}ms...`)
    await new Promise(resolve => setTimeout(resolve, delay))
  }
}
