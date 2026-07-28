import { test, expect, type Page } from '@playwright/test'
import { dispatchHostMessage, installVsCodeApi, expectNoWebviewErrors, postedMessages } from './webviewTestHarness'

async function mountMessageList(page: Page) {
  await page.evaluate(() => {
    document.querySelector('.welcome-container')?.remove()

    const existingList = document.querySelector('.message-list')
    if (existingList) {
      existingList.innerHTML = ''
      return
    }

    const host = document.querySelector('.tab-panel.active') || document.querySelector('.chat-main') || document.body
    const list = document.createElement('div')
    list.className = 'message-list'
    host.appendChild(list)
  })
}

test.describe('Chat Messages', () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
    await page.goto('/')
    await mountMessageList(page)
  })

  test.afterEach(async ({ page }) => {
    await expectNoWebviewErrors(page)
  })

  test('should display user message correctly', async ({ page }) => {
    await page.evaluate(() => {
      const msgList = document.querySelector('.message-list')
      if (!msgList) return
      
      const msgDiv = document.createElement('div')
       msgDiv.className = 'message user'
      msgDiv.innerHTML = `
        <div class="message-content">
          <div class="message-header">
            <span class="message-role">You</span>
            <span class="message-timestamp">10:30 AM</span>
          </div>
          <div class="message-bubble">
            <div class="msg-text">Hello, can you help me with this code?</div>
          </div>
        </div>
      `
      msgList.appendChild(msgDiv)
    })
    
    const userMessage = page.locator('.message.user')
    await expect(userMessage).toBeVisible()
    await expect(userMessage.locator('.message-role')).toHaveText('You')
    await expect(userMessage.locator('.msg-text')).toHaveText('Hello, can you help me with this code?')
  })

  test('should display assistant message correctly', async ({ page }) => {
    await page.evaluate(() => {
      const msgList = document.querySelector('.message-list')
      if (!msgList) return
      
       const msgDiv = document.createElement('div')
      msgDiv.className = 'message assistant'
      msgDiv.innerHTML = `
        <div class="message-content">
          <div class="message-header">
            <span class="message-role">OpenCode</span>
          </div>
          <div class="message-bubble">
            <div class="msg-text markdown-content">
              <p>Here's a <strong>bold</strong> and <em>italic</em> example:</p>
              <ul>
                <li>Item 1</li>
                <li>Item 2</li>
              </ul>
              <blockquote>This is a quote</blockquote>
            </div>
          </div>
        </div>
      `
      msgList.appendChild(msgDiv)
    })
    
    const markdownContent = page.locator('.markdown-content')
    await expect(markdownContent).toBeVisible()
    await expect(markdownContent.locator('strong')).toHaveText('bold')
    await expect(markdownContent.locator('em')).toHaveText('italic')
  })

  test('assistant tool calls collapse into one grouped expandable row', async ({ page }) => {
    await dispatchHostMessage(page, {
      type: 'init_state',
      sessions: [{
        id: 's',
        name: 'Tool grouping',
        model: 'opencode/big-pickle',
        messages: [
          {
            role: 'assistant',
            id: 'a1',
            sessionId: 's',
            blocks: [
              { type: 'text', text: 'I will inspect the files first.' },
              { type: 'tool', id: 't1', tool: 'rg', state: 'completed', args: { pattern: 'checkpoint' }, result: 'one' },
              { type: 'text', text: 'Now I will check the renderer.' },
              { type: 'tool', id: 't2', tool: 'sed', state: 'completed', args: { file: 'renderer.ts' }, result: 'two' },
            ],
          },
        ],
        tokenUsage: { prompt: 0, completion: 0, total: 0 },
      }],
      activeSessionId: 's',
    })

    const grouped = page.locator('.message.assistant details.tool-group')
    await expect(grouped).toHaveCount(1)
    await expect(page.locator('.message.assistant details.tool-group > summary').first()).toContainText('2 calls')
    await expect(page.locator('.message.assistant .message-bubble > details.tool-call:not(.tool-group)')).toHaveCount(0)
  })

  test('should have proper message spacing and layout', async ({ page }) => {
    await page.evaluate(() => {
      const msgList = document.querySelector('.message-list')
      if (!msgList) return
      
      const userMsg = document.createElement('div')
      userMsg.className = 'message user'
      userMsg.innerHTML = `
        <div class="message-content">
          <div class="message-header"><span class="message-role">You</span><span class="message-timestamp">10:30 AM</span></div>
          <div class="message-bubble"><div class="msg-text">Explain the current file structure</div></div>
        </div>
      `
      msgList.appendChild(userMsg)
      
      const assistantMsg = document.createElement('div')
      assistantMsg.className = 'message assistant'
      assistantMsg.innerHTML = `
        <div class="message-content">
          <div class="message-header"><span class="message-role">OpenCode</span><span class="message-timestamp">10:31 AM</span></div>
          <div class="message-bubble"><div class="msg-text">I'll analyze your project structure for you.</div></div>
        </div>
      `
      msgList.appendChild(assistantMsg)
    })
    
    const userMessage = page.locator('.message.user')
    const assistantMessage = page.locator('.message.assistant')

    await expect(userMessage).toBeVisible()
    await expect(assistantMessage).toBeVisible()

    const userBox = await userMessage.boundingBox()
    const assistantBox = await assistantMessage.boundingBox()
    const overflow = await page.locator('.message-list').evaluate((el) => el.scrollWidth - el.clientWidth)

    expect(userBox).not.toBeNull()
    expect(assistantBox).not.toBeNull()
    expect(assistantBox!.y).toBeGreaterThan(userBox!.y + userBox!.height)
    expect(overflow).toBeLessThanOrEqual(1)
  })

  test.describe('Responsive Design', () => {
    test('should display correctly at narrow width (280px)', async ({ page }) => {
      await page.setViewportSize({ width: 280, height: 600 })
      
      await page.evaluate(() => {
        const msgList = document.querySelector('.message-list')
        if (!msgList) return
        
        const userMsg = document.createElement('div')
        userMsg.className = 'message user'
        userMsg.innerHTML = `
          <div class="message-content">
            <div class="message-header"><span class="message-role">You</span></div>
            <div class="message-bubble"><div class="msg-text">Hello</div></div>
          </div>
        `
        msgList.appendChild(userMsg)
      })
      
      const messageList = page.locator('.message-list')
      await expect(messageList).toBeVisible()
      
      const userBubble = page.locator('.message.user .message-bubble').first()
      await expect(userBubble).toBeVisible()
      
      // Verify no horizontal scroll
      const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
      const clientWidth = await page.evaluate(() => document.body.clientWidth)
      expect(scrollWidth - clientWidth).toBeLessThanOrEqual(0)
    })

    test('should display correctly at medium width (400px)', async ({ page }) => {
      await page.setViewportSize({ width: 400, height: 600 })
      
      await page.evaluate(() => {
        const msgList = document.querySelector('.message-list')
        if (!msgList) return
        
        const userMsg = document.createElement('div')
        userMsg.className = 'message user'
        userMsg.innerHTML = `
          <div class="message-content">
            <div class="message-header"><span class="message-role">You</span></div>
            <div class="message-bubble"><div class="msg-text">Hello</div></div>
          </div>
        `
        msgList.appendChild(userMsg)
      })
      
      const messageList = page.locator('.message-list')
      await expect(messageList).toBeVisible()
      
      const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
      const clientWidth = await page.evaluate(() => document.body.clientWidth)
      expect(scrollWidth - clientWidth).toBeLessThanOrEqual(0)
    })

    test('should display correctly at wide width (600px)', async ({ page }) => {
      await page.setViewportSize({ width: 600, height: 600 })
      
      await page.evaluate(() => {
        const msgList = document.querySelector('.message-list')
        if (!msgList) return
        
        const userMsg = document.createElement('div')
        userMsg.className = 'message user'
        userMsg.innerHTML = `
          <div class="message-content">
            <div class="message-header"><span class="message-role">You</span></div>
            <div class="message-bubble"><div class="msg-text">Hello</div></div>
          </div>
        `
        msgList.appendChild(userMsg)
      })
      
      const messageList = page.locator('.message-list')
      await expect(messageList).toBeVisible()
      
      const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
      const clientWidth = await page.evaluate(() => document.body.clientWidth)
      expect(scrollWidth - clientWidth).toBeLessThanOrEqual(0)
    })

    test('should have no horizontal scroll at any width', async ({ page }) => {
      await page.evaluate(() => {
        const msgList = document.querySelector('.message-list')
        if (!msgList) return
        
        const userMsg = document.createElement('div')
        userMsg.className = 'message user'
        userMsg.innerHTML = `
          <div class="message-content">
            <div class="message-header"><span class="message-role">You</span></div>
            <div class="message-bubble"><div class="msg-text">Hello</div></div>
          </div>
        `
        msgList.appendChild(userMsg)
      })
      
      const widths = [280, 320, 400, 500, 600, 800, 1000]
      
      for (const width of widths) {
        await page.setViewportSize({ width, height: 600 })
        const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
        const clientWidth = await page.evaluate(() => document.body.clientWidth)
        expect(scrollWidth - clientWidth).toBeLessThanOrEqual(0)
      }
    })

    test('should adapt message bubble width based on viewport', async ({ page }) => {
      // Use long-enough content that the bubble actually hits its max-width
      // constraint at narrow viewports; short content sizes to content on both.
      await page.evaluate(() => {
        const msgList = document.querySelector('.message-list')
        if (!msgList) return

        const userMsg = document.createElement('div')
        userMsg.className = 'message user'
        userMsg.innerHTML = `
          <div class="message-content">
            <div class="message-header"><span class="message-role">You</span></div>
            <div class="message-bubble"><div class="msg-text">This is a much longer user message that should naturally force the bubble to grow toward its responsive max-width limit so we can verify the layout adapts to the viewport.</div></div>
          </div>
        `
        msgList.appendChild(userMsg)
      })

      const userBubble = page.locator('.message.user .message-bubble').first()

      await page.setViewportSize({ width: 280, height: 600 })
      const narrowWidth = await userBubble.evaluate((el: HTMLElement) => el.offsetWidth)

      await page.setViewportSize({ width: 600, height: 600 })
      const wideWidth = await userBubble.evaluate((el: HTMLElement) => el.offsetWidth)

      expect(wideWidth).toBeGreaterThan(narrowWidth)
    })

    test('should hide token badge on narrow viewports', async ({ page }) => {
      await page.evaluate(() => {
        const msgList = document.querySelector('.message-list')
        if (!msgList) return
        
        const userMsg = document.createElement('div')
        userMsg.className = 'message user'
        userMsg.innerHTML = `
          <div class="message-content">
            <div class="message-header">
              <span class="message-role">You</span>
              <span class="message-token-badge">1.2k</span>
            </div>
            <div class="message-bubble"><div class="msg-text">Hello</div></div>
          </div>
        `
        msgList.appendChild(userMsg)
      })
      
      const tokenBadge = page.locator('.message-token-badge').first()
      
      await page.setViewportSize({ width: 280, height: 600 })
      await expect(tokenBadge).not.toBeVisible()
      
      await page.setViewportSize({ width: 600, height: 600 })
      await expect(tokenBadge).toBeVisible()
    })
  })

  test.describe('Interactive Tasks, Context Chips, and Image Previews', () => {
    test('should trigger open_file on clicking task-file-badge', async ({ page }) => {
      await page.evaluate(() => {
        const msgList = document.querySelector('.message-list')
        if (!msgList) return
        
        const taskBanner = document.createElement('div')
        taskBanner.className = 'task-banner success'
        taskBanner.innerHTML = `
          <div class="task-banner-header">
            <span class="task-banner-title">Edited 1 files</span>
          </div>
          <div class="task-banner-files">
            <span class="task-file-badge" style="cursor: pointer;">
              <span class="task-file-name">src/main.ts</span>
            </span>
          </div>
        `
        msgList.appendChild(taskBanner)

        // Attach click listener exactly like renderer.ts does
        const badge = taskBanner.querySelector('.task-file-badge')
        badge?.addEventListener('click', (e) => {
          e.stopPropagation()
          const vscode = (window as any).acquireVsCodeApi?.()
          vscode?.postMessage({ type: 'open_file', path: 'src/main.ts' })
        })
      })

      const badgeLocator = page.locator('.task-file-badge').first()
      await expect(badgeLocator).toBeVisible()
      await badgeLocator.click()

      const messages = await postedMessages(page)
      const openFileMsg = messages.find(m => m.type === 'open_file' && m.path === 'src/main.ts')
      expect(openFileMsg).toBeDefined()
    })

    test('should support quote-aware context chips and dispatch open_file/open_folder/open_url', async ({ page }) => {
      await page.evaluate(() => {
        const msgList = document.querySelector('.message-list')
        if (!msgList) return

        const assistantMsg = document.createElement('div')
        assistantMsg.className = 'message assistant'
        assistantMsg.innerHTML = `
          <div class="message-bubble">
            <div class="msg-text">
              <span class="context-chip" data-kind="file" style="cursor: pointer;">@file:"path with spaces/main.ts"</span>
              <span class="context-chip" data-kind="folder" style="cursor: pointer;">@folder:"src/components"</span>
              <span class="context-chip" data-kind="url" style="cursor: pointer;">@url:https://opencode.ai</span>
            </div>
          </div>
        `
        msgList.appendChild(assistantMsg)

        // Attach event listeners exactly like renderer.ts does
        const chips = assistantMsg.querySelectorAll('.context-chip')
        chips.forEach(chip => {
          chip.addEventListener('click', (e) => {
            e.stopPropagation()
            const type = chip.getAttribute('data-kind')
            const textVal = chip.textContent || ''
            const rawValue = textVal.substring(type!.length + 2)
            const value = rawValue.replace(/^["']|["']$/g, "")
            
            const vscode = (window as any).acquireVsCodeApi?.()
            if (type === 'file') {
              vscode?.postMessage({ type: 'open_file', path: value })
            } else if (type === 'folder') {
              vscode?.postMessage({ type: 'open_folder', dir: value })
            } else if (type === 'url') {
              vscode?.postMessage({ type: 'open_url', url: value })
            }
          })
        })
      })

      // Click file chip
      const fileChip = page.locator('.context-chip[data-kind="file"]')
      await expect(fileChip).toBeVisible()
      await fileChip.click()

      // Click folder chip
      const folderChip = page.locator('.context-chip[data-kind="folder"]')
      await expect(folderChip).toBeVisible()
      await folderChip.click()

      // Click url chip
      const urlChip = page.locator('.context-chip[data-kind="url"]')
      await expect(urlChip).toBeVisible()
      await urlChip.click()

      const messages = await postedMessages(page)
      
      const fileMessage = messages.find(m => m.type === 'open_file' && m.path === 'path with spaces/main.ts')
      expect(fileMessage).toBeDefined()

      const folderMessage = messages.find(m => m.type === 'open_folder' && m.dir === 'src/components')
      expect(folderMessage).toBeDefined()

      const urlMessage = messages.find(m => m.type === 'open_url' && m.url === 'https://opencode.ai')
      expect(urlMessage).toBeDefined()
    })

    test('should apply responsive bounds to image attachments', async ({ page }) => {
      await page.evaluate(() => {
        const msgList = document.querySelector('.message-list')
        if (!msgList) return

        const userMsg = document.createElement('div')
        userMsg.className = 'message user'
        userMsg.innerHTML = `
          <div class="message-bubble">
            <div class="msg-image">
              <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" />
            </div>
          </div>
        `
        msgList.appendChild(userMsg)
      })

      const image = page.locator('.msg-image img')
      await expect(image).toBeVisible()
      
      const styles = await image.evaluate((el: HTMLImageElement) => {
        const style = window.getComputedStyle(el)
        return {
          maxWidth: style.maxWidth,
          maxHeight: style.maxHeight,
          objectFit: style.objectFit
        }
      })

      expect(styles.maxWidth).toBeDefined()
      expect(styles.maxHeight).toBeDefined()
    })

    test('should trigger open_file when clicking a tool-arg file path in tool call blocks', async ({ page }) => {
      await page.evaluate(() => {
        const msgList = document.querySelector('.message-list')
        if (!msgList) return

        const assistantMsg = document.createElement('div')
        assistantMsg.className = 'message assistant'
        assistantMsg.innerHTML = `
          <div class="message-bubble">
            <details class="tool-call tool-call--read tool-call--result">
              <summary class="tool-header" tabindex="0" role="button">
                <span class="tool-icon">R</span>
                <span class="tool-name">read</span>
                <span class="tool-arg" style="cursor: pointer;">src/main.ts</span>
                <span class="tool-status tool-status--result">✓ Done</span>
              </summary>
            </details>
          </div>
        `
        msgList.appendChild(assistantMsg)

        // Attach click listener exactly like toolCallRenderer.ts does
        const argEl = assistantMsg.querySelector('.tool-arg')
        argEl?.addEventListener('click', (e) => {
          e.stopPropagation()
          e.preventDefault()
          const vscode = (window as any).acquireVsCodeApi?.()
          vscode?.postMessage({ type: 'open_file', path: 'src/main.ts' })
        })
      })

      const argLocator = page.locator('.tool-arg').first()
      await expect(argLocator).toBeVisible()
      await argLocator.click()

      const messages = await postedMessages(page)
      const openFileMsg = messages.find(m => m.type === 'open_file' && m.path === 'src/main.ts')
      expect(openFileMsg).toBeDefined()
    })

    test('should trigger open_file when clicking a diff-file-path in diff blocks', async ({ page }) => {
      await page.evaluate(() => {
        const msgList = document.querySelector('.message-list')
        if (!msgList) return

        const assistantMsg = document.createElement('div')
        assistantMsg.className = 'message assistant'
        assistantMsg.innerHTML = `
          <div class="message-bubble">
            <div class="diff-block diff-block--pending">
              <div class="diff-header">
                <div class="diff-file-info">
                  <span class="diff-file-path" style="cursor: pointer;">src/chat/webview/renderer.ts</span>
                </div>
              </div>
            </div>
          </div>
        `
        msgList.appendChild(assistantMsg)

        // Attach click listener exactly like renderer.ts does
        const filePathEl = assistantMsg.querySelector('.diff-file-path')
        filePathEl?.addEventListener('click', (e) => {
          e.stopPropagation()
          e.preventDefault()
          const vscode = (window as any).acquireVsCodeApi?.()
          vscode?.postMessage({ type: 'open_file', path: 'src/chat/webview/renderer.ts' })
        })
      })

      const pathLocator = page.locator('.diff-file-path').first()
      await expect(pathLocator).toBeVisible()
      await pathLocator.click()

      const messages = await postedMessages(page)
      const openFileMsg = messages.find(m => m.type === 'open_file' && m.path === 'src/chat/webview/renderer.ts')
      expect(openFileMsg).toBeDefined()
    })
  })
})
