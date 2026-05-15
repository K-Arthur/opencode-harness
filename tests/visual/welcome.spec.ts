import { test, expect } from '@playwright/test'
import { installVsCodeApi, expectNoWebviewErrors } from './webviewTestHarness'

test.describe('Welcome Screen', () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
  })

  test.afterEach(async ({ page }) => {
    await expectNoWebviewErrors(page)
  })

  test('should display welcome screen with wordmark and heading', async ({ page }) => {
    await page.goto('/')
    
    const welcomeContainer = page.locator('.welcome-container')
    await expect(welcomeContainer).toBeVisible()
    
    const wordmark = page.locator('.welcome-wordmark')
    await expect(wordmark).toBeVisible()
    await expect(wordmark).toHaveAttribute('src', /opencode-wordmark-dark\.svg/)
    
    const tagline = page.locator('.welcome-tagline')
    await expect(tagline).toHaveText('Your intelligent coding assistant')
  })

  test('should display suggestion cards', async ({ page }) => {
    await page.goto('/')
    
    const promptStarters = page.locator('.prompt-starters')
    await expect(promptStarters).toBeVisible()
    
    const cards = page.locator('.prompt-starter')
    await expect(cards).toHaveCount(4)
    
    const firstCard = cards.first()
    await expect(firstCard.locator('.prompt-starter-label')).toContainText('Explain the current file structure')
  })

  test('should hide empty recent sessions section', async ({ page }) => {
    await page.goto('/')
    
    const recentSection = page.locator('.recent-sessions')
    await expect(recentSection).toBeHidden()
  })

  test('should have proper visual layout', async ({ page }) => {
    await page.goto('/')

    const welcome = page.locator('.welcome-container')
    const starters = page.locator('.prompt-starters')
    const input = page.locator('#input-area')

    const welcomeBox = await welcome.boundingBox()
    const startersBox = await starters.boundingBox()
    const inputBox = await input.boundingBox()
    const overflow = await page.locator('#app').evaluate((el) => el.scrollWidth - el.clientWidth)

    expect(welcomeBox).not.toBeNull()
    expect(startersBox).not.toBeNull()
    expect(inputBox).not.toBeNull()
    expect(startersBox!.y).toBeGreaterThan(welcomeBox!.y)
    expect(inputBox!.y).toBeGreaterThan(startersBox!.y)
    expect(overflow).toBeLessThanOrEqual(1)
  })

  test.describe('Responsive Design', () => {
    test('should display correctly at narrow width (280px)', async ({ page }) => {
      await page.goto('/')
      await page.setViewportSize({ width: 280, height: 600 })
      
      const welcomeContainer = page.locator('.welcome-container')
      await expect(welcomeContainer).toBeVisible()
      
      const wordmark = page.locator('.welcome-wordmark')
      await expect(wordmark).toBeVisible()
      
      const greeting = page.locator('#welcome-greeting')
      await expect(greeting).toBeVisible()
      
      // Verify no horizontal scroll
      const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
      const clientWidth = await page.evaluate(() => document.body.clientWidth)
      expect(scrollWidth).toBe(clientWidth)
    })

    test('should display correctly at medium width (400px)', async ({ page }) => {
      await page.goto('/')
      await page.setViewportSize({ width: 400, height: 600 })
      
      const welcomeContainer = page.locator('.welcome-container')
      await expect(welcomeContainer).toBeVisible()
      
      const wordmark = page.locator('.welcome-wordmark')
      await expect(wordmark).toBeVisible()
      
      const greeting = page.locator('#welcome-greeting')
      await expect(greeting).toBeVisible()
      
      // Verify no horizontal scroll
      const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
      const clientWidth = await page.evaluate(() => document.body.clientWidth)
      expect(scrollWidth).toBe(clientWidth)
    })

    test('should display correctly at wide width (600px)', async ({ page }) => {
      await page.goto('/')
      await page.setViewportSize({ width: 600, height: 600 })
      
      const welcomeContainer = page.locator('.welcome-container')
      await expect(welcomeContainer).toBeVisible()
      
      const wordmark = page.locator('.welcome-wordmark')
      await expect(wordmark).toBeVisible()
      
      const greeting = page.locator('#welcome-greeting')
      await expect(greeting).toBeVisible()
      
      const keyboardHint = page.locator('#keyboard-hint')
      await expect(keyboardHint).toBeVisible()
      
      // Verify no horizontal scroll
      const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
      const clientWidth = await page.evaluate(() => document.body.clientWidth)
      expect(scrollWidth).toBe(clientWidth)
    })

    test('should have no horizontal scroll at any width', async ({ page }) => {
      await page.goto('/')
      const widths = [280, 320, 400, 500, 600, 800, 1000]
      
      for (const width of widths) {
        await page.setViewportSize({ width, height: 600 })
        const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
        const clientWidth = await page.evaluate(() => document.body.clientWidth)
        expect(scrollWidth).toBe(clientWidth)
      }
    })

    test('should collapse non-essential elements on short height', async ({ page }) => {
      await page.goto('/')
      await page.setViewportSize({ width: 400, height: 300 })
      
      const welcomeContainer = page.locator('.welcome-container')
      await expect(welcomeContainer).toHaveClass(/welcome-short/)
      
      // Tagline should be hidden on short height
      const tagline = page.locator('.welcome-tagline')
      await expect(tagline).not.toBeVisible()
      
      // Keyboard hint should be hidden on short height
      const keyboardHint = page.locator('#keyboard-hint')
      await expect(keyboardHint).not.toBeVisible()
    })

    test('should display correctly at bottom panel short height (1200px x 250px)', async ({ page }) => {
      await page.goto('/')
      await page.setViewportSize({ width: 1200, height: 250 })
      
      const welcomeContainer = page.locator('.welcome-container')
      await expect(welcomeContainer).toBeVisible()
      
      // Verify no horizontal scroll
      const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
      const clientWidth = await page.evaluate(() => document.body.clientWidth)
      expect(scrollWidth).toBe(clientWidth)
    })

    test('search toggle should expand input', async ({ page }) => {
      await page.goto('/')
      await page.setViewportSize({ width: 400, height: 600 })
      
      const toggle = page.locator('#welcome-search-toggle')
      const input = page.locator('#welcome-search-input')
      
      await expect(input).toHaveClass(/hidden/)
      
      await toggle.click()
      await expect(input).not.toHaveClass(/hidden/)
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    })

    test('quick settings toggle should expand panel', async ({ page }) => {
      await page.goto('/')
      await page.setViewportSize({ width: 400, height: 600 })
      
      const toggle = page.locator('#settings-toggle')
      const panel = page.locator('#settings-panel')
      
      await expect(panel).toHaveClass(/hidden/)
      
      await toggle.click()
      await expect(panel).not.toHaveClass(/hidden/)
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
      
      // Verify quick settings content is rendered
      const quickSettingsContent = page.locator('#quick-settings-content')
      await expect(quickSettingsContent).toBeVisible()
      
      // Verify mode selector is rendered
      const modeSelect = page.locator('#quick-setting-mode')
      await expect(modeSelect).toBeVisible()
    })

    test('time-based greeting should display correctly', async ({ page }) => {
      await page.goto('/')
      
      const greeting = page.locator('#welcome-greeting')
      await expect(greeting).toBeVisible()
      const text = await greeting.textContent()
      expect(text).toMatch(/Good (morning|afternoon|evening)/)
    })

    test('should have proper ARIA attributes for accessibility', async ({ page }) => {
      await page.goto('/')
      
      const welcomeView = page.locator('#welcome-view')
      await expect(welcomeView).toHaveAttribute('role', 'region')
      await expect(welcomeView).toHaveAttribute('aria-label', 'OpenCode welcome')
      
      const searchToggle = page.locator('#welcome-search-toggle')
      await expect(searchToggle).toHaveAttribute('aria-expanded')
      await expect(searchToggle).toHaveAttribute('aria-controls', 'welcome-search-input')
      
      const settingsToggle = page.locator('#settings-toggle')
      await expect(settingsToggle).toHaveAttribute('aria-expanded')
      await expect(settingsToggle).toHaveAttribute('aria-controls', 'settings-panel')
      
      const promptStartersSection = page.locator('.prompt-starters-section')
      await expect(promptStartersSection).toHaveAttribute('aria-label', 'Suggested prompts')
    })
  })
})
