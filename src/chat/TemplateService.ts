import { TemplateLibraryManager } from "../prompts/templateLibrary"
import { log } from "../utils/outputChannel"

export interface TemplateServiceDeps {
  templateLibrary: TemplateLibraryManager
  postMessage: (msg: Record<string, unknown>) => void
}

export class TemplateService {
  constructor(private deps: TemplateServiceDeps) {}

  async handleSaveTemplate(
    name: string,
    content: string,
    tags: string[] = [],
    existingId?: string,
  ): Promise<void> {
    try {
      const template = await this.deps.templateLibrary.saveTemplate(name, content, tags, existingId)
      this.deps.postMessage({ type: "template_saved", template })
    } catch (err) {
      log.error("Save template failed", err)
      this.deps.postMessage({
        type: "template_error",
        error: err instanceof Error ? err.message : "Failed to save template",
      })
    }
  }

  handleListTemplates(): void {
    try {
      const templates = this.deps.templateLibrary.listTemplates()
      this.deps.postMessage({ type: "template_list", templates })
    } catch (err) {
      log.error("List templates failed", err)
      this.deps.postMessage({ type: "template_error", error: "Failed to list templates" })
    }
  }

  async handleDeleteTemplate(id: string): Promise<void> {
    try {
      let deleted = await this.deps.templateLibrary.deleteTemplate(id)
      if (!deleted) {
        // Try delete by name
        const byName = this.deps.templateLibrary.getTemplateByName(id)
        if (byName) {
          deleted = await this.deps.templateLibrary.deleteTemplate(byName.id)
        }
      }
      if (!deleted) {
        this.deps.postMessage({ type: "template_error", error: `Template "${id}" not found` })
        return
      }
      this.deps.postMessage({ type: "template_deleted", id })
    } catch (err) {
      log.error("Delete template failed", err)
      this.deps.postMessage({ type: "template_error", error: "Failed to delete template" })
    }
  }
}
