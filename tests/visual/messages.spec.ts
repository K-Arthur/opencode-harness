import { test, expect, type Page } from '@playwright/test'
import { installVsCodeApi, expectNoWebviewErrors } from './webviewTestHarness'

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
      expect(scrollWidth).toBe(clientWidth)
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
      expect(scrollWidth).toBe(clientWidth)
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
      expect(scrollWidth).toBe(clientWidth)
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
        expect(scrollWidth).toBe(clientWidth)
      }
    })

    test('should adapt message bubble width based on viewport', async ({ page }) => {
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
})
