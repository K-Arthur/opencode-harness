export interface OpenTab {
  uri: string
}

export interface DocumentContent {
  content: string
  languageId: string
}

export interface SelectionRange {
  uri: string
  startLine: number
  endLine: number
  text: string
}

export interface AdapterDiagnostic {
  file: string
  errors: string[]
  warnings: string[]
  hints: string[]
}

export interface GitState {
  branch: string
  modified: string[]
  staged: string[]
}

export interface WorkspaceAdapter {
  listOpenTabs(): OpenTab[]
  getActiveSelection(): SelectionRange | undefined
  readFile(uri: string): Promise<DocumentContent>
  getRelativePath(uri: string): string
  getDiagnostics(): AdapterDiagnostic[]
  getWorkspaceFolders(): string[]
  findFiles(pattern: string, exclude?: string, maxResults?: number): Promise<string[]>
  getGitInfo(): GitState
}
