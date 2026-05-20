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
    await expect(tagline).toHaveText('AI-powered coding assistant integrated into your editor')
  })

  test('should display suggestion cards', async ({ page }) => {
    await page.goto('/')

    const promptStarters = page.locator('.prompt-starters')
    await expect(promptStarters).toBeVisible()

    const cards = page.locator('.prompt-starter')
    await expect(cards).toHaveCount(4)

    const firstCard = cards.first()
    // Cards now use a short label + longer aria-label; verify the short label
    // shown to users and that the full prompt remains accessible via aria-label.
    await expect(firstCard.locator('.prompt-starter-label')).toContainText('Explain structure')
    await expect(firstCard).toHaveAttribute('aria-label', /Explain the current file structure/)
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
      
      // No horizontal scroll at any width.
      const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
      const clientWidth = await page.evaluate(() => document.body.clientWidth)
      expect(scrollWidth - clientWidth).toBeLessThanOrEqual(0)
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
      
      // No horizontal scroll at any width.
      const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
      const clientWidth = await page.evaluate(() => document.body.clientWidth)
      expect(scrollWidth - clientWidth).toBeLessThanOrEqual(0)
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

      // Roomy viewports show the keyboard hint
      const keyboardHint = page.locator('#keyboard-hint')
      await expect(keyboardHint).toBeVisible()

      // No horizontal scroll
      const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
      const clientWidth = await page.evaluate(() => document.body.clientWidth)
      expect(scrollWidth - clientWidth).toBeLessThanOrEqual(0)
    })

    test('should have no horizontal scroll at any width', async ({ page }) => {
      await page.goto('/')
      const widths = [280, 320, 400, 500, 600, 800, 1000]

      for (const width of widths) {
        await page.setViewportSize({ width, height: 600 })
        const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
        const clientWidth = await page.evaluate(() => document.body.clientWidth)
        expect(scrollWidth - clientWidth).toBeLessThanOrEqual(0)
      }
    })

    test('should collapse non-essential elements on short height', async ({ page }) => {
      await page.goto('/')
      await page.setViewportSize({ width: 400, height: 300 })

      const welcomeContainer = page.locator('.welcome-container')
      await expect(welcomeContainer).toHaveClass(/welcome-short/)

      const tagline = page.locator('.welcome-tagline')
      await expect(tagline).not.toBeVisible()

      const keyboardHint = page.locator('#keyboard-hint')
      await expect(keyboardHint).not.toBeVisible()
    })

    test('should display correctly at bottom panel short height (1200px x 250px)', async ({ page }) => {
      await page.goto('/')
      await page.setViewportSize({ width: 1200, height: 250 })
      
      const welcomeContainer = page.locator('.welcome-container')
      await expect(welcomeContainer).toBeVisible()
      
      // No horizontal scroll at any width.
      const scrollWidth = await page.evaluate(() => document.body.scrollWidth)
      const clientWidth = await page.evaluate(() => document.body.clientWidth)
      expect(scrollWidth - clientWidth).toBeLessThanOrEqual(0)
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

      const promptStartersSection = page.locator('.prompt-starters-section')
      await expect(promptStartersSection).toHaveAttribute('aria-label', 'Suggested prompts')
    })

    test('session search renders as a single visible input', async ({ page }) => {
      await page.goto('/')
      await page.setViewportSize({ width: 400, height: 600 })

      const inputWrapper = page.locator('#welcome-search-input')
      const innerInput = inputWrapper.locator('input')

      await expect(inputWrapper).not.toHaveClass(/hidden/)
      await expect(innerInput).toBeVisible()
    })

    test('Escape key clears session search without hiding the input', async ({ page }) => {
      await page.goto('/')
      await page.setViewportSize({ width: 400, height: 600 })

      const inputWrapper = page.locator('#welcome-search-input')
      const innerInput = inputWrapper.locator('input')

      await innerInput.fill('search text')
      await innerInput.press('Escape')

      await expect(inputWrapper).not.toHaveClass(/hidden/)
      await expect(innerInput).toHaveValue('')
    })

    test('session search input is focusable directly', async ({ page }) => {
      await page.goto('/')
      await page.setViewportSize({ width: 400, height: 600 })

      const innerInput = page.locator('#welcome-search-input input')

      await innerInput.focus()
      await expect(innerInput).toBeFocused()
    })
  })
})
