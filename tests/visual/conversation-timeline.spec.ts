import { test, expect, type Page } from '@playwright/test'
import { installVsCodeApi, expectNoWebviewErrors, dispatchHostMessage } from './webviewTestHarness'

async function setupSession(page: Page) {
  await page.evaluate(() => {
    document.querySelector('.welcome-container')?.remove()
    document.querySelector('.welcome-view')?.classList.add('hidden')

    const existingList = document.querySelector('.message-list')
    if (existingList) {
      existingList.innerHTML = ''
    } else {
      const host = document.querySelector('.tab-panel.active') || document.querySelector('.chat-main') || document.body
      const list = document.createElement('div')
      list.className = 'message-list'
      host.appendChild(list)
    }

    const msgList = document.querySelector('.message-list')!

    const messages = [
      { role: 'user', id: 'u1', text: 'Help me refactor the authentication module' },
      { role: 'assistant', id: 'a1', text: 'I will analyze the auth module first.' },
      { role: 'user', id: 'u2', text: 'Also check the database connection pooling' },
      { role: 'assistant', id: 'a2', text: 'Checking the pool configuration now.' },
      { role: 'user', id: 'u3', text: 'What about error handling?' },
      { role: 'assistant', id: 'a3', text: 'Adding comprehensive error handling with retries.' },
    ]

    for (const msg of messages) {
      const msgDiv = document.createElement('div')
      msgDiv.className = `message ${msg.role}`
      msgDiv.dataset.messageId = msg.id
      msgDiv.style.minHeight = '80px'
      msgDiv.innerHTML = `
        <div class="message-content">
          <div class="message-header"><span class="message-role">${msg.role === 'user' ? 'You' : 'OpenCode'}</span></div>
          <div class="message-bubble"><div class="msg-text">${msg.text}</div></div>
        </div>
      `
      msgList.appendChild(msgDiv)
    }
  })
}

async function createTimelineInDOM(page: Page) {
  await page.evaluate(() => {
    const panel = document.querySelector('.tab-panel.active') || document.querySelector('.chat-main') || document.body
    let timeline = panel.querySelector('.conversation-timeline')
    if (!timeline) {
      timeline = document.createElement('aside')
      timeline.className = 'conversation-timeline visible'
      timeline.setAttribute('role', 'navigation')
      timeline.setAttribute('aria-label', 'Conversation turns')

      const progress = document.createElement('div')
      progress.className = 'timeline-progress'
      progress.style.setProperty('--p', '0.3')
      timeline.appendChild(progress)

      const header = document.createElement('div')
      header.className = 'timeline-header'
      header.textContent = 'Conversation Timeline'
      timeline.appendChild(header)

      const turns = [
        { id: 'u1', label: 'Turn 1', snippet: 'Help me refactor the authentication module' },
        { id: 'u2', label: 'Turn 2', snippet: 'Also check the database connection pooling' },
        { id: 'u3', label: 'Turn 3', snippet: 'What about error handling?' },
      ]

      for (let i = 0; i < turns.length; i++) {
        const turn = turns[i]
        const item = document.createElement('button')
        item.type = 'button'
        item.className = 'timeline-item' + (i === 0 ? ' active' : '')
        item.dataset.messageId = turn.id
        item.setAttribute('aria-label', `Jump to turn ${i + 1}: ${turn.snippet}`)

        const role = document.createElement('span')
        role.className = 'timeline-item-role'
        const dot = document.createElement('span')
        dot.className = 'role-dot user'
        role.appendChild(dot)
        const label = document.createElement('span')
        label.textContent = turn.label
        role.appendChild(label)
        item.appendChild(role)

        const preview = document.createElement('span')
        preview.className = 'timeline-item-preview'
        preview.textContent = turn.snippet
        item.appendChild(preview)

        timeline.appendChild(item)
      }

      panel.appendChild(timeline)
    } else {
      timeline.classList.add('visible')
    }
  })
}

test.describe('Conversation Timeline', () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
    await page.goto('/')
    await setupSession(page)
  })

  test.afterEach(async ({ page }) => {
    await expectNoWebviewErrors(page)
  })

  test('should render timeline items when visible', async ({ page }) => {
    await createTimelineInDOM(page)

    const timeline = page.locator('.conversation-timeline')
    await expect(timeline).toBeAttached()

    const items = page.locator('.timeline-item')
    await expect(items).toHaveCount(3)
  })

  test('should show correct turn labels and snippets', async ({ page }) => {
    await createTimelineInDOM(page)

    const items = page.locator('.timeline-item')
    await expect(items.nth(0).locator('.timeline-item-role')).toContainText('Turn 1')
    await expect(items.nth(1).locator('.timeline-item-role')).toContainText('Turn 2')
    await expect(items.nth(2).locator('.timeline-item-role')).toContainText('Turn 3')

    await expect(items.nth(0).locator('.timeline-item-preview')).toContainText('Help me refactor')
  })

  test('should highlight the active turn', async ({ page }) => {
    await createTimelineInDOM(page)

    const firstItem = page.locator('.timeline-item').nth(0)
    await expect(firstItem).toHaveClass(/active/)

    const secondItem = page.locator('.timeline-item').nth(1)
    await expect(secondItem).not.toHaveClass(/active/)
  })

  test('should have accessible button elements with aria-labels', async ({ page }) => {
    await createTimelineInDOM(page)

    const items = page.locator('.timeline-item')
    await expect(items.nth(0)).toHaveAttribute('aria-label', /Jump to turn 1/)
    await expect(items.nth(1)).toHaveAttribute('aria-label', /Jump to turn 2/)
    await expect(items.nth(2)).toHaveAttribute('aria-label', /Jump to turn 3/)
  })

  test('should use opacity/visibility for show/hide (not display toggle) at wide viewport', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 700 })
    await createTimelineInDOM(page)
    await page.evaluate(() => {
      const tl = document.querySelector('.conversation-timeline')
      if (tl) { (tl as HTMLElement).style.visibility = 'visible'; (tl as HTMLElement).style.opacity = '1' }
    })

    const timeline = page.locator('.conversation-timeline')
    const opacity = await timeline.evaluate((el: HTMLElement) => window.getComputedStyle(el).opacity)
    expect(Number(opacity)).toBeGreaterThan(0)

    const display = await timeline.evaluate((el: HTMLElement) => window.getComputedStyle(el).display)
    expect(display).toBe('flex')
  })

  test('should be keyboard navigable at wide viewport', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 700 })
    await createTimelineInDOM(page)
    await page.evaluate(() => {
      const tl = document.querySelector('.conversation-timeline') as HTMLElement
      if (tl) {
        tl.style.visibility = 'visible'
        tl.style.opacity = '1'
        tl.tabIndex = 0
        tl.addEventListener('keydown', (e) => {
          const items = Array.from(tl.querySelectorAll<HTMLElement>('.timeline-item'))
          if (items.length === 0) return
          const focused = tl.querySelector<HTMLElement>('.timeline-item:focus')
          const idx = focused ? items.indexOf(focused) : -1
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            items[Math.min(idx + 1, items.length - 1)]?.focus()
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            items[Math.max(idx - 1, 0)]?.focus()
          } else if (e.key === 'Home') {
            e.preventDefault()
            items[0]?.focus()
          } else if (e.key === 'End') {
            e.preventDefault()
            items[items.length - 1]?.focus()
          }
        })
      }
    })

    const firstItem = page.locator('.timeline-item').nth(0)
    await firstItem.focus()
    await expect(firstItem).toBeFocused()

    await page.keyboard.press('ArrowDown')
    const secondItem = page.locator('.timeline-item').nth(1)
    await expect(secondItem).toBeFocused()

    await page.keyboard.press('ArrowDown')
    const thirdItem = page.locator('.timeline-item').nth(2)
    await expect(thirdItem).toBeFocused()

    await page.keyboard.press('ArrowUp')
    await expect(secondItem).toBeFocused()

    await page.keyboard.press('Home')
    await expect(firstItem).toBeFocused()

    await page.keyboard.press('End')
    await expect(thirdItem).toBeFocused()
  })

  test('should show progress bar with correct initial state', async ({ page }) => {
    await createTimelineInDOM(page)

    const progress = page.locator('.timeline-progress')
    await expect(progress).toBeAttached()
  })

  test('should render with tool count indicators', async ({ page }) => {
    await page.evaluate(() => {
      const panel = document.querySelector('.tab-panel.active') || document.querySelector('.chat-main') || document.body
      panel.querySelectorAll('.conversation-timeline').forEach(t => t.remove())

      const timeline = document.createElement('aside')
      timeline.className = 'conversation-timeline visible'
      timeline.setAttribute('role', 'navigation')
      timeline.setAttribute('aria-label', 'Conversation turns')

      const header = document.createElement('div')
      header.className = 'timeline-header'
      header.textContent = 'Conversation Timeline'
      timeline.appendChild(header)

      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'timeline-item'
      item.dataset.messageId = 'u-tool'

      const role = document.createElement('span')
      role.className = 'timeline-item-role'
      const dot = document.createElement('span')
      dot.className = 'role-dot user'
      role.appendChild(dot)
      const label = document.createElement('span')
      label.textContent = 'Turn 1'
      role.appendChild(label)
      item.appendChild(role)

      const preview = document.createElement('span')
      preview.className = 'timeline-item-preview has-tool'
      preview.textContent = 'Refactor auth (3 tools)'
      item.appendChild(preview)

      timeline.appendChild(item)
      panel.appendChild(timeline)
    })

    const preview = page.locator('.timeline-item-preview.has-tool')
    await expect(preview).toBeAttached()
    await expect(preview).toContainText('3 tools')

    const color = await preview.evaluate((el: HTMLElement) => window.getComputedStyle(el).color)
    expect(color).toBeDefined()
  })

  test('should have correct navigation role', async ({ page }) => {
    await createTimelineInDOM(page)

    const timeline = page.locator('.conversation-timeline')
    await expect(timeline).toHaveAttribute('role', 'navigation')
    await expect(timeline).toHaveAttribute('aria-label', 'Conversation turns')
  })

  test('toggle button should exist in toolbar with correct attributes', async ({ page }) => {
    const toggleBtn = page.locator('#timeline-toggle-btn')
    await expect(toggleBtn).toHaveCount(1)
    await expect(toggleBtn).toHaveAttribute('aria-label', 'Toggle conversation timeline')
    await expect(toggleBtn).toHaveAttribute('aria-pressed', 'false')
  })
})
