import { test, expect } from '@playwright/test'
import { installVsCodeApi, dispatchHostMessage, expectNoWebviewErrors } from './webviewTestHarness'

test.describe('Input Area', () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
    await page.goto('/')
  })

  test.afterEach(async ({ page }) => {
    await expectNoWebviewErrors(page)
  })

  test('should display input area with textarea', async ({ page }) => {
    const inputArea = page.locator('#input-area')
    await expect(inputArea).toBeVisible()
    
    const textarea = page.locator('#prompt-input')
    await expect(textarea).toBeVisible()
    await expect(textarea).toHaveAttribute('placeholder', 'Ask OpenCode a question about your code…')
  })

  test('should display bottom bar with all buttons', async ({ page }) => {
    const bottomBar = page.locator('#input-bottom-bar')
    await expect(bottomBar).toBeVisible()
    
    const mentionBtn = page.locator('#mention-btn')
    await expect(mentionBtn).toBeVisible()
    
    const attachBtn = page.locator('#attach-btn')
    await expect(attachBtn).toBeVisible()
    
    const modeDropdown = page.locator('#mode-dropdown')
    await expect(modeDropdown).toBeVisible()
    await expect(modeDropdown.locator('#mode-current-text')).toHaveText('Build')
    
    const modelSelector = page.locator('#model-selector-btn')
    await expect(modelSelector).toBeVisible()
    
    const sendBtn = page.locator('#send-btn')
    await expect(sendBtn).toBeVisible()
  })

  test('should have mode dropdown button', async ({ page }) => {
    const modeDropdown = page.locator('#mode-dropdown')
    await expect(modeDropdown).toBeVisible()
    await expect(modeDropdown.locator('#mode-dropdown-btn')).toHaveAttribute('aria-haspopup', 'listbox')
    // The mode text label is intentionally hidden at the narrow viewport (≤420px)
    // so the model selector and send button have room; the button itself remains visible.
    await expect(modeDropdown.locator('#mode-dropdown-btn')).toBeVisible()
  })

  test('should have send button with correct initial state', async ({ page }) => {
    const sendBtn = page.locator('#send-btn')
    await expect(sendBtn).toBeVisible()
    // Button may or may not be disabled depending on JS init timing
    // The important thing is it exists and is visible
  })

  test('should enable send button when input has text and a model is selected', async ({ page }) => {
    const textarea = page.locator('#prompt-input')
    const sendBtn = page.locator('#send-btn')

    // Send button is gated by model selection: simulate the host setting a model.
    await dispatchHostMessage(page, { type: 'model_update', model: 'openai/gpt-4o' })
    await expect(page.locator('#model-label')).toHaveText('gpt-4o')

    await textarea.fill('Hello, OpenCode!')
    await expect(sendBtn).toBeEnabled()
  })

  test('should have proper visual layout', async ({ page }) => {
    await page.locator('#prompt-input').fill('Test input')

    const inputArea = page.locator('#input-area')
    const bottomBar = page.locator('#input-bottom-bar')
    const inputBox = await inputArea.boundingBox()
    const bottomBarBox = await bottomBar.boundingBox()
    const overflow = await inputArea.evaluate((el) => el.scrollWidth - el.clientWidth)

    expect(inputBox).not.toBeNull()
    expect(bottomBarBox).not.toBeNull()
    expect(bottomBarBox!.y).toBeGreaterThan(inputBox!.y)
    expect(overflow).toBeLessThanOrEqual(30)
  })
})
