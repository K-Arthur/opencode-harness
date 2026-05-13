import type { PluginConfig, SavedImage } from "./types"
import { loadConfig } from "./config"
import { shouldActivate } from "./modelDetector"
import { saveImageFromDataUrl, cleanupOldImages } from "./imageSaver"
import {
  buildInjectionPrompt,
  isImagePart,
  extractImageData,
} from "./promptInjector"

let config: PluginConfig | undefined

const plugin = async (): Promise<Record<string, unknown>> => {
  if (!config) {
    config = loadConfig()
  }

  try {
    cleanupOldImages()
  } catch {
    // Ignore cleanup errors
  }

  return {
    "chat.message": async (input: { model?: { providerID?: string; modelID?: string } }, output: { parts: unknown[]; message?: Record<string, unknown> }) => {
      const model = input.model
      if (!model) {
        return
      }

      const providerID = model.providerID
      const modelID = model.modelID
      if (!providerID || !modelID) {
        return
      }

      if (!shouldActivate(providerID, modelID, config)) {
        return
      }

      const imageParts: Array<{ part: unknown; partId?: string }> = []

      for (let i = 0; i < output.parts.length; i++) {
        const part = output.parts[i]
        if (isImagePart(part)) {
          const p = part as Record<string, unknown>
          imageParts.push({
            part,
            partId: typeof p.partId === "string" ? p.partId : undefined,
          })
        }
      }

      if (imageParts.length === 0) {
        return
      }

      const toolName = config?.imageAnalysisTool
      if (!toolName) {
        console.warn(
          "[opencode-easy-vision] Warning: imageAnalysisTool not configured. " +
          "Please set imageAnalysisTool in your opencode-easy-vision.json"
        )
        return
      }

      const savedImages: SavedImage[] = []
      const textParts: string[] = []

      for (const { part, partId } of imageParts) {
        const imageData = extractImageData(part)
        if (imageData) {
          if (imageData.startsWith("data:")) {
            const saved = saveImageFromDataUrl(imageData, partId)
            if (saved) {
              savedImages.push(saved)
            }
          } else {
            savedImages.push({
              path: imageData,
              mime: "image/unknown",
              partId,
            })
          }
        }
      }

      if (savedImages.length === 0) {
        return
      }

      for (const part of output.parts) {
        if (
          part &&
          typeof part === "object" &&
          (part as { type?: string }).type === "text" &&
          typeof (part as { text?: string }).text === "string"
        ) {
          const text = (part as { text: string }).text
          if (!text.startsWith("data:")) {
            textParts.push(text)
          }
        }
      }

      const userText = textParts.join("\n\n")

      const injectionPrompt = buildInjectionPrompt(
        savedImages,
        toolName,
        userText,
        config,
      )

      output.parts = [
        {
          type: "text" as const,
          text: injectionPrompt,
        },
      ]

      if (output.message && typeof output.message === "object") {
        (output.message as Record<string, unknown>).text = injectionPrompt
      }

      console.log(
        `[opencode-easy-vision] Injected vision prompt for ${savedImages.length} image(s)`
      )
    },
  }
}

export default plugin
