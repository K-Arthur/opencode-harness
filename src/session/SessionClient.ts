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
import type { ModelRef, PromptOptions as BasePromptOptions } from "./sessionTypes"
import { isLocalPlaceholderSessionId } from "./sessionUtils"
import { logStreamTrace } from "./streamTrace"

const MAX_RESPONSE_SIZE = 50 * 1024 * 1024

interface PromptOptions extends BasePromptOptions {
  signal?: AbortSignal
}

export class SessionClient {
  private _currentModel: ModelRef | null = null
  private readonly MAX_RETRIES = 3
  private readonly BASE_BACKOFF_MS = 1000

  constructor(
    private readonly getClient: () => OpencodeClient | null,
    private readonly mcpServerManager?: McpServerManager,
    private readonly disposed: () => boolean = () => false,
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
    const client = this.guard()
    const resp = await client.session.create({ body: { title } })
    if (resp.error) throw new Error(`Failed to create session: ${JSON.stringify(resp.error)}`)
    log.info(`Created session: ${(resp.data as Session)?.id}`)
    return resp.data as Session
  }

  async deleteSession(id: string): Promise<boolean> {
    const client = this.guard()
    await client.session.delete({ path: { id } })
    log.info(`Deleted session: ${id}`)
    return true
  }

  async getSession(id: string): Promise<Session> {
    const client = this.guard()
    const resp = await client.session.get({ path: { id } })
    if (resp.error) throw new Error(`Failed to get session: ${JSON.stringify(resp.error)}`)
    return resp.data as Session
  }

  async updateSessionTitle(id: string, title: string): Promise<Session> {
    const client = this.guard()
    const resp = await client.session.update({ path: { id }, body: { title } })
    if (resp.error) throw new Error(`Failed to update session title: ${JSON.stringify(resp.error)}`)
    return resp.data as Session
  }

  async getSessionMessages(id: string): Promise<Array<{ info: Message; parts: Part[] }>> {
    const client = this.guard()
    const resp = await client.session.messages({ path: { id } })
    if (resp.error) throw new Error(`Failed to get session messages: ${JSON.stringify(resp.error)}`)
    const data = (resp.data as Array<{ info: Message; parts: Part[] }> | undefined) ?? []
    this.assertResponseSize(data, "getSessionMessages")
    return data
  }

  async listSessions(): Promise<Session[]> {
    const client = this.guard()
    const resp = await client.session.list()
    if (resp.error) throw new Error(`Failed to list sessions: ${JSON.stringify(resp.error)}`)
    const data = (resp.data as Session[]) ?? []
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
    const client = this.guard()
    await client.session.abort({ path: { id: sessionId } })
    log.info(`Aborted session: ${sessionId}`)
    return true
  }

  async getMessages(sessionId: string, limit?: number): Promise<{ info: unknown; parts: Part[] }[]> {
    const client = this.guard()
    const resp = await client.session.messages({
      path: { id: sessionId },
      query: { limit },
    })
    if (resp.error) throw new Error(`Failed to get messages: ${JSON.stringify(resp.error)}`)
    const data = (resp.data as { info: unknown; parts: Part[] }[]) ?? []
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
    const client = this.guard()
    await client.session.revert({ path: { id: sessionId }, body: { messageID: messageId } })
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
    const client = this.guard()
    const question = (client as unknown as {
      question?: {
        reply?: (parameters: { requestID: string; answers?: string[][] }) => Promise<{ error?: unknown }>
      }
    }).question
    if (!question?.reply) throw new Error("OpenCode question reply API is unavailable")
    const resp = await question.reply({ requestID, answers })
    if (resp.error) throw new Error(`Question reply failed: ${JSON.stringify(resp.error)}`)
    log.info(`Question ${requestID} replied with ${answers.length} answer group(s)`)
  }

  async rejectQuestion(requestID: string): Promise<void> {
    const client = this.guard()
    const question = (client as unknown as {
      question?: {
        reject?: (parameters: { requestID: string }) => Promise<{ error?: unknown }>
      }
    }).question
    if (!question?.reject) throw new Error("OpenCode question reject API is unavailable")
    const resp = await question.reject({ requestID })
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
    const client = this.guard()
    const resp = await client.session.children({ path: { id: parentId } })
    if (resp.error) throw new Error(`Failed to get child sessions: ${JSON.stringify(resp.error)}`)
    const data = (resp.data as Session[]) ?? []
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
