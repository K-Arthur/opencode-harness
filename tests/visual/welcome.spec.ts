import { test, expect } from '@playwright/test'

test.describe('Welcome Screen', () => {
  test('should display welcome screen with wordmark and heading', async ({ page }) => {
    await page.goto('/')
    
    const welcomeContainer = page.locator('.welcome-container')
    await expect(welcomeContainer).toBeVisible()
    
    const wordmark = page.locator('.welcome-wordmark')
    await expect(wordmark).toBeVisible()
    await expect(wordmark).toHaveAttribute('src', /opencode-wordmark-dark\.svg/)
    
    const heading = page.locator('.welcome-header h2')
    await expect(heading).toHaveText('What can I do for you?')
  })

  test('should display suggestion cards', async ({ page }) => {
    await page.goto('/')
    
    const suggestionsGrid = page.locator('.suggestions-grid')
    await expect(suggestionsGrid).toBeVisible()
    
    const cards = page.locator('.suggestion-card')
    await expect(cards).toHaveCount(4)
    
    const firstCard = cards.first()
    await expect(firstCard.locator('.suggestion-text')).toContainText('Explain the current file structure')
  })

  test('should hide empty recent sessions section', async ({ page }) => {
    await page.goto('/')
    
    const recentSection = page.locator('.recent-sessions')
    await expect(recentSection).toBeHidden()
  })

  test('should have proper visual layout', async ({ page }) => {
    await page.goto('/')
    
    await expect(page).toHaveScreenshot('welcome-screen.png', {
      fullPage: true,
      maxDiffPixels: 100
    })
  })
})
