import { test, expect } from '@playwright/test'

test.describe('Welcome Screen', () => {
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
})
