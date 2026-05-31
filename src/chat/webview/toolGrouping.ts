import type { Block, ToolCallClass } from "./types"

type GroupStrategy = (toolName: string, toolClass: ToolCallClass | null, lastToolName: string | null, lastToolClass: ToolCallClass | null, hasCurrentGroup: boolean) => boolean

function consecutiveStrategy(_name: string, _cls: ToolCallClass | null, _lastName: string | null, _lastCls: ToolCallClass | null, hasGroup: boolean): boolean {
  return hasGroup
}

function nameStrategy(name: string, _cls: ToolCallClass | null, lastName: string | null, _lastCls: ToolCallClass | null, hasGroup: boolean): boolean {
  return name === lastName && hasGroup
}

function typeStrategy(_name: string, cls: ToolCallClass | null, _lastName: string | null, lastCls: ToolCallClass | null, hasGroup: boolean): boolean {
  return cls === lastCls && hasGroup
}

function getGroupStrategy(groupBy: 'consecutive' | 'name' | 'type'): GroupStrategy {
  if (groupBy === 'name') return nameStrategy
  if (groupBy === 'type') return typeStrategy
  return consecutiveStrategy
}

function isSilentLifecycleBlock(block: Block): boolean {
  if (block.type === "step-start") return true
  if (block.type === "step-finish") {
    const raw = typeof block.reason === "string" ? block.reason.trim() : ""
    if (raw === "") return true
    const normalized = raw.replace(/-/g, "_")
    return (
      normalized === "stop" ||
      normalized === "end_turn" ||
      normalized === "stop_sequence" ||
      normalized === "tool_use" ||
      normalized === "tool_calls" ||
      normalized === "complete"
    )
  }
  return false
}

function getToolInfo(block: Block): { isTool: boolean; toolName: string; toolClass: ToolCallClass | null } {
  const isTool = block.type === "tool-call" || block.type === "tool_call" || block.type === "tool"
  const canonicalToolName = typeof block.tool === "string" ? block.tool : ""
  const toolName: string = isTool ? (canonicalToolName || block.name || block.toolName || "tool") : ""
  const toolClass = isTool ? (block.class as ToolCallClass) || 'read' : null
  return { isTool, toolName, toolClass }
}

export function groupConsecutiveToolCalls(blocks: Block[], groupBy: 'consecutive' | 'name' | 'type' = 'consecutive'): Block[][] {
  const groups: Block[][] = []
  let currentGroup: Block[] = []
  let lastToolName: string | null = null
  let lastToolClass: ToolCallClass | null = null
  const pendingLifecycle: Block[] = []

  const flushLifecycle = () => {
    for (const lc of pendingLifecycle) groups.push([lc])
    pendingLifecycle.length = 0
  }

  const flushCurrentGroup = () => {
    if (currentGroup.length > 0) groups.push(currentGroup)
    flushLifecycle()
  }

  const strategy = getGroupStrategy(groupBy)

  for (const block of blocks) {
    const { isTool, toolName, toolClass } = getToolInfo(block)

    if (!isTool && isSilentLifecycleBlock(block)) {
      if (currentGroup.length > 0) {
        pendingLifecycle.push(block)
      } else {
        groups.push([block])
      }
      continue
    }

    if (!isTool) {
      flushCurrentGroup()
      groups.push([block])
      currentGroup = []
      lastToolName = null
      lastToolClass = null
      continue
    }

    if (strategy(toolName, toolClass, lastToolName, lastToolClass, currentGroup.length > 0)) {
      currentGroup.push(block)
    } else {
      flushCurrentGroup()
      currentGroup = [block]
      lastToolName = toolName
      lastToolClass = toolClass
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup)
  flushLifecycle()
  return groups
}
