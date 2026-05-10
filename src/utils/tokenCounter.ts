export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
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
      total += 1000 // Arbitrary estimate for image tokens
    } else if (block.type === "tool-call" || block.type === "tool_call") {
      total += estimateTokens(JSON.stringify(block.args || {}))
      if (block.result) total += estimateTokens(block.result)
    }
  }
  return total
}
