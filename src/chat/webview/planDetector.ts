import type { ToolCallBlock } from "./types"

export interface PlanData {
  name: string
  overview: string
  todos: Array<{ id: string; content: string; status: string }>
  filePath: string
}

export function detectPlanFile(toolBlock: ToolCallBlock): PlanData | null {
  if (toolBlock.class !== 'write') return null

  const args = toolBlock.args
  if (!args || typeof args !== 'object') return null
  const a = args as Record<string, unknown>

  const filePath = (a.path ?? a.file ?? a.filename ?? '') as string
  if (!filePath || (!filePath.endsWith('.md') && !filePath.endsWith('.plan.md'))) return null

  const content = (a.content ?? a.text ?? a.diff ?? '') as string
  if (!content) return null

  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!frontmatterMatch) return null

  const frontmatter = frontmatterMatch[1]
  if (!frontmatter) return null
  const nameMatch = frontmatter.match(/name:\s*(.+)/)
  const overviewMatch = frontmatter.match(/overview:\s*(.+)/)
  const todosIndex = frontmatter.search(/^todos:\s*$/m)
  if (todosIndex === -1) return null

  const todos: PlanData['todos'] = []
  const todoLines = frontmatter.slice(todosIndex).split('\n').slice(1)
  let currentTodo: PlanData['todos'][0] | null = null
  for (const line of todoLines) {
    if (/^\S/.test(line)) break
    const todoStart = line.match(/^\s+-\s+id:\s*(.+)/)
    const contentMatch = line.match(/^\s+(?:-\s+)?content:\s*(.+)/)
    const statusMatch = line.match(/^\s+(?:-\s+)?status:\s*(.+)/)
    if (todoStart) {
      if (currentTodo) todos.push(currentTodo)
      currentTodo = { id: todoStart[1]?.trim() ?? '', content: '', status: 'pending' }
    } else if (currentTodo) {
      if (contentMatch) currentTodo.content = contentMatch[1]?.trim() ?? ''
      if (statusMatch) currentTodo.status = statusMatch[1]?.trim() ?? 'pending'
    }
  }
  if (currentTodo) todos.push(currentTodo)

  if (todos.length === 0) return null

  return {
    name: nameMatch?.[1]?.trim() || filePath.split('/').pop() || 'Plan',
    overview: overviewMatch?.[1]?.trim() || '',
    todos,
    filePath,
  }
}
