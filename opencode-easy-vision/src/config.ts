import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import type { PluginConfig } from "./types"

const DEFAULT_CONFIG: PluginConfig = {
  models: undefined,
  excludeModels: undefined,
  imageAnalysisTool: undefined,
  promptTemplate: undefined,
}

export const DEFAULT_PROMPT_TEMPLATE = `I'm attaching {imageCount} image(s) for you to analyze.

Images:
{imageList}

Use the \`{toolName}\` tool on each one to understand what they show.

My question: {userText}`

function getConfigPaths(): string[] {
  const paths: string[] = []

  const cwd = process.cwd()
  paths.push(path.join(cwd, ".opencode", "opencode-easy-vision.json"))

  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
  paths.push(path.join(configHome, "opencode", "opencode-easy-vision.json"))

  return paths
}

function loadConfigFile(configPath: string): PluginConfig | null {
  if (!fs.existsSync(configPath)) {
    return null
  }

  try {
    const content = fs.readFileSync(configPath, "utf8")
    return JSON.parse(content) as PluginConfig
  } catch (err) {
    console.warn(`[opencode-easy-vision] Warning: Failed to load config from ${configPath}: ${err}`)
    return null
  }
}

export function loadConfig(): PluginConfig {
  for (const configPath of getConfigPaths()) {
    const config = loadConfigFile(configPath)
    if (config) {
      return {
        ...DEFAULT_CONFIG,
        ...config,
      }
    }
  }

  return DEFAULT_CONFIG
}

export { getConfigPaths, loadConfigFile }
