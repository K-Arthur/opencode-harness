import type { ElementRefs } from "./dom"
import type { Todo, SessionState } from "./types"
import { mergeTodos, generateTodoId } from "./todos-logic"
import { webviewLog } from "./streamHandlers"

export interface TodosModuleDeps {
  els: ElementRefs
  stateManager: {
    getState: () => { activeSessionId: string | null }
    getSession: (id: string) => SessionState | undefined
    save: () => void
    getAllSessions: () => SessionState[]
    renameSession: (id: string, name: string) => void
    setStreaming: (id: string, streaming: boolean) => void
    getActiveSession: () => SessionState | undefined
    setActiveSession: (id: string) => boolean
    ensureSession: (init: { id: string; name: string; model: string; mode: string; messages: SessionState["messages"]; isStreaming: boolean }) => SessionState
    createSession: (name?: string, model?: string, mode?: string) => SessionState
    deleteSession: (id: string) => void
    flush: () => void
  }
  todosPanelApi: {
    renderTodos: (todos: Todo[], replace: boolean, sessionId: string) => void
    isOpen: () => boolean
    open: () => void
    close: () => void
  } | null
}

export function createTodosModule(deps: TodosModuleDeps) {
  const serverTodosBySession = new Map<string, Todo[]>()
  const todosDismissedBySession = new Set<string>()
  const todosAutoOpenedForSession = new Set<string>()
  let _panelApi: TodosModuleDeps["todosPanelApi"] = deps.todosPanelApi

  function getServerTodos(sessionId: string): Todo[] {
    return serverTodosBySession.get(sessionId) ?? []
  }

  function setServerTodos(sessionId: string, todos: Todo[]): void {
    serverTodosBySession.set(sessionId, todos)
  }

  function getMergedTodos(sessionId: string, serverTodos: Todo[]): Todo[] {
    const session = deps.stateManager.getSession(sessionId)
    return mergeTodos(session, serverTodos)
  }

  function triggerTodosRender(sessionId: string, options?: { autoOpen?: boolean }) {
    if (!_panelApi) return
    const merged = getMergedTodos(sessionId, getServerTodos(sessionId))
    _panelApi.renderTodos(merged, false, sessionId)
    if (options?.autoOpen && merged.length > 0) {
      const activeSid = deps.stateManager.getState().activeSessionId
      const panelIsOpen = _panelApi.isOpen()
      const dismissed = todosDismissedBySession.has(sessionId)
      const alreadyOpened = todosAutoOpenedForSession.has(sessionId)
      if (activeSid === sessionId && !panelIsOpen && !dismissed && !alreadyOpened) {
        _panelApi.open()
        todosAutoOpenedForSession.add(sessionId)
        const btn = (globalThis as any).document?.getElementById?.("todos-toggle-btn") as HTMLElement | undefined
        if (btn) btn.setAttribute("aria-pressed", "true")
        webviewLog(`[main] todos panel auto-opened for session ${sessionId} (${merged.length} items)`)
      }
    }
  }

  function cleanupSession(sessionId: string): void {
    serverTodosBySession.delete(sessionId)
    todosDismissedBySession.delete(sessionId)
    todosAutoOpenedForSession.delete(sessionId)
  }

  function isUserTodoId(todoId: string): boolean {
    return todoId.startsWith("todo-")
  }

  function toggleTodo(todoOrId: string | Todo): void {
    const todoId = typeof todoOrId === "string" ? todoOrId : todoOrId.id
    if (!isUserTodoId(todoId)) return
    const activeSid = deps.stateManager.getState().activeSessionId
    if (!activeSid) return
    const session = deps.stateManager.getSession(activeSid)
    if (!session) return
    const todo = session.userTodos?.find(t => t.id === todoId)
    if (!todo) return
    todo.status = todo.status === "completed" ? "pending" : "completed"
    deps.stateManager.save()
    triggerTodosRender(activeSid)
  }

  function deleteTodo(todoId: string): void {
    if (!isUserTodoId(todoId)) return
    const activeSid = deps.stateManager.getState().activeSessionId
    if (!activeSid) return
    const session = deps.stateManager.getSession(activeSid)
    if (!session) return
    session.userTodos = session.userTodos?.filter(t => t.id !== todoId) || []
    deps.stateManager.save()
    triggerTodosRender(activeSid)
  }

  function addUserTodo(content: string): void {
    const activeSid = deps.stateManager.getState().activeSessionId
    if (!activeSid) return
    const session = deps.stateManager.getSession(activeSid)
    if (!session) return
    const normalized = content.trim().normalize("NFC")
    if (!normalized) return
    if (normalized.length > 500) {
      console.warn("Todo content exceeds 500 character limit")
      return
    }
    session.userTodos ??= []
    const dupKey = normalized.toLowerCase()
    const exists = session.userTodos.some(t => t.content.trim().normalize("NFC").toLowerCase() === dupKey)
    if (exists) {
      console.warn("Duplicate todo ignored")
      return
    }
    const id = generateTodoId()
    session.userTodos.push({ id, content: normalized, status: "pending", createdAt: Date.now() })
    deps.stateManager.save()
    triggerTodosRender(activeSid)
  }

  function editUserTodo(todoId: string, newContent: string): void {
    const activeSid = deps.stateManager.getState().activeSessionId
    if (!activeSid) return
    const session = deps.stateManager.getSession(activeSid)
    if (!session) return
    const normalized = newContent.trim().normalize("NFC")
    if (!normalized || normalized.length > 500) return
    const todo = session.userTodos?.find(t => t.id === todoId)
    if (!todo) return
    todo.content = normalized
    webviewLog(`[todos] edited user todo ${todoId}`)
    deps.stateManager.save()
    triggerTodosRender(activeSid)
  }

  return {
    getServerTodos,
    setServerTodos,
    getMergedTodos,
    triggerTodosRender,
    cleanupSession,
    isUserTodoId,
    toggleTodo,
    deleteTodo,
    addUserTodo,
    editUserTodo,
    serverTodosBySession,
    todosDismissedBySession,
    todosAutoOpenedForSession,
    setPanelApi: (api: typeof _panelApi) => { _panelApi = api },
  }
}
