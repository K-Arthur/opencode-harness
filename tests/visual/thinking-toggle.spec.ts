import { test, expect, type Page } from '@playwright/test'
import { installVsCodeApi, expectNoWebviewErrors } from './webviewTestHarness'

async function mountThinkingBlock(page: Page, collapsed: boolean = false) {
  await page.evaluate((isCollapsed) => {
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

    const thinkingBlock = document.createElement('details')
    thinkingBlock.className = 'thinking-block'
    thinkingBlock.open = !isCollapsed
    thinkingBlock.innerHTML = `
      <summary class="thinking-header">
        <span class="thinking-label">Reasoning (250 tokens)</span>
        <span class="thinking-toggle">▶</span>
      </summary>
      <div class="thinking-body">
        <p>Let me analyze this problem step by step.</p>
        <p>First, I need to understand the requirements.</p>
        <p>Then I'll implement the solution.</p>
      </div>
    `
    list.appendChild(thinkingBlock)
  }, collapsed)
}

test.describe('Global Show/Hide Thinking Toggle', () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
    await page.goto('/')
    await mountThinkingBlock(page)
    // The toggle lives inside the settings menu (hidden by default).
    await page.locator('#settings-btn').click()
  })

  test.afterEach(async ({ page }) => {
    await expectNoWebviewErrors(page)
  })

  test('should render thinking toggle item in settings menu', async ({ page }) => {
    const toggleBtn = page.locator('#thinking-toggle-menu-item')
    await expect(toggleBtn).toBeVisible()
    await expect(toggleBtn).toHaveAttribute('aria-label', 'Show thinking blocks')
  })

  test('should toggle thinking block visibility on click', async ({ page }) => {
    const toggleBtn = page.locator('#thinking-toggle-menu-item')
    const thinkingBlock = page.locator('.thinking-block')
    const thinkingBody = page.locator('.thinking-body')

    // Initial state - thinking should be visible
    await expect(thinkingBlock).toHaveAttribute('open', '')
    await expect(thinkingBody).toBeVisible()

    // Click to hide thinking
    await toggleBtn.click()
    await expect(thinkingBlock).not.toHaveAttribute('open')
    await expect(thinkingBody).not.toBeVisible()

    // Click to show thinking
    await toggleBtn.click()
    await expect(thinkingBlock).toHaveAttribute('open', '')
    await expect(thinkingBody).toBeVisible()
  })

  test('should update aria-checked state', async ({ page }) => {
    const toggleBtn = page.locator('#thinking-toggle-menu-item')

    // Initial state should be checked (visible by default)
    await expect(toggleBtn).toHaveAttribute('aria-checked', 'true')

    await toggleBtn.click()
    await expect(toggleBtn).toHaveAttribute('aria-checked', 'false')

    await toggleBtn.click()
    await expect(toggleBtn).toHaveAttribute('aria-checked', 'true')
  })

  test('should toggle active class on button', async ({ page }) => {
    const toggleBtn = page.locator('#thinking-toggle-menu-item')

    // Initial state should have active class
    await expect(toggleBtn).toHaveClass(/active/)

    await toggleBtn.click()
    await expect(toggleBtn).not.toHaveClass(/active/)

    await toggleBtn.click()
    await expect(toggleBtn).toHaveClass(/active/)
  })

  test('should apply collapsed class to all thinking blocks', async ({ page }) => {
    // Add multiple thinking blocks
    await page.evaluate(() => {
      const list = document.querySelector('.message-list')
      if (!list) return

      for (let i = 0; i < 3; i++) {
        const block = document.createElement('details')
        block.className = 'thinking-block'
        block.open = true
        block.innerHTML = `
          <summary class="thinking-header">
            <span class="thinking-label">Reasoning (${i + 1})</span>
          </summary>
          <div class="thinking-body">
            <p>Thinking content ${i + 1}</p>
          </div>
        `
        list.appendChild(block)
      }
    })

    const toggleBtn = page.locator('#thinking-toggle-menu-item')
    const thinkingBlocks = page.locator('.thinking-block')

    // All blocks should be visible initially
    await expect(thinkingBlocks).toHaveCount(4) // 1 initial + 3 new
    await expect(thinkingBlocks.nth(0)).toHaveAttribute('open', '')
    await expect(thinkingBlocks.nth(1)).toHaveAttribute('open', '')
    await expect(thinkingBlocks.nth(2)).toHaveAttribute('open', '')
    await expect(thinkingBlocks.nth(3)).toHaveAttribute('open', '')

    // Toggle to hide
    await toggleBtn.click()
    await expect(thinkingBlocks.nth(0)).not.toHaveAttribute('open')
    await expect(thinkingBlocks.nth(1)).not.toHaveAttribute('open')
    await expect(thinkingBlocks.nth(2)).not.toHaveAttribute('open')
    await expect(thinkingBlocks.nth(3)).not.toHaveAttribute('open')
  })

  test('should respect individual block open state when expanding', async ({ page }) => {
    // Create thinking blocks with different initial states
    await page.evaluate(() => {
      const list = document.querySelector('.message-list')
      if (!list) return

      const block1 = document.createElement('details')
      block1.className = 'thinking-block'
      block1.open = true
      block1.innerHTML = `
        <summary class="thinking-header"><span class="thinking-label">Block 1</span></summary>
        <div class="thinking-body"><p>Content 1</p></div>
      `
      list.appendChild(block1)

      const block2 = document.createElement('details')
      block2.className = 'thinking-block'
      block2.open = false
      block2.innerHTML = `
        <summary class="thinking-header"><span class="thinking-label">Block 2</span></summary>
        <div class="thinking-body"><p>Content 2</p></div>
      `
      list.appendChild(block2)
    })

    const toggleBtn = page.locator('#thinking-toggle-menu-item')
    const block1 = page.locator('.thinking-block').nth(0)
    const block2 = page.locator('.thinking-block').nth(1)

    // Initial states
    await expect(block1).toHaveAttribute('open', '')
    await expect(block2).not.toHaveAttribute('open')

    // Collapse all
    await toggleBtn.click()
    await expect(block1).not.toHaveAttribute('open')
    await expect(block2).not.toHaveAttribute('open')

    // Expand all - should open both blocks
    await toggleBtn.click()
    await expect(block1).toHaveAttribute('open', '')
    await expect(block2).toHaveAttribute('open', '')
  })

  test('should have smooth transition for expand/collapse', async ({ page }) => {
    const thinkingBody = page.locator('.thinking-body')
    
    // Check that transition is applied
    const transition = await thinkingBody.evaluate(el => 
      window.getComputedStyle(el).transition
    )
    expect(transition).toContain('max-height')
    expect(transition).toContain('opacity')
  })
})
