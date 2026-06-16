export interface PtySessionInfo {
  id: string
  title: string
  command: string
  status: "running" | "exited"
  pid: number
  exitCode?: number
}

export interface PtyOutputEvent {
  ptyId: string
  data: string | ArrayBuffer | Blob
  type: "stdout" | "stderr"
}

export type PtyLifecycleEvent =
  | { type: "created"; pty: PtySessionInfo }
  | { type: "updated"; pty: PtySessionInfo }
  | { type: "exited"; pty: PtySessionInfo }
  | { type: "deleted"; ptyId: string }

export interface PtyConnectToken {
  ticket: string
  expiresIn: number
}

export interface PtyService {
  createSession(options?: {
    command?: string
    args?: string[]
    cwd?: string
    title?: string
  }): Promise<PtySessionInfo>
  getSession(ptyId: string): Promise<PtySessionInfo>
  removeSession(ptyId: string): Promise<void>
  listSessions(): Promise<PtySessionInfo[]>
  updateSession(ptyId: string, options: { title?: string; size?: { rows: number; cols: number } }): Promise<PtySessionInfo>
  getConnectToken(ptyId: string): Promise<PtyConnectToken>
  connectWebSocket(
    ptyId: string,
    ticket: string,
    onOutput: (event: PtyOutputEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>
  sendInput(ptyId: string, data: string, ticket?: string): Promise<void>
  setTerminalSize(ptyId: string, rows: number, cols: number): Promise<void>
}
