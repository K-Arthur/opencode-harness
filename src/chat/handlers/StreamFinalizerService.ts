import type { StreamCallbacks, ToolEndResult, StreamLifecycleState } from "./StreamCoordinator"
import type { TabManager } from "../TabManager"
import type { Block } from "../types"
import { log } from "../../utils/outputChannel"

export interface StreamFinalizerDeps {
  streamStates: Map<string, StreamLifecycleState>
  finalizingTabs: Set<string>
  abortedTabs: Set<string>
  activeMessageIds: Map<string, string>
  activeToolCallIds: Map<string, Set<string>>
  toolCallCounts: Map<string, number>
  toolActivityAt: Map<string, Map<string, number>>
  pendingToolGraceTimeouts: Map<string, ReturnType<typeof setTimeout>>
  stuckStreamHandlers: Map<string, StreamCallbacks>
  ttfbTimeouts: Map<string, ReturnType<typeof setTimeout>>
  tabManager: TabManager
  stopWatchdogIfNoStreams: () => void
  stopHeartbeat: (tabId: string) => void
  setStreamState: (tabId: string, state: StreamLifecycleState, context?: Record<string, unknown>) => void
  ensureStreamMessageId: (tabId: string, cliSessionId?: string) => string
  fetchFinalBlocks: (tabId: string, cliSessionId: string | undefined, callbacks: StreamCallbacks) => Promise<{ blocks: Block[]; sdkTokenTotal: number | undefined }>
  mergeFinalBlocks: (tabId: string, serverBlocks: Block[]) => Block[]
  storeAssistantMessage: (tabId: string, streamMessageId: string, blocks: Block[], sdkTokenTotal: number | undefined) => void
  nextSeq: (tabId: string) => number
}

export class StreamFinalizerService {
  constructor(private deps: StreamFinalizerDeps) {}

  async finalizeStream(tabId: string, callbacks: StreamCallbacks): Promise<void> {
    const tab = this.deps.tabManager.getTab(tabId)
    if (!tab || !tab.waitingForCompletion) return

    if (this.deps.abortedTabs.has(tabId)) {
      log.info(`finalizeStream skipped for ${tabId} — abort owns stream_end`)
      return
    }

    if (this.deps.finalizingTabs.has(tabId)) {
      log.info(`finalizeStream skipped for ${tabId} — already finalizing`)
      return
    }
    this.deps.finalizingTabs.add(tabId)

    try {
      this.deps.setStreamState(tabId, "completing", { sessionId: tab.cliSessionId })
      const streamMessageId = this.deps.ensureStreamMessageId(tabId, tab.cliSessionId || tabId)

      this.clearTtfbTimeout(tabId)
      this.deps.stuckStreamHandlers.delete(tabId)
      this.deps.tabManager.clearCompletionTimeout(tabId)
      this.deps.tabManager.setWaitingForCompletion(tabId, false)

      const { blocks: serverBlocks, sdkTokenTotal } = await this.deps.fetchFinalBlocks(tabId, tab.cliSessionId, callbacks)
      const blocks = this.deps.mergeFinalBlocks(tabId, serverBlocks)

      log.debug(`finalizeStream: ${blocks.length} block(s) for ${tabId}`)
      this.deps.storeAssistantMessage(tabId, streamMessageId, blocks, sdkTokenTotal)
      this.postStreamEndAndCleanup(tabId, streamMessageId, blocks, callbacks)
    } finally {
      this.deps.finalizingTabs.delete(tabId)
    }
  }

  private clearTtfbTimeout(tabId: string): void {
    const timer = this.deps.ttfbTimeouts.get(tabId)
    if (timer) {
      clearTimeout(timer)
      this.deps.ttfbTimeouts.delete(tabId)
    }
  }

  private clearPendingToolGraceTimeout(tabId: string): void {
    const timer = this.deps.pendingToolGraceTimeouts.get(tabId)
    if (!timer) return
    clearTimeout(timer)
    this.deps.pendingToolGraceTimeouts.delete(tabId)
  }

  private postStreamEndAndCleanup(
    tabId: string,
    streamMessageId: string,
    blocks: Block[],
    callbacks: StreamCallbacks
  ): void {
    if (this.deps.abortedTabs.has(tabId)) {
      log.info(`finalizeStream suppressing stream_end for ${tabId} — abort raced ahead`)
    } else {
      callbacks.postMessage({
        type: "stream_end",
        sessionId: tabId,
        messageId: streamMessageId,
        blocks,
        seq: this.deps.nextSeq(tabId),
      })
    }

    this.deps.tabManager.setStreaming(tabId, false)
    this.deps.stopWatchdogIfNoStreams()
    this.deps.tabManager.clearBuffer(tabId)
    this.deps.tabManager.clearBlocksBuffer(tabId)
    this.deps.toolCallCounts.delete(tabId)
    this.deps.activeToolCallIds.delete(tabId)
    this.deps.toolActivityAt.delete(tabId)
    this.clearPendingToolGraceTimeout(tabId)
    this.deps.activeMessageIds.delete(tabId)
    this.deps.stopHeartbeat(tabId)
    const tab = this.deps.tabManager.getTab(tabId)
    this.deps.setStreamState(tabId, "idle", { sessionId: tab?.cliSessionId })
  }
}
