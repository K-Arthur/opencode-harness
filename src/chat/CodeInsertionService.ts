import { ChatFileOps } from "./ChatFileOps"

export class CodeInsertionService {
  constructor(private fileOps: ChatFileOps) {}

  async handleInsertAtCursor(code: string, _language: string): Promise<void> {
    await this.fileOps.insertAtCursor(code)
  }

  async handleCreateFileFromCode(code: string, language: string): Promise<void> {
    await this.fileOps.createFromCode(code, language)
  }

  languageExtension(language: string): string {
    return ChatFileOps.extensionForLanguage(language)
  }
}
