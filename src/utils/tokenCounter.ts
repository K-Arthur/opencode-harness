export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
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
