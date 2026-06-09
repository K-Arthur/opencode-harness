import type { Session } from "@opencode-ai/sdk"
import type { SessionClient } from "../../session/SessionClient"
import type { SubagentActivityInput, SubagentRunState } from "./runActivityTypes"
import { log } from "../../utils/outputChannel"

const POLL_INTERVAL_MS = 5_000
const MAX_POLL_RETRIES = 2

export interface SubagentHeartbeatCallbacks {
  getSubagentSnapshot(tabId: string): SubagentRunState[]
  recordSubagentActivity(tabId: string, input: SubagentActivityInput): void
  hasActiveRun(tabId: string): boolean
  /** Host registers childSessionId → parent tabId mapping so child session events
   *  route to the correct parent tab via resolveServerEventTab. Must be called
   *  on first discovery of each child session. */
  registerChildSessionMapping(tabId: string, childSessionId: string): void
}

export class SubagentHeartbeat {
  private readonly timers = new Map<string, ReturnType<typeof setInterval>>()
  private readonly knownChildren = new Map<string, Map<string, Session>>()
  private readonly retryCounts = new Map<string, number>()

  constructor(
    private readonly sessionClient: SessionClient,
    private readonly callbacks: SubagentHeartbeatCallbacks,
  ) {}

  start(tabId: string, cliSessionId: string): void {
    this.stop(tabId)
    this.knownChildren.set(tabId, new Map())
    this.retryCounts.set(tabId, 0)

    const timer = setInterval(() => {
      void this.poll(tabId, cliSessionId)
    }, POLL_INTERVAL_MS)
    timer.unref()

    this.timers.set(tabId, timer)
    log.info(`SubagentHeartbeat started for tab ${tabId} (session ${cliSessionId})`)

    void this.poll(tabId, cliSessionId)
  }

  stop(tabId: string): void {
    const timer = this.timers.get(tabId)
    if (timer) {
      clearInterval(timer)
      this.timers.delete(tabId)
    }
    this.knownChildren.delete(tabId)
    this.retryCounts.delete(tabId)
  }

  stopAll(): void {
    for (const tabId of this.timers.keys()) {
      this.stop(tabId)
    }
  }

  private async poll(tabId: string, cliSessionId: string): Promise<void> {
    if (!this.callbacks.hasActiveRun(tabId)) {
      return
    }

    let children: Session[] = []
    try {
      children = await this.sessionClient.getChildSessions(cliSessionId)
      this.retryCounts.set(tabId, 0)
    } catch (err) {
      const retries = this.retryCounts.get(tabId) ?? 0
      if (retries < MAX_POLL_RETRIES) {
        this.retryCounts.set(tabId, retries + 1)
        log.warn(`SubagentHeartbeat poll failed for tab ${tabId} (attempt ${retries + 1}):`, err)
      } else {
        log.error(`SubagentHeartbeat poll failed for tab ${tabId} after ${MAX_POLL_RETRIES} retries:`, err)
      }
      return
    }

    try {
      const previous = this.knownChildren.get(tabId)
      if (!previous) return

      const currentIds = new Set(children.map(c => c.id))
      const previousIds = new Set(previous.keys())

      const added = children.filter(c => !previousIds.has(c.id))
      const removed: Session[] = []
      for (const [id, session] of previous) {
        if (!currentIds.has(id)) {
          removed.push(session)
        }
      }

      const subagents = this.callbacks.getSubagentSnapshot(tabId)
      const childlessSubagents = subagents.filter(s => !s.childSessionId && s.status === "running")

      let changed = false

      for (const child of added) {
        const existing = subagents.find(s => s.childSessionId === child.id)
        if (existing) continue

        const match = childlessSubagents.shift()
        if (match) {
          this.callbacks.recordSubagentActivity(tabId, {
            id: match.id,
            agentName: match.agentName,
            status: "running",
            childSessionId: child.id,
            currentActivity: child.title || match.currentActivity,
          })
          changed = true
          log.info(`SubagentHeartbeat: linked child session ${child.id} to subagent ${match.id} for tab ${tabId}`)
        } else {
          const id = `subagent-child-${child.id.slice(0, 8)}`
          this.callbacks.recordSubagentActivity(tabId, {
            id,
            agentName: child.title || "subagent",
            status: "running",
            childSessionId: child.id,
          })
          changed = true
          log.info(`SubagentHeartbeat: discovered child session ${child.id} for tab ${tabId}`)
        }
        this.callbacks.registerChildSessionMapping(tabId, child.id)
      }

      for (const child of removed) {
        const match = subagents.find(s => s.childSessionId === child.id)
        if (match && (match.status === "running" || match.status === "queued" || match.status === "waiting")) {
          this.callbacks.recordSubagentActivity(tabId, {
            id: match.id,
            agentName: match.agentName,
            status: "completed",
            childSessionId: child.id,
          })
          changed = true
          log.info(`SubagentHeartbeat: child session ${child.id} removed — marking subagent ${match.id} as completed for tab ${tabId}`)
        }
      }

      if (changed) {
        const current = new Map<string, Session>()
        for (const child of children) {
          current.set(child.id, child)
        }
        this.knownChildren.set(tabId, current)
      } else {
        this.knownChildren.set(tabId, new Map(children.map(c => [c.id, c] as const)))
      }
    } catch (err) {
      log.error(`SubagentHeartbeat poll processing failed for tab ${tabId}:`, err)
    }
  }
}
