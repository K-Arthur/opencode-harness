import type { AutoCompactor } from "./AutoCompactor"
import type { SessionLifecycleService } from "./SessionLifecycleService"
import { isPlanDocumentPattern, resolvePlanPermission } from "./modePolicy"

export interface DiffAcceptDeps {
  sessionLifecycle: SessionLifecycleService
  autoCompactor: AutoCompactor
  postMessage: (msg: Record<string, unknown>) => void
  postRequestError: (msg: string) => void
}

export class DiffAcceptService {
  constructor(private deps: DiffAcceptDeps) {}

  async handleAcceptDiff(blockId: string, sessionId?: string): Promise<void> {
    return this.deps.sessionLifecycle.handleAcceptDiff(blockId, sessionId)
  }

  shouldAutoRejectPlanPermission(data: { type?: string; pattern?: string | string[] }): boolean {
    return resolvePlanPermission(data) === "reject"
  }

  isPlanDocumentPattern(pattern: string | string[]): boolean {
    return isPlanDocumentPattern(pattern)
  }

  async handleCompactBannerAction(sessionId: string | undefined, action: string): Promise<void> {
    await this.deps.autoCompactor.handleBannerAction(sessionId, action, {
      postMessage: (m) => this.deps.postMessage(m),
      postRequestError: (m) => this.deps.postRequestError(m),
    })
  }

  async handleCompactSession(sessionId?: string): Promise<void> {
    return this.deps.sessionLifecycle.handleCompactSession(sessionId)
  }
}
