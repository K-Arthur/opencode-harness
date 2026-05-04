import { test, expect } from '@playwright/test'

test.describe('Messages', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('should display user message correctly', async ({ page }) => {
    await page.evaluate(() => {
      const msgList = document.querySelector('.message-list')
      if (!msgList) return
      
      const msgDiv = document.createElement('div')
      msgDiv.className = 'message user'
      msgDiv.innerHTML = `
        <div class="message-avatar">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>
        </div>
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
        <div class="message-avatar">
          <svg class="oc-logo" viewBox="0 0 480 600" width="16" height="16" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M0 0h480v600H0V0zm120 120h240v360H120V120z"/></svg>
        </div>
        <div class="message-content">
          <div class="message-header">
            <span class="message-role">OpenCode</span>
            <span class="message-timestamp">10:31 AM</span>
          </div>
          <div class="message-bubble">
            <div class="msg-text">Of course! I'd be happy to help.</div>
          </div>
        </div>
      `
      msgList.appendChild(msgDiv)
    })
    
    const assistantMessage = page.locator('.message.assistant')
    await expect(assistantMessage).toBeVisible()
    await expect(assistantMessage.locator('.message-role')).toHaveText('OpenCode')
  })

  test('should display tool card correctly', async ({ page }) => {
    await page.evaluate(() => {
      const msgList = document.querySelector('.message-list')
      if (!msgList) return
      
      const msgDiv = document.createElement('div')
      msgDiv.className = 'message system'
      msgDiv.innerHTML = `
        <div class="system-bubble">
          <div class="tool-card tool-read">
            <div class="tool-header">
              <span class="tool-icon">📖</span>
              <span class="tool-name">read_file</span>
              <span class="tool-args">src/main.ts</span>
              <span class="tool-expand-icon">▶</span>
            </div>
          </div>
        </div>
      `
      msgList.appendChild(msgDiv)
    })
    
    const toolCard = page.locator('.tool-card')
    await expect(toolCard).toBeVisible()
    await expect(toolCard.locator('.tool-name')).toHaveText('read_file')
  })

  test('should display skill badge correctly', async ({ page }) => {
    await page.evaluate(() => {
      const msgList = document.querySelector('.message-list')
      if (!msgList) return
      
      const msgDiv = document.createElement('div')
      msgDiv.className = 'message system'
      msgDiv.innerHTML = `
        <div class="system-bubble">
          <div class="skill-badge">
            <span class="skill-badge-icon">⚙</span>
            <span>frontend-design</span>
          </div>
        </div>
      `
      msgList.appendChild(msgDiv)
    })
    
    const skillBadge = page.locator('.skill-badge')
    await expect(skillBadge).toBeVisible()
    await expect(skillBadge).toContainText('frontend-design')
  })

  test('should display markdown content correctly', async ({ page }) => {
    await page.evaluate(() => {
      const msgList = document.querySelector('.message-list')
      if (!msgList) return
      
      const msgDiv = document.createElement('div')
      msgDiv.className = 'message assistant'
      msgDiv.innerHTML = `
        <div class="message-avatar">
          <svg class="oc-logo" viewBox="0 0 480 600" width="16" height="16" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M0 0h480v600H0V0zm120 120h240v360H120V120z"/></svg>
        </div>
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
        <div class="message-avatar"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg></div>
        <div class="message-content">
          <div class="message-header"><span class="message-role">You</span><span class="message-timestamp">10:30 AM</span></div>
          <div class="message-bubble"><div class="msg-text">Explain the current file structure</div></div>
        </div>
      `
      msgList.appendChild(userMsg)
      
      const assistantMsg = document.createElement('div')
      assistantMsg.className = 'message assistant'
      assistantMsg.innerHTML = `
        <div class="message-avatar"><svg class="oc-logo" viewBox="0 0 480 600" width="16" height="16" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M0 0h480v600H0V0zm120 120h240v360H120V120z"/></svg></div>
        <div class="message-content">
          <div class="message-header"><span class="message-role">OpenCode</span><span class="message-timestamp">10:31 AM</span></div>
          <div class="message-bubble"><div class="msg-text">I'll analyze your project structure for you.</div></div>
        </div>
      `
      msgList.appendChild(assistantMsg)
    })
    
    await expect(page).toHaveScreenshot('messages-layout.png', {
      maxDiffPixels: 100
    })
  })
})
