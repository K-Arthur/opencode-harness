import type { SavedImage, PluginConfig } from "./types"
import { DEFAULT_PROMPT_TEMPLATE } from "./config"

function buildImageList(images: SavedImage[]): string {
  return images
    .map((img, index) => `- Image ${index + 1}: ${img.path}`)
    .join("\n")
}

function replaceTemplateVariables(
  template: string,
  variables: Record<string, string>,
): string {
  let result = template
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value)
  }
  return result
}

export function buildInjectionPrompt(
  images: SavedImage[],
  toolName: string,
  userText: string,
  config?: PluginConfig,
): string {
  const template = config?.promptTemplate ?? DEFAULT_PROMPT_TEMPLATE

  const variables: Record<string, string> = {
    imageCount: String(images.length),
    imageList: buildImageList(images),
    toolName,
    userText: userText || "(Please analyze these images)",
  }

  return replaceTemplateVariables(template, variables)
}

export function isImagePart(part: unknown): boolean {
  if (!part || typeof part !== "object") {
    return false
  }

  const p = part as Record<string, unknown>

  if (p.type === "file" && typeof p.mime === "string") {
    return p.mime.startsWith("image/")
  }

  if (p.type === "text" && typeof p.text === "string") {
    return p.text.startsWith("data:image/")
  }

  return false
}

export function extractImageData(part: unknown): string | null {
  if (!part || typeof part !== "object") {
    return null
  }

  const p = part as Record<string, unknown>

  if (p.type === "file" && typeof p.url === "string") {
    return p.url
  }

  if (p.type === "text" && typeof p.text === "string" && p.text.startsWith("data:image/")) {
    return p.text
  }

  return null
}

export { buildImageList, replaceTemplateVariables }
