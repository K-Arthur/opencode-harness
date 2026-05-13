/**
 * Estimate token count for text using an improved heuristic.
 * This approximates actual tokenization without requiring external libraries.
 * The heuristic accounts for common patterns like code, whitespace, and punctuation.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  
  // Base approximation: ~4 characters per token for English text
  let tokenCount = Math.ceil(text.length / 4)
  
  // Adjustments for common patterns
  
  // Code has more tokens due to operators, keywords, and structure
  // Code typically has ~3 characters per token
  if (/[{}()\[\];:,.<>]/.test(text)) {
    tokenCount = text.length / 3
  }
  
  // Whitespace-heavy text (like code with indentation) has fewer tokens
  // Count non-whitespace characters and adjust
  const nonWhitespace = text.replace(/\s/g, '').length
  const whitespaceRatio = (text.length - nonWhitespace) / text.length
  if (whitespaceRatio > 0.3) {
    // If >30% whitespace, adjust estimate based on actual content
    tokenCount = (nonWhitespace / 3.5) + (text.length - nonWhitespace) / 8
  }
  
  // Short strings are often single tokens
  if (text.length <= 4) {
    tokenCount = 1
  }
  
  // Very short words (1-2 chars) are often combined with others
  // Long words are often split into multiple tokens
  const words = text.split(/\s+/).filter(w => w.length > 0)
  if (words.length > 0) {
    const avgWordLength = nonWhitespace / words.length
    if (avgWordLength < 3) {
      // Short words: adjust down
      tokenCount *= 0.9
    } else if (avgWordLength > 10) {
      // Long words: adjust up
      tokenCount *= 1.2
    }
  }
  
  // JSON and code-like structures have more tokens
  if (text.startsWith('{') || text.startsWith('[')) {
    tokenCount *= 1.3
  }
  
  return Math.ceil(tokenCount)
}

export function parseModelRef(model: string): { providerID: string; modelID: string } {
  const slashIdx = model.indexOf("/")
  if (slashIdx === -1) return { providerID: "", modelID: model }
  return {
    providerID: model.substring(0, slashIdx),
    modelID: model.substring(slashIdx + 1),
  }
}

export function estimateContextTokens(pkg: { openFiles: { content: string; path: string }[]; diagnostics?: unknown; gitStatus?: unknown; terminalOutput?: { text: string }; workspaceTree?: unknown; projectConfigs?: unknown[] }): number {
  let total = 0

  for (const file of pkg.openFiles) {
    total += estimateTokens(file.content)
    total += estimateTokens(file.path)
  }

  if (pkg.terminalOutput) {
    total += estimateTokens(pkg.terminalOutput.text)
  }

  total += estimateTokens(JSON.stringify(pkg.diagnostics ?? {}))
  total += estimateTokens(JSON.stringify(pkg.gitStatus ?? {}))
  total += estimateTokens(JSON.stringify(pkg.workspaceTree ?? {}))
  total += estimateTokens(JSON.stringify(pkg.projectConfigs ?? []))

  return total
}

export function estimateMessageTokens(msg: { blocks?: any[] }): number {
  let total = 0
  if (!msg.blocks) return 0
  for (const block of msg.blocks) {
    if (block.type === "text" && block.text) {
      total += estimateTokens(block.text)
    } else if (block.type === "image" && block.data) {
      // Image tokens: base64 encoded data is ~1.33x original size
      // Estimate based on typical image token costs (e.g., 85 tokens per tile for 512x512)
      // Use a more accurate estimate based on data size
      const dataSize = block.data.length
      total += Math.ceil(dataSize / 100) // Rough estimate: 1 token per 100 chars of base64
    } else if (block.type === "tool-call" || block.type === "tool_call") {
      total += estimateTokens(JSON.stringify(block.args || {}))
      if (block.result) total += estimateTokens(block.result)
    }
  }
  return total
}
