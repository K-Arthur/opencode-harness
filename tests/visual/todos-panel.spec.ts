import { test, expect, type Page } from '@playwright/test'
import { installVsCodeApi, expectNoWebviewErrors } from './webviewTestHarness'

async function mountTodosPanel(page: Page, visible: boolean = true) {
  await page.evaluate((isVisible) => {
    document.querySelector('.welcome-container')?.remove()
    document.querySelector('#welcome-view')?.remove()

    const seedPanel = (panel: HTMLElement) => {
      panel.classList.toggle('hidden', !isVisible)
      panel.setAttribute('aria-label', 'Todos and changed files')

      const todosList = panel.querySelector('#todos-list')
      if (todosList) {
        todosList.innerHTML = `
          <ul class="todos-list">
            <li class="todo-item todo-item--pending">
              <div class="todo-checkbox" role="checkbox" aria-checked="false" aria-label="Todo: Implement feature X" tabindex="0"></div>
              <span class="todo-content">Implement feature X</span>
              <button class="todo-delete-btn" aria-label="Delete todo">×</button>
            </li>
            <li class="todo-item todo-item--completed">
              <div class="todo-checkbox todo-checkbox--checked" role="checkbox" aria-checked="true" aria-label="Todo: Fix bug Y" tabindex="0"></div>
              <span class="todo-content">Fix bug Y</span>
              <button class="todo-delete-btn" aria-label="Delete todo">×</button>
            </li>
          </ul>
        `
      }

      const changedFilesList = panel.querySelector('#changed-files-panel-list')
      if (changedFilesList) {
        changedFilesList.innerHTML = `
          <ul class="changed-files-list">
            <li class="changed-file-item">
              <span class="changed-file-name" title="src/example.ts">example.ts</span>
              <span class="changed-file-stats">
                <span class="changed-file-stat changed-file-stat--added">+5</span>
                <span class="changed-file-stat changed-file-stat--removed">-2</span>
              </span>
              <button class="changed-file-open-btn" aria-label="Open src/example.ts">Open</button>
            </li>
            <li class="changed-file-item">
              <span class="changed-file-name" title="src/utils.ts">utils.ts</span>
              <span class="changed-file-stats">
                <span class="changed-file-stat changed-file-stat--added">+10</span>
              </span>
              <button class="changed-file-open-btn" aria-label="Open src/utils.ts">Open</button>
            </li>
          </ul>
        `
      }
    }

    const host = document.querySelector('.tab-panel.active') || document.querySelector('.chat-main') || document.body
    let panel = document.getElementById('todos-panel')
    if (panel) {
      seedPanel(panel)
      return
    }

    panel = document.createElement('div')
    panel.id = 'todos-panel'
    panel.className = `todos-panel ${isVisible ? '' : 'hidden'}`
    panel.setAttribute('aria-label', 'Todos and changed files')
    panel.innerHTML = `
      <div class="todos-panel-header">
        <h2 class="todos-panel-title">Todos & Files</h2>
        <button class="icon-btn" id="close-todos-btn" title="Close panel" aria-label="Close todos panel">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="todos-panel-content">
        <div class="todos-section">
            <h3 class="todos-section-title">Todos</h3>
          <div id="todos-list"></div>
          <form class="todo-add-form" id="todo-add-form">
            <input type="text" class="todo-add-input" id="todo-add-input" placeholder="Add a task or reminder..." aria-label="New todo">
            <button type="submit" class="todo-add-btn">Add</button>
          </form>
        </div>
        <div class="todos-section">
          <h3 class="todos-section-title">Changed Files</h3>
          <div id="changed-files-panel-list"></div>
        </div>
      </div>
    `
    host.appendChild(panel)
    seedPanel(panel)
  }, visible)
}

test.describe('Todos and Changed Files Panel', () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
    await page.goto('/')
    await mountTodosPanel(page)
  })

  test.afterEach(async ({ page }) => {
    await expectNoWebviewErrors(page)
  })

  test('should render todos panel', async ({ page }) => {
    const panel = page.locator('#todos-panel')
    await expect(panel).toBeVisible()
    await expect(panel).toHaveAttribute('aria-label', 'Todos and changed files')
  })

  test('should have proper header', async ({ page }) => {
    const title = page.locator('.todos-panel-title')
    await expect(title).toHaveText('Todos & Files')
    
    const closeBtn = page.locator('#close-todos-btn')
    await expect(closeBtn).toBeVisible()
    await expect(closeBtn).toHaveAttribute('aria-label', 'Close todos panel')
  })

  test('should render todo items', async ({ page }) => {
    const todoItems = page.locator('.todo-item')
    await expect(todoItems).toHaveCount(2)
    
    const firstTodo = todoItems.nth(0)
    await expect(firstTodo.locator('.todo-content')).toHaveText('Implement feature X')
    await expect(firstTodo).not.toHaveClass(/todo-item--completed/)
    
    const secondTodo = todoItems.nth(1)
    await expect(secondTodo.locator('.todo-content')).toHaveText('Fix bug Y')
    await expect(secondTodo).toHaveClass(/todo-item--completed/)
  })

  test('should show completed todo styling', async ({ page }) => {
    const completedTodo = page.locator('.todo-item--completed')
    const content = completedTodo.locator('.todo-content')
    
    const textDecoration = await content.evaluate(el => 
      window.getComputedStyle(el).textDecoration
    )
    expect(textDecoration).toContain('line-through')
  })

  test('should render file change items', async ({ page }) => {
    const fileItems = page.locator('.changed-file-item')
    await expect(fileItems).toHaveCount(2)
    
    const firstFile = fileItems.nth(0)
    await expect(firstFile.locator('.changed-file-name')).toHaveText('example.ts')
    await expect(firstFile.locator('.changed-file-name')).toHaveAttribute('title', 'src/example.ts')
    await expect(firstFile.locator('.changed-file-stat--added')).toHaveText('+5')
    await expect(firstFile.locator('.changed-file-stat--removed')).toHaveText('-2')
  })

  test('should have add todo form', async ({ page }) => {
    const form = page.locator('#todo-add-form')
    await expect(form).toBeVisible()
    
    const input = page.locator('#todo-add-input')
    await expect(input).toBeVisible()
    await expect(input).toHaveAttribute('placeholder', 'Add a task or reminder...')
    
    const addBtn = form.locator('.todo-add-btn')
    await expect(addBtn).toHaveText('Add')
  })

  test('should hide panel when hidden class is applied', async ({ page }) => {
    await mountTodosPanel(page, false)
    
    const panel = page.locator('#todos-panel')
    await expect(panel).not.toBeVisible()
  })

  test('should show delete button on todo hover', async ({ page }) => {
    const todoItem = page.locator('.todo-item').nth(0)
    const deleteBtn = todoItem.locator('.todo-delete-btn')
    
    // Initially hidden (opacity: 0)
    const opacityBefore = await deleteBtn.evaluate(el => window.getComputedStyle(el).opacity)
    expect(opacityBefore).toBe('0')
    
    // Hover to show
    await todoItem.hover()
    await expect.poll(
      () => deleteBtn.evaluate(el => window.getComputedStyle(el).opacity),
      { timeout: 1000 }
    ).not.toBe('0')
  })

  test('should have proper section titles', async ({ page }) => {
    const todoTitle = page.locator('.todos-section-title').nth(0)
    await expect(todoTitle).toHaveText('Todos')
    
    const filesTitle = page.locator('.todos-section-title').nth(1)
    await expect(filesTitle).toHaveText('Changed Files')
  })
})
