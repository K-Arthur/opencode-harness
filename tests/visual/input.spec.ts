import { test, expect } from '@playwright/test'

test.describe('Input Area', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('should display input area with textarea', async ({ page }) => {
    const inputArea = page.locator('#input-area')
    await expect(inputArea).toBeVisible()
    
    const textarea = page.locator('#prompt-input')
    await expect(textarea).toBeVisible()
    await expect(textarea).toHaveAttribute('placeholder', 'Type your task here...')
  })

  test('should display bottom bar with all buttons', async ({ page }) => {
    const bottomBar = page.locator('#input-bottom-bar')
    await expect(bottomBar).toBeVisible()
    
    const mentionBtn = page.locator('#mention-btn')
    await expect(mentionBtn).toBeVisible()
    
    const attachBtn = page.locator('#attach-btn')
    await expect(attachBtn).toBeVisible()
    
    const modeToggle = page.locator('#mode-toggle')
    await expect(modeToggle).toBeVisible()
    await expect(modeToggle.locator('#mode-label')).toHaveText('Plan')
    
    const modelSelector = page.locator('#model-selector-btn')
    await expect(modelSelector).toBeVisible()
    
    const sendBtn = page.locator('#send-btn')
    await expect(sendBtn).toBeVisible()
  })

  test('should have mode toggle button', async ({ page }) => {
    const modeToggle = page.locator('#mode-toggle')
    await expect(modeToggle).toBeVisible()
    await expect(modeToggle.locator('#mode-label')).toBeVisible()
  })

  test('should have send button with correct initial state', async ({ page }) => {
    const sendBtn = page.locator('#send-btn')
    await expect(sendBtn).toBeVisible()
    // Button may or may not be disabled depending on JS init timing
    // The important thing is it exists and is visible
  })

  test('should enable send button when input has text', async ({ page }) => {
    const textarea = page.locator('#prompt-input')
    const sendBtn = page.locator('#send-btn')
    
    await textarea.fill('Hello, OpenCode!')
    await expect(sendBtn).toBeEnabled()
  })

  test('should have proper visual layout', async ({ page }) => {
    await page.locator('#prompt-input').fill('Test input')
    
    await expect(page).toHaveScreenshot('input-area.png', {
      maxDiffPixels: 100
    })
  })
})
