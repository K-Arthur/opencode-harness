import { PromptStashManager } from "../prompts/PromptStashManager"
import { TabManager } from "./TabManager"
import { log } from "../utils/outputChannel"

export interface StashServiceDeps {
  promptStashManager: PromptStashManager
  tabManager: TabManager
  postMessage: (msg: Record<string, unknown>) => void
}

export class StashService {
  constructor(private deps: StashServiceDeps) {}

  async handleStashPrompt(name: string, content: string, isGlobal: boolean): Promise<void> {
    try {
      const active = this.deps.tabManager.getActiveTab()
      if (isGlobal) {
        await this.deps.promptStashManager.stashGlobal(name, content)
      } else if (active) {
        await this.deps.promptStashManager.stashForSession(name, content, active.cliSessionId || active.id)
      }
      this.deps.postMessage({ type: "stash_success", name })
    } catch (err) {
      log.error("Stash prompt failed", err)
      this.deps.postMessage({ type: "stash_error", error: "Failed to stash prompt" })
    }
  }

  handleListStashes(): void {
    try {
      const active = this.deps.tabManager.getActiveTab()
      const stashes = active
        ? this.deps.promptStashManager.getSessionStashes(active.cliSessionId || active.id)
        : this.deps.promptStashManager.getGlobalStashes()
      this.deps.postMessage({ type: "stash_list", stashes })
    } catch (err) {
      log.error("List stashes failed", err)
      this.deps.postMessage({ type: "stash_error", error: "Failed to list stashes" })
    }
  }

  async handleDeleteStash(id: string): Promise<void> {
    try {
      await this.deps.promptStashManager.deleteStash(id)
      this.deps.postMessage({ type: "stash_deleted", id })
    } catch (err) {
      log.error("Delete stash failed", err)
      this.deps.postMessage({ type: "stash_error", error: "Failed to delete stash" })
    }
  }
}
