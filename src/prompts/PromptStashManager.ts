import * as vscode from "vscode"
import { log } from "../utils/outputChannel"

export interface StashedPrompt {
  id: string
  name: string
  content: string
  sessionId?: string
  createdAt: number
  lastUsedAt: number
  usageCount: number
  isGlobal: boolean
}

export interface PromptStashManagerOptions {
  context: vscode.ExtensionContext
}

export class PromptStashManager {
  private static readonly STORAGE_KEY = "promptStash"
  private static readonly GLOBAL_PREFIX = "global:"
  private stashes: Map<string, StashedPrompt> = new Map()

  constructor(private opts: PromptStashManagerOptions) {
    this.loadStashes()
  }

  /**
   * Load stashed prompts from global state.
   */
  private loadStashes(): void {
    try {
      const data = this.opts.context.globalState.get<Record<string, StashedPrompt>>(PromptStashManager.STORAGE_KEY, {})
      this.stashes = new Map(Object.entries(data))
      log.info(`Loaded ${this.stashes.size} stashed prompts`)
    } catch (err) {
      log.error("Failed to load stashed prompts", err)
      this.stashes = new Map()
    }
  }

  /**
   * Save stashed prompts to global state.
   */
  private saveStashes(): void {
    try {
      const data = Object.fromEntries(this.stashes)
      void this.opts.context.globalState.update(PromptStashManager.STORAGE_KEY, data)
    } catch (err) {
      log.error("Failed to save stashed prompts", err)
    }
  }

  /**
   * Generate a unique ID for a stash.
   */
  private generateId(): string {
    return `stash_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  }

  /**
   * Stash a prompt globally.
   */
  async stashGlobal(name: string, content: string): Promise<string> {
    if (!name || name.trim().length === 0) {
      throw new Error("Stash name cannot be empty")
    }
    if (!content || content.trim().length === 0) {
      throw new Error("Stash content cannot be empty")
    }
    const id = PromptStashManager.GLOBAL_PREFIX + this.generateId()
    const stash: StashedPrompt = {
      id,
      name: name.trim(),
      content: content.trim(),
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      usageCount: 0,
      isGlobal: true,
    }
    this.stashes.set(id, stash)
    this.saveStashes()
    return id
  }

  /**
   * Stash a prompt for a specific session.
   */
  async stashForSession(name: string, content: string, sessionId: string): Promise<string> {
    if (!name || name.trim().length === 0) {
      throw new Error("Stash name cannot be empty")
    }
    if (!content || content.trim().length === 0) {
      throw new Error("Stash content cannot be empty")
    }
    if (!sessionId || sessionId.trim().length === 0) {
      throw new Error("Session ID cannot be empty")
    }
    const id = this.generateId()
    const stash: StashedPrompt = {
      id,
      name: name.trim(),
      content: content.trim(),
      sessionId: sessionId.trim(),
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      usageCount: 0,
      isGlobal: false,
    }
    this.stashes.set(id, stash)
    this.saveStashes()
    return id
  }

  /**
   * Get all stashed prompts.
   */
  getAllStashes(): StashedPrompt[] {
    return Array.from(this.stashes.values()).sort((a, b) => b.lastUsedAt - a.lastUsedAt)
  }

  /**
   * Get global stashes only.
   */
  getGlobalStashes(): StashedPrompt[] {
    return this.getAllStashes().filter((s) => s.isGlobal)
  }

  /**
   * Get stashes for a specific session.
   */
  getSessionStashes(sessionId: string): StashedPrompt[] {
    return this.getAllStashes().filter((s) => s.sessionId === sessionId)
  }

  /**
   * Get a stash by ID.
   */
  getStash(id: string): StashedPrompt | undefined {
    return this.stashes.get(id)
  }

  /**
   * Update a stash.
   */
  async updateStash(id: string, updates: Partial<Omit<StashedPrompt, "id" | "createdAt">>): Promise<void> {
    if (!id || id.trim().length === 0) {
      throw new Error("Stash ID cannot be empty")
    }
    const existing = this.stashes.get(id)
    if (!existing) {
      throw new Error(`Stash ${id} not found`)
    }
    
    // Validate name if provided
    if (updates.name !== undefined) {
      if (!updates.name || updates.name.trim().length === 0) {
        throw new Error("Stash name cannot be empty")
      }
      updates.name = updates.name.trim()
    }
    
    // Validate content if provided
    if (updates.content !== undefined) {
      if (!updates.content || updates.content.trim().length === 0) {
        throw new Error("Stash content cannot be empty")
      }
      updates.content = updates.content.trim()
    }
    
    // Validate sessionId if provided
    if (updates.sessionId !== undefined) {
      if (updates.sessionId && updates.sessionId.trim().length === 0) {
        throw new Error("Session ID cannot be empty")
      }
      updates.sessionId = updates.sessionId?.trim()
    }
    
    // Validate usageCount if provided
    if (updates.usageCount !== undefined) {
      if (updates.usageCount < 0) {
        throw new Error("Usage count cannot be negative")
      }
    }
    
    const updated: StashedPrompt = {
      ...existing,
      ...updates,
    }
    this.stashes.set(id, updated)
    this.saveStashes()
  }

  /**
   * Delete a stash.
   */
  async deleteStash(id: string): Promise<void> {
    if (!id || id.trim().length === 0) {
      return // Silently ignore empty IDs
    }
    const deleted = this.stashes.delete(id)
    if (deleted) {
      this.saveStashes()
    }
  }

  /**
   * Record usage of a stash.
   */
  async recordUsage(id: string): Promise<void> {
    if (!id || id.trim().length === 0) {
      return // Silently ignore empty IDs
    }
    const existing = this.stashes.get(id)
    if (existing) {
      existing.lastUsedAt = Date.now()
      existing.usageCount++
      this.saveStashes()
    }
  }

  /**
   * Clean up old session stashes (older than specified days).
   */
  async pruneOldSessionStashes(daysToKeep: number = 30): Promise<void> {
    if (daysToKeep < 0) {
      throw new Error("daysToKeep cannot be negative")
    }
    if (daysToKeep === 0) {
      // Delete all session stashes
      let deleted = 0
      for (const [id, stash] of this.stashes.entries()) {
        if (!stash.isGlobal) {
          this.stashes.delete(id)
          deleted++
        }
      }
      if (deleted > 0) {
        this.saveStashes()
        log.info(`Pruned ${deleted} all session stashes`)
      }
      return
    }
    const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000)
    let deleted = 0
    for (const [id, stash] of this.stashes.entries()) {
      if (!stash.isGlobal && stash.lastUsedAt < cutoffTime) {
        this.stashes.delete(id)
        deleted++
      }
    }
    if (deleted > 0) {
      this.saveStashes()
      log.info(`Pruned ${deleted} old session stashes`)
    }
  }

  dispose(): void {
    // Nothing to dispose
  }
}
