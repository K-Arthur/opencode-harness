import * as vscode from "vscode"
import { log } from "../utils/outputChannel"

export interface PromptTemplate {
  id: string
  name: string
  content: string
  tags: string[]
  createdAt: number
  updatedAt: number
}

export interface TemplateLibraryOptions {
  context: vscode.ExtensionContext
}

export class TemplateLibraryManager {
  private static readonly STORAGE_KEY = "promptTemplates"
  private templates: Map<string, PromptTemplate> = new Map()

  constructor(private opts: TemplateLibraryOptions) {
    this.loadTemplates()
  }

  private loadTemplates(): void {
    try {
      const data = this.opts.context.globalState.get<Record<string, PromptTemplate>>(
        TemplateLibraryManager.STORAGE_KEY,
        {},
      )
      this.templates = new Map(Object.entries(data))
      log.info(`Loaded ${this.templates.size} prompt templates`)
    } catch (err) {
      log.error("Failed to load prompt templates", err)
      this.templates = new Map()
    }
  }

  private saveTemplates(): void {
    try {
      const data = Object.fromEntries(this.templates)
      void this.opts.context.globalState.update(TemplateLibraryManager.STORAGE_KEY, data)
    } catch (err) {
      log.error("Failed to save prompt templates", err)
    }
  }

  private generateId(): string {
    return `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  }

  async saveTemplate(
    name: string,
    content: string,
    tags: string[] = [],
    existingId?: string,
  ): Promise<PromptTemplate> {
    if (!name || name.trim().length === 0) {
      throw new Error("Template name cannot be empty")
    }
    if (!content || content.trim().length === 0) {
      throw new Error("Template content cannot be empty")
    }
    const now = Date.now()
    if (existingId) {
      const existing = this.templates.get(existingId)
      if (!existing) {
        throw new Error(`Template ${existingId} not found`)
      }
      const updated: PromptTemplate = {
        ...existing,
        name: name.trim(),
        content: content.trim(),
        tags: tags.map((t) => t.trim()).filter(Boolean),
        updatedAt: now,
      }
      this.templates.set(existingId, updated)
      this.saveTemplates()
      return updated
    }
    const id = this.generateId()
    const template: PromptTemplate = {
      id,
      name: name.trim(),
      content: content.trim(),
      tags: tags.map((t) => t.trim()).filter(Boolean),
      createdAt: now,
      updatedAt: now,
    }
    this.templates.set(id, template)
    this.saveTemplates()
    return template
  }

  listTemplates(): PromptTemplate[] {
    return Array.from(this.templates.values()).sort((a, b) => a.name.localeCompare(b.name))
  }

  getTemplate(id: string): PromptTemplate | undefined {
    return this.templates.get(id)
  }

  getTemplateByName(name: string): PromptTemplate | undefined {
    const normalized = name.trim().toLowerCase()
    for (const tpl of this.templates.values()) {
      if (tpl.name.toLowerCase() === normalized) return tpl
    }
    return undefined
  }

  async deleteTemplate(id: string): Promise<boolean> {
    if (!id || id.trim().length === 0) return false
    const deleted = this.templates.delete(id)
    if (deleted) {
      this.saveTemplates()
    }
    return deleted
  }

  dispose(): void {
    // Nothing to dispose
  }
}
