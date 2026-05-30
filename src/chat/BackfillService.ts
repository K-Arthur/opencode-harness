import { SessionStore, type OpenCodeSession } from "../session/SessionStore"
import { sdkMessagesToChatMessages } from "../session/sdkMessageConverter"
import { summarizeOpencodeMessageUsage } from "../session/sdkUsageSummary"
import { isLocalPlaceholderSessionId } from "../session/sessionUtils"
import { TabManager } from "./TabManager"
import { log } from "../utils/outputChannel"
import { selectPendingBackfill, SingleFlight } from "./backfillPlanner"
import type { Message, Part } from "@opencode-ai/sdk"

interface BackfillDeps {
  sessionStore: SessionStore
  tabManager: TabManager
  getSessionMessages: (cliSessionId: string) => Promise<Array<{ info: Message; parts: Part[] }>>
  pushInitState: () => void
  postSessionListUpdate: (sessions: OpenCodeSession[]) => void
}

export class BackfillService {
  private backfillInProgress = new Set<string>()
  private backfillRetryTimer?: NodeJS.Timeout
  private readonly BACKFILL_RETRY_DELAYS_MS = [1500, 4000, 8000, 16000]
  private readonly BACKFILL_CONCURRENCY = 5
  private restoredTabsHydrated = false
  // B3: coalesce concurrent fetches for the same CLI session id so a recovered
  // session and a tab-created backfill never double-fetch the same history.
  private readonly fetchFlight = new SingleFlight<Array<{ info: Message; parts: Part[] }>>()

  constructor(private readonly deps: BackfillDeps) {}

  /**
   * Fetch (deduped by cliSessionId) → convert → apply → auto-title for one
   * session. Returns the number of messages applied. Single source of truth for
   * both backfill entry points (B1).
   */
  private async hydrate(session: OpenCodeSession): Promise<number> {
    const cliId = session.cliSessionId
    if (!cliId || isLocalPlaceholderSessionId(cliId)) return 0
    const rows = await this.fetchFlight.run(cliId, () => this.deps.getSessionMessages(cliId))
    const messages = sdkMessagesToChatMessages(rows)
    if (messages.length === 0) return 0
    this.deps.sessionStore.applyBackfilledMessages(session.id, messages, summarizeOpencodeMessageUsage(rows))
    this.deps.sessionStore.autoTitleFromMessages(session.id)
    return messages.length
  }

  get isHydrated(): boolean {
    return this.restoredTabsHydrated
  }

  setHydrated(value: boolean): void {
    this.restoredTabsHydrated = value
  }

  async backfillRecoveredSessions(sessions: OpenCodeSession[], isRetry: boolean = false): Promise<boolean> {
    // B2: process ALL pending sessions (chunked by BACKFILL_CONCURRENCY below)
    // rather than a fixed slice(0, 10) that silently abandoned the 11th+.
    const sessionsNeedingBackfill = selectPendingBackfill(sessions)

    if (sessionsNeedingBackfill.length === 0) {
      const tabs = this.deps.tabManager.getAllTabs()
      for (const tab of tabs) {
        const s = this.deps.sessionStore.get(tab.id)
        if (s && !s.cliSessionId) {
          log.info(`[sessions_recovered] Tab ${tab.id} has no cliSessionId`)
        }
      }
    }

    let didBackfill = false
    if (sessionsNeedingBackfill.length > 0) {
      log.info(`[sessions_recovered] Auto-backfilling ${sessionsNeedingBackfill.length} recent sessions`)
    }

    const backfillOne = async (session: OpenCodeSession): Promise<void> => {
      if (this.backfillInProgress.has(session.id)) {
        log.info(`[sessions_recovered] Skipping backfill for ${session.id} because backfill is already in progress`)
        return
      }

      this.backfillInProgress.add(session.id)
      try {
        const applied = await this.hydrate(session)
        if (applied > 0) {
          log.info(`[sessions_recovered] Backfilled ${applied} messages for session ${session.id}`)
          didBackfill = true
        } else {
          log.debug(`[sessions_recovered] Empty response for ${session.id}; leaving needsBackfill set for retry`)
        }
      } catch (err) {
        log.warn(`[sessions_recovered] Backfill failed for ${session.id}`, err)
      } finally {
        this.backfillInProgress.delete(session.id)
      }
    }

    for (let i = 0; i < sessionsNeedingBackfill.length; i += this.BACKFILL_CONCURRENCY) {
      const chunk = sessionsNeedingBackfill.slice(i, i + this.BACKFILL_CONCURRENCY)
      await Promise.allSettled(chunk.map(backfillOne))
    }

    const stillPending = this.deps.sessionStore
      .list()
      .filter((s) => s.needsBackfill === true && !!s.cliSessionId && s.messages.length === 0)
    if (stillPending.length > 0 && !isRetry) {
      this.scheduleBackfillRetry(0)
    }

    if (didBackfill || isRetry) {
      const succeeded = sessionsNeedingBackfill.length - stillPending.length
      log.info(`[sessions_recovered] Backfill summary: ${succeeded}/${sessionsNeedingBackfill.length} succeeded, ${stillPending.length} pending`)
    }

    return didBackfill
  }

  scheduleBackfillRetry(attempt: number): void {
    if (attempt >= this.BACKFILL_RETRY_DELAYS_MS.length) return
    if (this.backfillRetryTimer) clearTimeout(this.backfillRetryTimer)

    const delay = this.BACKFILL_RETRY_DELAYS_MS[attempt]!
    this.backfillRetryTimer = setTimeout(async () => {
      this.backfillRetryTimer = undefined
      const all = this.deps.sessionStore.list()
      const stillPending = all.filter(
        (s) => s.needsBackfill === true && !!s.cliSessionId && s.messages.length === 0
      )
      if (stillPending.length === 0) return

      log.info(`[sessions_recovered] Retry attempt ${attempt + 1} for ${stillPending.length} session(s)`)
      try {
        const changed = await this.backfillRecoveredSessions(all, true)
        if (changed) {
          this.restoredTabsHydrated = false
          this.deps.pushInitState()
          this.deps.postSessionListUpdate(this.deps.sessionStore.list())
        }
      } catch (err) {
        log.warn(`[sessions_recovered] Retry attempt ${attempt + 1} failed`, err)
      }

      const stillStillPending = this.deps.sessionStore
        .list()
        .filter((s) => s.needsBackfill === true && !!s.cliSessionId && s.messages.length === 0)
      if (stillStillPending.length > 0) {
        const isLastAttempt = attempt + 1 >= this.BACKFILL_RETRY_DELAYS_MS.length
        if (isLastAttempt) {
          const ids = stillStillPending.map((s) => s.id)
          for (const s of stillStillPending) {
            this.deps.sessionStore.clearNeedsBackfill(s.id)
          }
          log.info(`[sessions_recovered] Giving up on backfill for ${ids.length} session(s) after ${this.BACKFILL_RETRY_DELAYS_MS.length} attempts: ${ids.join(", ")}`)
        } else {
          this.scheduleBackfillRetry(attempt + 1)
        }
      }
    }, delay)
  }

  async backfillTabIfNeeded(tabId: string): Promise<void> {
    const session = this.deps.sessionStore.get(tabId)
    if (!session || !session.cliSessionId || isLocalPlaceholderSessionId(session.cliSessionId)) {
      return
    }

    if (session.messages.length > 0 && session.needsBackfill !== true) {
      return
    }

    if (this.backfillInProgress.has(tabId)) {
      log.info(`[tab_created] Skipping backfill for ${tabId} because backfill is already in progress`)
      return
    }

    const tab = this.deps.tabManager.getTab(tabId)
    if (tab?.isStreaming) {
      log.info(`[tab_created] Skipping backfill for ${tabId} because it is currently streaming`)
      return
    }

    this.backfillInProgress.add(tabId)
    try {
      const applied = await this.hydrate(session)
      if (applied > 0) {
        log.info(`[tab_created] Backfilled ${applied} messages for session ${session.id}`)
        const tabAfter = this.deps.tabManager.getTab(tabId)
        if (tabAfter?.isStreaming) {
          log.info(`[tab_created] Skipping pushInitState for ${session.id} because streaming started during backfill`)
        } else {
          this.restoredTabsHydrated = false
          this.deps.pushInitState()
        }
      } else {
        log.debug(`[tab_created] Empty response for ${session.id}; leaving needsBackfill set for retry`)
      }
    } catch (err) {
      log.warn(`[tab_created] Backfill failed for ${session.id}`, err)
    } finally {
      this.backfillInProgress.delete(tabId)
    }
  }

  dispose(): void {
    if (this.backfillRetryTimer) {
      clearTimeout(this.backfillRetryTimer)
      this.backfillRetryTimer = undefined
    }
  }
}
