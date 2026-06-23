import type * as vscode from "vscode"
import * as fs from "node:fs"
import * as path from "node:path"
import { parseJsonc } from "../utils/jsonc"
import type { WorkspaceConfig, ConfigLoadStatus, ConfigLoadResult } from "./types"

/** Minimal logger interface to avoid pulling in vscode at module load time. */
export interface ConfigLogger {
  warn(message: string, err?: unknown): void
  error(message: string, err?: unknown): void
  info(message: string): void
}

const CONFIG_FILENAMES = ["opencode.json", "opencode.jsonc"]
const CONFIG_SUBDIR = ".opencode"
const DEBOUNCE_MS = 300

/**
 * Discovers, parses, and watches `opencode.jsonc` (or `opencode.json`) in the
 * workspace. Provides typed access to the parsed config and fires
 * `onConfigChanged` when the file is modified, created, or deleted.
 *
 * Discovery order (later entries overlay earlier by shallow merge):
 * 1. `OPENCODE_CONFIG` env var (highest precedence)
 * 2. Workspace root: `opencode.jsonc` → `opencode.json`
 * 3. `.opencode/` subdir: `opencode.jsonc` → `opencode.json`
 * 4. Additional workspace folders (multi-root)
 *
 * Falls back to empty config (no crash) when the file is missing, empty,
 * comments-only, or structurally invalid.
 */
export class OpenCodeConfigService implements vscode.Disposable {
  private _config: WorkspaceConfig = {}
  private _status: ConfigLoadStatus = "not_found"
  private _configPath: string | undefined
  private _emitter: vscode.EventEmitter<ConfigLoadResult> | undefined
  private _watcher: vscode.FileSystemWatcher | undefined
  private _debounceTimer: ReturnType<typeof setTimeout> | undefined

  readonly onConfigChanged: vscode.Event<ConfigLoadResult>

  private _logger: ConfigLogger | undefined

  constructor(private readonly vscodeApi: typeof vscode, logger?: ConfigLogger) {
    this._logger = logger
    this._emitter = new vscodeApi.EventEmitter<ConfigLoadResult>()
    this.onConfigChanged = this._emitter.event
  }

  /**
   * Re-read the config file(s) from disk and update the cached config.
   * Fires `onConfigChanged` if the config content changed.
   */
  async refresh(): Promise<ConfigLoadResult> {
    const result = await this.loadConfig()
    const changed = JSON.stringify(result.config) !== JSON.stringify(this._config)
    this._config = result.config
    this._status = result.status
    this._configPath = result.path
    if (changed) {
      this._emitter?.fire(result)
    }
    return result
  }

  /**
   * Get the cached parsed config without re-reading disk.
   */
  getConfig(): WorkspaceConfig {
    return this._config
  }

  /**
   * Get the status of the last config load operation.
   */
  getStatus(): ConfigLoadStatus {
    return this._status
  }

  /**
   * Get the path of the loaded config file (undefined if not found).
   */
  getConfigPath(): string | undefined {
    return this._configPath
  }

  /**
   * Start watching the config file for changes. Fires `onConfigChanged`
   * (debounced) when the file is modified, created, or deleted.
   */
  watch(): void {
    this.disposeWatcher()
    const folders = this.vscodeApi.workspace.workspaceFolders
    if (!folders || folders.length === 0) return

    const patterns: vscode.RelativePattern[] = []
    for (const folder of folders) {
      patterns.push(new this.vscodeApi.RelativePattern(folder, "opencode.jsonc"))
      patterns.push(new this.vscodeApi.RelativePattern(folder, "opencode.json"))
      patterns.push(new this.vscodeApi.RelativePattern(folder, ".opencode/opencode.jsonc"))
      patterns.push(new this.vscodeApi.RelativePattern(folder, ".opencode/opencode.json"))
    }

    for (const pattern of patterns) {
      try {
        const watcher = this.vscodeApi.workspace.createFileSystemWatcher(pattern)
        watcher.onDidCreate(() => this.debouncedRefresh())
        watcher.onDidChange(() => this.debouncedRefresh())
        watcher.onDidDelete(() => this.debouncedRefresh())
        this._watcher = watcher
        break
      } catch (err) {
        this._logger?.error("Failed to create config file watcher", err)
      }
    }
  }

  private debouncedRefresh(): void {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer)
    }
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = undefined
      void this.refresh().catch((err) => {
        this._logger?.error("Failed to refresh config after file change", err)
      })
    }, DEBOUNCE_MS)
  }

  private async loadConfig(): Promise<ConfigLoadResult> {
    const paths = this.discoverConfigPaths()
    if (paths.length === 0) {
      return { config: {}, status: "not_found", errors: [] }
    }

    let merged: WorkspaceConfig = {}
    let lastPath: string | undefined
    let hadError = false
    const allErrors: string[] = []

    for (const configPath of paths) {
      const result = this.loadFile(configPath)
      if (result.errors.length > 0) {
        allErrors.push(...result.errors)
        hadError = true
        continue
      }
      merged = { ...merged, ...result.config }
      lastPath = configPath
    }

    if (hadError && Object.keys(merged).length === 0) {
      return { config: {}, status: "parse_error", errors: allErrors }
    }

    return { config: merged, status: "ok", path: lastPath, errors: allErrors }
  }

  private loadFile(configPath: string): { config: WorkspaceConfig; errors: string[] } {
    try {
      if (!fs.existsSync(configPath)) {
        return { config: {}, errors: [] }
      }
      const content = fs.readFileSync(configPath, "utf8")
      const result = parseJsonc(content)
      if (result.errors.length > 0) {
        const errorMessages = result.errors.map((e) => `${e.message} at offset ${e.offset}`)
        this._logger?.warn(`Failed to parse config at ${configPath}: ${errorMessages.join(", ")}`)
        return { config: {}, errors: errorMessages }
      }
      const config = result.config
      if (config === null || config === undefined || typeof config !== "object" || Array.isArray(config)) {
        return { config: {}, errors: [] }
      }
      return { config: config as WorkspaceConfig, errors: [] }
    } catch (err) {
      this._logger?.warn(`Failed to read config at ${configPath}`, err)
      return { config: {}, errors: [`Read error: ${(err as Error).message}`] }
    }
  }

  private discoverConfigPaths(): string[] {
    const paths: string[] = []

    const folders = this.vscodeApi.workspace.workspaceFolders
    if (folders) {
      for (const folder of folders) {
        const root = folder.uri.fsPath
        for (const filename of CONFIG_FILENAMES) {
          const subdirPath = path.join(root, CONFIG_SUBDIR, filename)
          if (fs.existsSync(subdirPath)) {
            paths.push(subdirPath)
          }
          const rootPath = path.join(root, filename)
          if (fs.existsSync(rootPath)) {
            paths.push(rootPath)
          }
        }
      }
    }

    const envConfig = process.env.OPENCODE_CONFIG
    if (envConfig) {
      const resolved = path.resolve(envConfig)
      if (fs.existsSync(resolved)) {
        paths.push(resolved)
      }
    }

    return paths
  }

  private disposeWatcher(): void {
    if (this._watcher) {
      try { this._watcher.dispose() } catch { /* ignore */ }
      this._watcher = undefined
    }
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer)
      this._debounceTimer = undefined
    }
  }

  dispose(): void {
    this.disposeWatcher()
    this._emitter?.dispose()
  }
}
