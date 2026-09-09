import {
  type Session,
  type Message,
  type Part,
  type TextPartInput,
  type FilePartInput,
  type AgentPartInput,
  type SubtaskPartInput,
} from "@opencode-ai/sdk/v2"
import { randomUUID } from "crypto"
import { log } from "../utils/outputChannel"
import type { McpServerManager } from "../mcp/McpServerManager"
import type { V2OpencodeClient } from "./opencodeClientFactory"
import {
  mapV2Session,
  mapV2SessionArray,
  mapV2MessageWithParts,
  mapV2MessageWithPartsArray,
  mapV2Agent,
} from "./v2ResponseMappers"
import {
  mapOpenCode2MessagePage,
  mapOpenCode2PromptAdmission,
  mapOpenCode2Session,
} from "./opencode2ResponseMappers"
import type { ModelRef, PromptOptions as BasePromptOptions } from "./sessionTypes"
import type { ApiSurface } from "./serverIdentity"
import { isLocalPlaceholderSessionId } from "./sessionUtils"
import { v2ErrorDetail } from "./v2ErrorDetail"
import { logStreamTrace } from "./streamTrace"
import { extractLiveToolOutput, type LiveToolOutputSnapshot } from "./liveToolOutput"
import { resolveSessionQuestionApi } from "./resolveSessionQuestionApi"

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
    private readonly mcpServerManager?: McpServerManager,
    private readonly disposed: () => boolean = () => false,
    private readonly getV2Client: () => V2OpencodeClient | null = () => null,
    private readonly getApiSurface: () => ApiSurface = () => "legacy",
    private readonly getDirectory: () => string | undefined = () => undefined,
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

  private guardV2(): V2OpencodeClient {
    if (this.disposed()) throw new Error("SessionManager has been disposed")
    const client = this.getV2Client()
    if (!client) throw new Error("Server not running")
    return client
  }

  private usesOpenCode2(): boolean {
    return this.getApiSurface() === "opencode2"
  }

  private unsupportedOpenCode2(operation: string): never {
    throw new Error(`${operation} is not available on the verified OpenCode 2 API surface`)
  }

  private openCode2Prompt(parts: (TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput)[]): {
    text: string
    files?: Array<{ uri: string; name?: string }>
    agents?: Array<{ name: string }>
  } {
    const text: string[] = []
    const files: Array<{ uri: string; name?: string }> = []
    const agents: Array<{ name: string }> = []
    for (const part of parts) {
      if (part.type === "text") text.push(part.text)
      else if (part.type === "file") files.push({ uri: part.url, ...(part.filename ? { name: part.filename } : {}) })
      else if (part.type === "agent") agents.push({ name: part.name })
      else if (part.type === "subtask") text.push(part.prompt)
    }
    return {
      text: text.join("\n"),
      ...(files.length > 0 ? { files } : {}),
      ...(agents.length > 0 ? { agents } : {}),
    }
  }

  private async configureOpenCode2PromptSession(
    client: V2OpencodeClient,
    sessionId: string,
    modelRef: ModelRef | undefined,
    variant: string | undefined,
    agent: string | undefined,
  ): Promise<void> {
    if (modelRef) {
      const resp = await client.v2.session.switchModel({
        sessionID: sessionId,
        model: { providerID: modelRef.providerID, id: modelRef.modelID, ...(variant ? { variant } : {}) },
      })
      this.throwOnV2Error(resp, "Failed to select OpenCode 2 model")
    }
    if (agent) {
      const resp = await client.v2.session.switchAgent({ sessionID: sessionId, agent })
      this.throwOnV2Error(resp, "Failed to select OpenCode 2 agent")
    }
  }

  private throwOnV2Error(resp: { error?: unknown; response?: { status?: number } }, label: string): void {
    if (!resp.error) return
    const detail = v2ErrorDetail(resp.error, resp.response?.status)
    throw new Error(`${label}: ${detail}`)
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
    if (this.usesOpenCode2()) {
      const resp = await client.v2.session.create({
        ...(title ? { title } : {}),
        ...(this.getDirectory() ? { location: { directory: this.getDirectory()! } } : {}),
      } as Parameters<typeof client.v2.session.create>[0])
      this.throwOnV2Error(resp, "Failed to create session")
      const session = mapOpenCode2Session(resp.data)
      log.info(`Created OpenCode 2 session: ${session.id}`)
      return session
    }
    const resp = await client.session.create({ title })
    this.throwOnV2Error(resp, "Failed to create session")
    const session = mapV2Session(resp.data as Record<string, unknown>)
    log.info(`Created session: ${session.id}`)
    return session
  }

  async deleteSession(id: string): Promise<boolean> {
    if (this.usesOpenCode2()) {
      const client = this.guardV2()
      // The installed SDK typings lag the verified OpenCode 2 route set and
      // omit session.delete. Keep the compatibility boundary explicit while
      // still allowing a newer SDK (or a contract-test client) to provide it.
      const sessionApi = client.v2.session as unknown as {
        delete?: (params: { sessionID: string }) => Promise<unknown>
      }
      if (!sessionApi.delete) this.unsupportedOpenCode2("Deleting a session")
      const resp = await sessionApi.delete({ sessionID: id }) as { error?: unknown; response?: { status?: number } }
      this.throwOnV2Error(resp, "Failed to delete session")
      log.info(`Deleted OpenCode 2 session: ${id}`)
      return true
    }
    // v2 migration (Phase 2): flat `{ sessionID }` replaces v1 `{ path: { id } }`.
    const client = this.guardV2()
    await client.session.delete({ sessionID: id })
    log.info(`Deleted session: ${id}`)
    return true
  }

  async getSession(id: string): Promise<Session> {
    const client = this.guardV2()
    if (this.usesOpenCode2()) {
      const resp = await client.v2.session.get({ sessionID: id })
      this.throwOnV2Error(resp, "Failed to get session")
      return mapOpenCode2Session(resp.data)
    }
    const resp = await client.session.get({ sessionID: id })
    this.throwOnV2Error(resp, "Failed to get session")
    return mapV2Session(resp.data as Record<string, unknown>)
  }

  async updateSessionTitle(id: string, title: string): Promise<Session> {
    if (this.usesOpenCode2()) this.unsupportedOpenCode2("Updating a session title")
    const client = this.guardV2()
    const resp = await client.session.update({ sessionID: id, title })
    this.throwOnV2Error(resp, "Failed to update session title")
    return mapV2Session(resp.data as Record<string, unknown>)
  }

  async archiveSession(id: string, archived: boolean): Promise<Session> {
    if (this.usesOpenCode2()) this.unsupportedOpenCode2("Archiving a session")
    const client = this.guardV2()
    const resp = await client.session.update({
      sessionID: id,
      time: archived ? { archived: Date.now() } : { archived: 0 },
    })
    this.throwOnV2Error(resp, "Failed to archive session")
    return mapV2Session(resp.data as Record<string, unknown>)
  }

  async getSessionMessages(id: string): Promise<Array<{ info: Message; parts: Part[] }>> {
    const client = this.guardV2()
    if (this.usesOpenCode2()) {
      const resp = await client.v2.session.messages({ sessionID: id })
      this.throwOnV2Error(resp, "Failed to get session messages")
      const data = mapOpenCode2MessagePage(resp.data, id)
      this.assertResponseSize(data, "getSessionMessages")
      return data
    }
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
    const resp = this.usesOpenCode2()
      ? await client.v2.session.messages({ sessionID: sessionId })
      : await client.session.messages({ sessionID: sessionId })
    this.throwOnV2Error(resp, "Failed to get tool partial output")
    const data = this.usesOpenCode2()
      ? mapOpenCode2MessagePage(resp.data, sessionId)
      : mapV2MessageWithPartsArray((resp.data as Array<Record<string, unknown>>) ?? [])
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
    if (this.usesOpenCode2()) {
      const resp = await client.v2.session.list({ ...(this.getDirectory() ? { directory: this.getDirectory()! } : {}) })
      this.throwOnV2Error(resp, "Failed to list sessions")
      const raw = resp.data as { data?: unknown } | undefined
      const data = Array.isArray(raw?.data) ? raw.data.map(mapOpenCode2Session) : []
      this.assertResponseSize(data, "listSessions")
      return data
    }
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
    const client = this.guardV2()
    const modelRef = options?.model ?? this._currentModel ?? undefined
    const agent = options?.agent
    const variant = options?.variant
    const messageID = options?.messageID
    const filteredTools = this.filterToolsForModel(options?.tools, modelRef)
    const idempotencyKey = `${sessionId}-${randomUUID()}`
    log.info(`Sending prompt to session ${sessionId} (idempotency: ${idempotencyKey.slice(0, 16)}..., model=${modelRef ? `${modelRef.providerID}/${modelRef.modelID}` : "default"}, agent=${agent ?? "default"}, variant=${variant ?? "none"}, tools=${JSON.stringify(options?.tools ?? {})}, filteredTools=${JSON.stringify(filteredTools ?? {})})`)

    if (this.usesOpenCode2()) {
      if (filteredTools && Object.keys(filteredTools).length > 0) this.unsupportedOpenCode2("Per-prompt tool selection")
      await this.configureOpenCode2PromptSession(client, sessionId, modelRef, variant, agent)
      const resp = await client.v2.session.prompt({
        sessionID: sessionId,
        ...(messageID ? { id: messageID } : {}),
        prompt: this.openCode2Prompt(parts),
        ...(options?.delivery ? { delivery: options.delivery } : {}),
        ...(options?.resume !== undefined ? { resume: options.resume } : {}),
      })
      this.throwOnV2Error(resp, "Prompt failed")
      if (!resp.data) throw new Error("Prompt returned no admission data")
      return mapOpenCode2PromptAdmission(resp.data, sessionId)
    }

    const resp = await client.session.prompt(
      {
        sessionID: sessionId,
        parts,
        ...(messageID ? { messageID } : {}),
        ...(modelRef ? { model: { providerID: modelRef.providerID, modelID: modelRef.modelID } } : {}),
        ...(agent ? { agent } : {}),
        ...(variant ? { variant } : {}),
        ...(filteredTools ? { tools: filteredTools } : {}),
      },
      { headers: { "Idempotency-Key": idempotencyKey } as Record<string, string> },
    )

    this.throwOnV2Error(resp, "Prompt failed")
    const data = resp.data
    if (!data) throw new Error("Prompt returned no data")
    return mapV2MessageWithParts(data as Record<string, unknown>)
  }

  async sendPromptAsync(
    sessionId: string,
    parts: (TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput)[],
    options?: PromptOptions,
    eventStreamState?: string,
    lastRawEventType?: string,
  ): Promise<void> {
    const client = this.guardV2()
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

    if (this.usesOpenCode2()) {
      if (signal?.aborted) return
      try {
        if (filteredTools && Object.keys(filteredTools).length > 0) this.unsupportedOpenCode2("Per-prompt tool selection")
        await this.configureOpenCode2PromptSession(client, sessionId, modelRef, variant, agent)
        const resp = await (signal
          ? Promise.race([
              client.v2.session.prompt({
                sessionID: sessionId,
                ...(messageID ? { id: messageID } : {}),
                prompt: this.openCode2Prompt(parts),
                ...(options?.delivery ? { delivery: options.delivery } : {}),
                ...(options?.resume !== undefined ? { resume: options.resume } : {}),
              }),
              new Promise<never>((_, reject) => {
                if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"))
                const onAbort = () => reject(new DOMException("Aborted", "AbortError"))
                signal.addEventListener("abort", onAbort, { once: true })
              }),
            ])
          : client.v2.session.prompt({
              sessionID: sessionId,
              ...(messageID ? { id: messageID } : {}),
              prompt: this.openCode2Prompt(parts),
              ...(options?.delivery ? { delivery: options.delivery } : {}),
              ...(options?.resume !== undefined ? { resume: options.resume } : {}),
            }))
        this.throwOnV2Error(resp, "Async prompt failed")
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return
        throw error instanceof Error ? error : new Error(String(error))
      }
    }

    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      if (signal?.aborted) return

      try {
        const v2Params = {
          sessionID: sessionId,
          parts,
          ...(messageID ? { messageID } : {}),
          ...(modelRef ? { model: { providerID: modelRef.providerID, modelID: modelRef.modelID } } : {}),
          ...(agent ? { agent } : {}),
          ...(variant ? { variant } : {}),
          ...(filteredTools ? { tools: filteredTools } : {}),
        }
        const v2Options = { headers: { "Idempotency-Key": idempotencyKey } as Record<string, string> }

        const resp = await (signal
          ? Promise.race([
              client.session.promptAsync(v2Params, v2Options) as { error?: unknown; data?: unknown },
              new Promise<never>((_, reject) => {
                if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"))
                const onAbort = () => reject(new DOMException("Aborted", "AbortError"))
                signal.addEventListener("abort", onAbort, { once: true })
              }),
            ])
          : client.session.promptAsync(v2Params, v2Options))

        const responseData = resp as { error?: unknown; data?: unknown; response?: { status?: number } }
        if (responseData.error) {
          const errorMsg = v2ErrorDetail(responseData.error, responseData.response?.status)
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
    if (this.usesOpenCode2()) this.unsupportedOpenCode2("Running a slash command")
    const client = this.guardV2()
    const resp = await client.session.command({
      sessionID: sessionId,
      command,
      arguments: args ?? "",
    })
    this.throwOnV2Error(resp, "Command failed")
    return mapV2MessageWithParts(resp.data as Record<string, unknown>)
  }

  async compactSession(sessionId: string, model?: ModelRef): Promise<boolean> {
    const client = this.guardV2()
    if (this.usesOpenCode2()) {
      const resp = await client.v2.session.compact({ sessionID: sessionId })
      this.throwOnV2Error(resp, "Compaction failed")
      log.info(`OpenCode 2 session compacted: ${sessionId}`)
      return true
    }
    const modelRef = model ?? this._currentModel ?? undefined
    const resp = await client.session.summarize({
      sessionID: sessionId,
      ...(modelRef ? { providerID: modelRef.providerID, modelID: modelRef.modelID } : {}),
    })
    this.throwOnV2Error(resp, "Compaction failed")
    log.info(`Session compacted: ${sessionId}`)
    return resp.data as boolean
  }

  async listCommands(): Promise<Array<{ name: string; description?: string; template: string; agent?: string; source?: string }>> {
    const client = this.guardV2()
    const resp = this.usesOpenCode2()
      ? await client.v2.command.list({ ...(this.getDirectory() ? { location: { directory: this.getDirectory()! } } : {}) })
      : await client.command.list()
    this.throwOnV2Error(resp, "Failed to list commands")
    // The /command endpoint returns a bare `Array<Command>` in current SDK
    // builds; older builds wrapped it as `{ location, data: [...] }`. Accept
    // either shape so the command list never silently empties on an SDK bump
    // (reading `.data` off a bare array yielded `undefined` → no commands).
    const raw = resp.data as unknown
    const data = (Array.isArray(raw)
      ? raw
      : (raw as { data?: unknown } | null | undefined)?.data ?? []) as Array<{
      name: string
      description?: string
      template?: string
      agent?: string
      source?: string
    }>
    // Preserve the server-reported `source` ("command" | "mcp" | "skill") so the
    // commands modal can tag MCP-provided commands and surface them under the
    // MCP filter. Previously every entry was hard-coded to "server", so the MCP
    // filter was always empty even though MCP commands were present (and
    // executable). Absent source (older servers) defaults to "server".
    return data.map(c => ({
      name: c.name,
      description: c.description,
      template: c.template ?? "",
      agent: c.agent,
      source: c.source ?? "server",
    }))
  }

  async listSkills(): Promise<Array<{ name: string; description?: string; source: "skill" }>> {
    const client = this.guardV2()
    const resp = await client.v2.skill.list(this.getDirectory() ? { location: { directory: this.getDirectory()! } } : undefined)
    this.throwOnV2Error(resp, "Failed to list skills")
    // v2 response shape: { location, data: Array<SkillV2Info> }
    const raw = resp.data as unknown
    const data = (Array.isArray(raw) ? raw : (raw as { data?: unknown } | undefined)?.data ?? []) as Array<{ name: string; description?: string; slash?: boolean }>
    // Only include skills marked as slash commands
    return data.filter(s => s.slash).map(s => ({ name: s.name, description: s.description, source: "skill" as const }))
  }

  async abortSession(sessionId: string): Promise<boolean> {
    if (this.usesOpenCode2()) {
      const client = this.guardV2()
      const resp = await client.v2.session.interrupt({ sessionID: sessionId })
      this.throwOnV2Error(resp, "Failed to interrupt session")
      log.info(`Interrupted OpenCode 2 session: ${sessionId}`)
      return true
    }
    // v2 migration (Phase 2): flat `{ sessionID }` replaces v1 `{ path: { id } }`.
    const client = this.guardV2()
    await client.session.abort({ sessionID: sessionId })
    log.info(`Aborted session: ${sessionId}`)
    return true
  }

  async getMessages(sessionId: string, limit?: number): Promise<{ info: unknown; parts: Part[] }[]> {
    const client = this.guardV2()
    if (this.usesOpenCode2()) {
      const resp = await client.v2.session.messages({ sessionID: sessionId, ...(limit !== undefined ? { limit } : {}) })
      this.throwOnV2Error(resp, "Failed to get messages")
      const data = mapOpenCode2MessagePage(resp.data, sessionId)
      this.assertResponseSize(data, "getMessages")
      return data
    }
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
    if (this.usesOpenCode2()) this.unsupportedOpenCode2("Reading a session diff")
    const client = this.guardV2()
    const resp = await client.session.diff({
      sessionID: sessionId,
      ...(messageId ? { messageID: messageId } : {}),
    })
    this.throwOnV2Error(resp, "Failed to get diff")
    return resp.data
  }

  /**
   * Read a workspace file from the server, including its diff vs the original.
   * opencode applies edits server-side; this is how the extension obtains the
   * authoritative per-file diff (structured `patch.hunks` and/or unified
   * `diff` string) for the changed-files view.
   */
  async readFile(path: string, directory?: string, _messageId?: string): Promise<unknown> {
    if (this.usesOpenCode2()) this.unsupportedOpenCode2("Reading a workspace file with diff metadata")
    const client = this.guardV2()
    const resp = await client.file.read({ path, ...(directory ? { directory } : {}) })
    this.throwOnV2Error(resp, `Failed to read file '${path}'`)
    return resp.data
  }

  async revertMessage(sessionId: string, messageId: string): Promise<boolean> {
    if (this.usesOpenCode2()) this.unsupportedOpenCode2("Reverting a message")
    // v2 migration (Phase 2): flat `{ sessionID, messageID }` replaces v1
    // `{ path: { id }, body: { messageID } }`.
    const client = this.guardV2()
    await client.session.revert({ sessionID: sessionId, messageID: messageId })
    log.info(`Reverted message ${messageId} in session ${sessionId}`)
    return true
  }

  async revert(sessionId: string, messageID: string, partID?: string): Promise<boolean> {
    if (this.usesOpenCode2()) this.unsupportedOpenCode2("Reverting a message part")
    const client = this.guardV2()
    const req: { sessionID: string; messageID: string; partID?: string } = { sessionID: sessionId, messageID }
    if (partID) req.partID = partID
    await client.session.revert(req)
    log.info(`Reverted ${partID ? `part ${partID}` : "message"} ${messageID} in session ${sessionId}`)
    return true
  }

  async unrevert(sessionId: string): Promise<boolean> {
    if (this.usesOpenCode2()) this.unsupportedOpenCode2("Clearing a staged revert")
    const client = this.guardV2()
    await client.session.unrevert({ sessionID: sessionId })
    log.info(`Unreverted all messages in session ${sessionId}`)
    return true
  }

  async forkSession(sessionId: string, messageID: string): Promise<Session> {
    if (this.usesOpenCode2()) this.unsupportedOpenCode2("Forking a session")
    const client = this.guardV2()
    const resp = await client.session.fork({ sessionID: sessionId, messageID })
    this.throwOnV2Error(resp, "Failed to fork session")
    const session = mapV2Session(resp.data as Record<string, unknown>)
    log.info(`Forked session ${sessionId} at message ${messageID} → ${session.id}`)
    return session
  }

  /**
   * Run a shell command within a session context (P1.4 — audit §11).
   * The server executes the command and returns the AI's response as a
   * one-shot message (not streamed). `shell.started`/`shell.ended` events
   * fire via SessionNextHandler for live visibility in the terminal panel.
   */
  async runShell(
    sessionId: string,
    command: string,
    opts?: { model?: { providerID: string; modelID: string }; agent?: string; messageID?: string },
  ): Promise<{ messageId: string; text: string }> {
    if (this.usesOpenCode2()) this.unsupportedOpenCode2("Running a shell prompt")
    const client = this.guardV2()
    const params: Record<string, unknown> = { sessionID: sessionId, command }
    if (opts?.model) params.model = opts.model
    if (opts?.agent) params.agent = opts.agent
    if (opts?.messageID) params.messageID = opts.messageID
    const resp = await client.session.shell(params as Parameters<typeof client.session.shell>[0])
    this.throwOnV2Error(resp, "Failed to run shell command")
    const data = resp.data as { info?: { id?: string }; parts?: Array<{ type?: string; text?: string }> } | undefined
    const messageId = data?.info?.id ?? ""
    const textPart = data?.parts?.find((p) => p.type === "text" && typeof p.text === "string")
    const text = textPart?.text ?? ""
    log.info(`Shell command in session ${sessionId}: ${command.slice(0, 60)} → msg ${messageId}`)
    return { messageId, text }
  }

  /**
   * Create a shareable link for a session (P3.2 — audit §11).
   * Returns the updated Session with a `share.url` field.
   */
  async shareSession(sessionId: string): Promise<Session> {
    if (this.usesOpenCode2()) this.unsupportedOpenCode2("Sharing a session")
    const client = this.guardV2()
    const resp = await client.session.share({ sessionID: sessionId })
    this.throwOnV2Error(resp, "Failed to share session")
    const session = mapV2Session(resp.data as Record<string, unknown>)
    log.info(`Shared session ${sessionId}: ${session.share?.url ?? "(no url)"}`)
    return session
  }

  /**
   * Remove the shareable link for a session, making it private again (P3.2).
   * Returns the updated Session with `share` cleared.
   */
  async unshareSession(sessionId: string): Promise<Session> {
    if (this.usesOpenCode2()) this.unsupportedOpenCode2("Unsharing a session")
    const client = this.guardV2()
    const resp = await client.session.unshare({ sessionID: sessionId })
    this.throwOnV2Error(resp, "Failed to unshare session")
    const session = mapV2Session(resp.data as Record<string, unknown>)
    log.info(`Unshared session ${sessionId}`)
    return session
  }

  async respondToPermission(sessionId: string, permissionId: string, response: string): Promise<void> {
    const client = this.guardV2()
    if (!sessionId) throw new Error("Permission response missing session ID")
    if (!permissionId) throw new Error("Permission response missing permission ID")
    const normalized = this.normalizePermissionResponse(response)
    const resp = this.usesOpenCode2()
      ? await client.v2.session.permission.reply({ sessionID: sessionId, requestID: permissionId, reply: normalized })
      : await client.permission.reply({ requestID: permissionId, reply: normalized })
    this.throwOnV2Error(resp, "Permission response failed")
    log.info(`Permission ${permissionId} responded with: ${normalized}`)
  }

  async replyToQuestion(sessionId: string, requestID: string, answers: string[][]): Promise<void> {
    const client = this.guardV2()
    const api = resolveSessionQuestionApi(client)
    const resp = (await api.reply({ sessionID: sessionId, requestID, questionV2Reply: { answers } })) as
      | { error?: unknown }
      | null
      | undefined
    if (resp && typeof resp.error !== "undefined") {
      throw new Error(`Question reply failed: ${JSON.stringify(resp.error)}`)
    }
    log.info(`Session ${sessionId} question ${requestID} replied with ${answers.length} answer group(s)`)
  }

  async rejectQuestion(sessionId: string, requestID: string): Promise<void> {
    const client = this.guardV2()
    const api = resolveSessionQuestionApi(client)
    const resp = (await api.reject({ sessionID: sessionId, requestID })) as
      | { error?: unknown }
      | null
      | undefined
    if (resp && typeof resp.error !== "undefined") {
      throw new Error(`Question reject failed: ${JSON.stringify(resp.error)}`)
    }
    log.info(`Session ${sessionId} question ${requestID} rejected`)
  }

  async getSessionTodos(id: string): Promise<Array<{ id: string; content: string; status: string; priority: string }>> {
    if (this.usesOpenCode2()) this.unsupportedOpenCode2("Reading session todos")
    const client = this.guardV2()
    const resp = await client.session.todo({ sessionID: id })
    this.throwOnV2Error(resp, "Failed to get session todos")
    this.assertResponseSize(resp.data, "getSessionTodos")
    return (resp.data ?? []) as Array<{ id: string; content: string; status: string; priority: string }>
  }

  async getChildSessions(parentId: string): Promise<Session[]> {
    if (this.usesOpenCode2()) this.unsupportedOpenCode2("Reading child sessions")
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
    const client = this.guardV2()
    if (this.usesOpenCode2()) {
      const resolvedDirectory = directory ?? this.getDirectory()
      const resp = await client.v2.agent.list(resolvedDirectory ? { location: { directory: resolvedDirectory } } : undefined)
      this.throwOnV2Error(resp, "Failed to list agents")
      this.assertResponseSize(resp.data, "listAgents")
      return ((resp.data as { data?: Array<Record<string, unknown>> }).data ?? []).map(mapV2Agent)
    }
    const resp = await client.app.agents(directory ? { directory } : undefined)
    this.throwOnV2Error(resp, "Failed to list agents")
    this.assertResponseSize(resp.data, "listAgents")
    return ((resp.data as Array<Record<string, unknown>>) ?? []).map(mapV2Agent)
  }

  async sessionExists(id: string): Promise<boolean> {
    try {
      await this.getSession(id)
      return true
    } catch {
      return false
    }
  }

  async ensureSession(cliSessionId: string | undefined, title?: string): Promise<string> {
    this.guardV2()
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
