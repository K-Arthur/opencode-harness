export interface PluginConfig {
  models?: string[]
  excludeModels?: string[]
  imageAnalysisTool?: string
  promptTemplate?: string
}

export interface SavedImage {
  path: string
  mime: string
  partId?: string
}
