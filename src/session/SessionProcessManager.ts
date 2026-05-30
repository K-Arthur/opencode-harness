export interface SessionConfig {
  port?: number
  workspaceRoot?: string
  cwd?: string
  env?: Record<string, string>
}

export interface SessionProcessHandle {
  readonly id: string
  readonly status: "running" | "crashed" | "stopped"
  readonly pid?: number
  start(config: SessionConfig): Promise<void>
  stop(): Promise<void>
  restart(): Promise<void>
}

export interface SessionProcessManager {
  spawnSession(config: SessionConfig): Promise<SessionProcessHandle>
  killSession(id: string): Promise<void>
  listActive(): SessionProcessHandle[]
}
