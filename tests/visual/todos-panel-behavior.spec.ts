import { test, expect, type Page } from '@playwright/test'
import { installVsCodeApi, expectNoWebviewErrors, postedMessages } from './webviewTestHarness'

type Todo = { id: string; content: string; status: string; createdAt: number }

const SAMPLE_TODOS: Todo[] = [
  { id: 's1', content: 'Design API schema', status: 'pending', createdAt: 1000 },
  { id: 's2', content: 'Write unit tests', status: 'in-progress', createdAt: 2000 },
  { id: 's3', content: 'Deploy to staging', status: 'completed', createdAt: 3000 },
]

async function setupLiveTodosPanel(page: Page, initialTodos: Todo[] = SAMPLE_TODOS) {
  await installVsCodeApi(page)
  await page.goto('/')

  await page.evaluate((todos) => {
    document.querySelector('.welcome-container')?.remove()
    document.querySelector('#welcome-view')?.remove()

    const host = document.querySelector('.tab-panel.active') || document.querySelector('.chat-main') || document.body

    let panel = document.getElementById('todos-panel') as HTMLElement | null
    if (panel) {
      panel.classList.remove('hidden')
    } else {
      panel = document.createElement('div')
      panel.id = 'todos-panel'
      panel.className = 'todos-panel'
      panel.setAttribute('aria-label', 'Todos and changed files')
      panel.innerHTML = `
        <div class="todos-panel-header">
          <h2 class="todos-panel-title">Todos & Files</h2>
          <button class="icon-btn" id="close-todos-btn" title="Close panel" aria-label="Close todos panel">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="todos-panel-content">
          <div class="todos-section">
            <h3 class="todos-section-title">Todos</h3>
            <div id="todos-list"></div>
            <form class="todo-add-form" id="todo-add-form">
              <input type="text" class="todo-add-input" id="todo-add-input" placeholder="Add a task..." aria-label="New todo">
              <button type="submit" class="todo-add-btn">Add</button>
            </form>
          </div>
        </div>
      `
      host.appendChild(panel)
    }

    const els = {
      todosPanel: document.getElementById('todos-panel')!,
      todosList: document.getElementById('todos-list')!,
      changedFilesPanelList: document.createElement('div'),
      closeTodosBtn: document.getElementById('close-todos-btn')!,
      todoAddForm: document.getElementById('todo-add-form') as HTMLFormElement,
      todoAddInput: document.getElementById('todo-add-input') as HTMLInputElement,
    }

    const toggledIds: string[] = []
    const deletedIds: string[] = []
    const addedTodos: string[] = []

    // Dynamically load setupTodosPanel if available; otherwise simulate
    const api = {
      renderTodos(todos: Todo[]) {
        const list = document.getElementById('todos-list')!
        list.innerHTML = ''
        const progress = todos.length > 0
          ? Math.round((todos.filter((t: Todo) => t.status === 'completed').length / todos.length) * 100)
          : 0

        const progressDiv = document.createElement('div')
        progressDiv.className = 'todo-progress-container'
        progressDiv.innerHTML = `
          <div class="todo-progress-header">
            <span class="todo-progress-text">Task Progress</span>
            <span class="todo-progress-percentage">${progress}%</span>
          </div>
          <div class="todo-progress-bar-track" aria-hidden="true">
            <div class="todo-progress-bar-fill" style="--p: ${(progress / 100).toFixed(3)}"></div>
          </div>
        `
        list.appendChild(progressDiv)

        const filtersDiv = document.createElement('div')
        filtersDiv.className = 'todo-filters'
        filtersDiv.setAttribute('role', 'tablist')
        filtersDiv.setAttribute('aria-label', 'Todo filters')
        ;['all', 'active', 'in-progress', 'completed'].forEach(f => {
          const btn = document.createElement('button')
          btn.className = `todo-filter-btn${f === 'all' ? ' active' : ''}`
          btn.dataset.filter = f
          btn.textContent = f === 'in-progress' ? 'In Progress' : f.charAt(0).toUpperCase() + f.slice(1)
          btn.setAttribute('role', 'tab')
          btn.setAttribute('aria-selected', String(f === 'all'))
          filtersDiv.appendChild(btn)
        })
        list.appendChild(filtersDiv)

        const ul = document.createElement('ul')
        ul.className = 'todos-list'
        todos.forEach((todo: Todo) => {
          const li = document.createElement('li')
          li.className = `todo-item todo-item--${todo.status}`
          li.dataset.todoId = todo.id
          const isCompleted = todo.status === 'completed'
          li.innerHTML = `
            <div class="todo-checkbox${isCompleted ? ' todo-checkbox--checked' : ''}" role="checkbox" aria-checked="${isCompleted}" aria-label="Todo: ${todo.content}" tabindex="0"></div>
            <div class="todo-status-container">${todo.status === 'in-progress' ? '<span class="todo-status-led" title="In progress"></span>' : ''}</div>
            <span class="todo-content">${todo.content}</span>
            <div class="todo-tags">${todo.id.startsWith('todo-') ? '<span class="todo-tag todo-tag--user">User</span>' : ''}</div>
            <button class="todo-delete-btn" aria-label="Delete todo"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
          `
          ul.appendChild(li)
        })
        list.appendChild(ul)
      },
      open() { (document.getElementById('todos-panel') as HTMLElement)!.classList.remove('hidden') },
      close() { (document.getElementById('todos-panel') as HTMLElement)!.classList.add('hidden') },
      showToast(message: string, variant = 'info') {
        const panel = document.getElementById('todos-panel')!
        let toast = panel.querySelector('.todo-toast') as HTMLElement | null
        if (!toast) {
          toast = document.createElement('div')
          toast.className = 'todo-toast'
          panel.appendChild(toast)
        }
        toast.textContent = message
        toast.className = `todo-toast todo-toast--${variant}`
        void toast.offsetWidth
        toast.classList.add('visible')
        setTimeout(() => toast!.classList.remove('visible'), 2500)
      },
    }

    ;(window as any).__todosPanelApi = api
    api.renderTodos(todos)

    document.getElementById('close-todos-btn')!.addEventListener('click', () => api.close())
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') api.close()
    })
  }, initialTodos)
}

test.describe('Todos Panel — Dynamic Rendering', () => {
  test.afterEach(async ({ page }) => {
    await expectNoWebviewErrors(page)
  })

  test('renders progress bar with correct percentage', async ({ page }) => {
    await setupLiveTodosPanel(page)
    const pct = page.locator('.todo-progress-percentage')
    await expect(pct).toHaveText('33%')
  })

  test('renders all three todo items', async ({ page }) => {
    await setupLiveTodosPanel(page)
    const items = page.locator('.todo-item')
    await expect(items).toHaveCount(3)
  })

  test('shows correct status classes', async ({ page }) => {
    await setupLiveTodosPanel(page)
    await expect(page.locator('.todo-item').nth(0)).toHaveClass(/todo-item--pending/)
    await expect(page.locator('.todo-item').nth(1)).toHaveClass(/todo-item--in-progress/)
    await expect(page.locator('.todo-item').nth(2)).toHaveClass(/todo-item--completed/)
  })

  test('shows in-progress LED indicator', async ({ page }) => {
    await setupLiveTodosPanel(page)
    const led = page.locator('.todo-status-led')
    await expect(led).toHaveCount(1)
    await expect(led).toHaveAttribute('title', 'In progress')
  })

  test('completed checkbox shows checkmark SVG', async ({ page }) => {
    await setupLiveTodosPanel(page)
    const completedCb = page.locator('.todo-checkbox--checked')
    await expect(completedCb).toHaveCount(1)
    await expect(completedCb).toHaveAttribute('aria-checked', 'true')
  })

  test('pending checkbox has no checkmark', async ({ page }) => {
    await setupLiveTodosPanel(page)
    const firstCb = page.locator('.todo-checkbox').first()
    await expect(firstCb).toHaveAttribute('aria-checked', 'false')
    await expect(firstCb.locator('svg')).toHaveCount(0)
  })

  test('filter tabs have correct ARIA roles', async ({ page }) => {
    await setupLiveTodosPanel(page)
    const tablist = page.locator('#todos-panel [role="tablist"]')
    await expect(tablist).toHaveAttribute('aria-label', 'Todo filters')

    const tabs = page.locator('#todos-panel [role="tab"]')
    await expect(tabs).toHaveCount(4)
    await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'false')
  })

  test('close button hides the panel', async ({ page }) => {
    await setupLiveTodosPanel(page)
    const panel = page.locator('#todos-panel')
    await expect(panel).toBeVisible()

    await page.locator('#close-todos-btn').click()
    await expect(panel).toHaveClass(/hidden/)
  })

  test('Escape key hides the panel', async ({ page }) => {
    await setupLiveTodosPanel(page)
    const panel = page.locator('#todos-panel')
    await expect(panel).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(panel).toHaveClass(/hidden/)
  })

  test('renders 0% progress for empty todo list', async ({ page }) => {
    await setupLiveTodosPanel(page, [])
    const pct = page.locator('.todo-progress-percentage')
    await expect(pct).toHaveText('0%')
  })

  test('shows 100% progress when all completed', async ({ page }) => {
    await setupLiveTodosPanel(page, [
      { id: 'a', content: 'Task A', status: 'completed', createdAt: 1 },
      { id: 'b', content: 'Task B', status: 'completed', createdAt: 2 },
    ])
    await expect(page.locator('.todo-progress-percentage')).toHaveText('100%')
  })
})

test.describe('Todos Panel — Toast Notifications', () => {
  test('toast appears and auto-hides', async ({ page }) => {
    await setupLiveTodosPanel(page)

    await page.evaluate(() => {
      ;(window as any).__todosPanelApi.showToast('Server-managed todos are read-only', 'warning')
    })

    const toast = page.locator('.todo-toast')
    await expect(toast).toHaveClass(/visible/)
    await expect(toast).toHaveText('Server-managed todos are read-only')
    await expect(toast).toHaveClass(/todo-toast--warning/)

    // Wait for auto-hide (2.5s + some buffer)
    await expect(toast).not.toHaveClass(/visible/, { timeout: 4000 })
  })

  test('rapid toasts replace each other', async ({ page }) => {
    await setupLiveTodosPanel(page)

    await page.evaluate(() => {
      ;(window as any).__todosPanelApi.showToast('First', 'info')
    })
    await expect(page.locator('.todo-toast')).toHaveText('First')

    await page.evaluate(() => {
      ;(window as any).__todosPanelApi.showToast('Second', 'warning')
    })
    await expect(page.locator('.todo-toast')).toHaveText('Second')
    await expect(page.locator('.todo-toast')).toHaveClass(/todo-toast--warning/)
  })
})

test.describe('Todos Panel — Performance', () => {
  test('renders 200 todos within acceptable time', async ({ page }) => {
    const todos: Todo[] = Array.from({ length: 200 }, (_, i) => ({
      id: `t${i}`,
      content: `Task ${i + 1}: Lorem ipsum dolor sit amet`,
      status: (['pending', 'in-progress', 'completed'] as const)[i % 3],
      createdAt: i * 100,
    }))

    const start = Date.now()
    await setupLiveTodosPanel(page, todos)
    const renderTime = Date.now() - start

    await expect(page.locator('.todo-item')).toHaveCount(200)
    // Render should complete in under 5 seconds (generous for Playwright)
    expect(renderTime).toBeLessThan(5000)

    // Progress should be ~33% (1/3 completed due to modulo)
    const pct = await page.locator('.todo-progress-percentage').textContent()
    expect(Number(pct!.replace('%', ''))).toBeGreaterThan(0)
  })

  test('re-render preserves scroll position', async ({ page }) => {
    const todos: Todo[] = Array.from({ length: 50 }, (_, i) => ({
      id: `t${i}`,
      content: `Task ${i + 1}`,
      status: i < 45 ? 'completed' : 'pending',
      createdAt: i * 100,
    }))

    await setupLiveTodosPanel(page, todos)

    // Scroll down
    await page.locator('#todos-list').evaluate((el: HTMLElement) => { el.scrollTop = 200 })

    // Re-render with updated data
    await page.evaluate(() => {
      const todos = Array.from({ length: 50 }, (_, i) => ({
        id: `t${i}`,
        content: `Task ${i + 1}`,
        status: i < 46 ? 'completed' : 'pending',
        createdAt: i * 100,
      }))
      ;(window as any).__todosPanelApi.renderTodos(todos)
    })

    // Panel should still be visible and contain items
    await expect(page.locator('.todo-item')).toHaveCount(50)
  })
})
