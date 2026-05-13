import { test, expect, type Page } from '@playwright/test'
import { installVsCodeApi, expectNoWebviewErrors } from './webviewTestHarness'

async function mountDiffBlock(page: Page, wrapped: boolean = false) {
  await page.evaluate((isWrapped) => {
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

    const diffBlock = document.createElement('div')
    diffBlock.className = 'diff-block'
    diffBlock.innerHTML = `
      <div class="diff-header">
        <div class="diff-file-info">
          <span class="diff-file-path">src/example.ts</span>
          <span class="diff-stats">
            <span class="diff-stat diff-stat--added">+5</span>
            <span class="diff-stat diff-stat--removed">-2</span>
          </span>
        </div>
        <button class="diff-wrap-toggle ${isWrapped ? 'active' : ''}" aria-label="Toggle line wrapping">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="4" y1="6" x2="20" y2="6"/>
            <line x1="4" y1="12" x2="20" y2="12"/>
            <line x1="4" y1="18" x2="20" y2="18"/>
          </svg>
          <span>Wrap</span>
        </button>
      </div>
      <div class="diff-table-wrapper ${isWrapped ? 'diff-table-wrapper--wrapped' : ''}">
        <table class="diff-table">
          <tbody>
            <tr class="diff-line diff-line--context">
              <td class="diff-line-num">1</td>
              <td class="diff-line-num">1</td>
              <td class="diff-line-marker"> </td>
              <td class="diff-line-content">export function example() {</td>
            </tr>
            <tr class="diff-line diff-line--removed">
              <td class="diff-line-num diff-line-num--old">2</td>
              <td class="diff-line-num"></td>
              <td class="diff-line-marker">-</td>
              <td class="diff-line-content">  const oldVar = 'old';</td>
            </tr>
            <tr class="diff-line diff-line--added">
              <td class="diff-line-num"></td>
              <td class="diff-line-num diff-line-num--new">2</td>
              <td class="diff-line-marker">+</td>
              <td class="diff-line-content">  const newVar = 'new';</td>
            </tr>
            <tr class="diff-line diff-line--added">
              <td class="diff-line-num"></td>
              <td class="diff-line-num diff-line-num--new">3</td>
              <td class="diff-line-marker">+</td>
              <td class="diff-line-content">  const veryLongVariableNameThatWouldNormallyCauseHorizontalScroll = 'test';</td>
            </tr>
            <tr class="diff-line diff-line--context">
              <td class="diff-line-num">3</td>
              <td class="diff-line-num">4</td>
              <td class="diff-line-marker"> </td>
              <td class="diff-line-content">  return newVar;</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="diff-action-bar">
        <button class="diff-btn diff-btn--accept">Accept</button>
        <button class="diff-btn diff-btn--discard">Discard</button>
        <button class="diff-btn diff-btn--open">Open File</button>
      </div>
    `
    list.appendChild(diffBlock)
  }, wrapped)
}

test.describe('Diff Wrapping', () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
    await page.goto('/')
    await mountDiffBlock(page)
  })

  test.afterEach(async ({ page }) => {
    await expectNoWebviewErrors(page)
  })

  test('should render diff block with wrap toggle button', async ({ page }) => {
    const wrapToggle = page.locator('.diff-wrap-toggle')
    await expect(wrapToggle).toBeVisible()
    await expect(wrapToggle).toHaveAttribute('aria-label', 'Toggle line wrapping')
  })

  test('should toggle wrapped class on click', async ({ page }) => {
    const wrapToggle = page.locator('.diff-wrap-toggle')
    const tableWrapper = page.locator('.diff-table-wrapper')

    // Initial state should not have wrapped class
    await expect(tableWrapper).not.toHaveClass(/diff-table-wrapper--wrapped/)
    await expect(wrapToggle).not.toHaveClass(/active/)

    // Click to enable wrapping
    await wrapToggle.click()
    await expect(tableWrapper).toHaveClass(/diff-table-wrapper--wrapped/)
    await expect(wrapToggle).toHaveClass(/active/)

    // Click to disable wrapping
    await wrapToggle.click()
    await expect(tableWrapper).not.toHaveClass(/diff-table-wrapper--wrapped/)
    await expect(wrapToggle).not.toHaveClass(/active/)
  })

  test('should apply wrapped mode from initial state', async ({ page }) => {
    await mountDiffBlock(page, true)
    
    const wrapToggle = page.locator('.diff-wrap-toggle')
    const tableWrapper = page.locator('.diff-table-wrapper')

    await expect(tableWrapper).toHaveClass(/diff-table-wrapper--wrapped/)
    await expect(wrapToggle).toHaveClass(/active/)
  })

  test('should have proper styling for wrapped mode', async ({ page }) => {
    const tableWrapper = page.locator('.diff-table-wrapper')
    
    // Check default overflow-x
    const overflowX = await tableWrapper.evaluate(el => window.getComputedStyle(el).overflowX)
    expect(overflowX).toBe('auto')

    // Enable wrapping
    await page.locator('.diff-wrap-toggle').click()
    
    // Check wrapped mode overflow
    const wrappedOverflowX = await tableWrapper.evaluate(el => window.getComputedStyle(el).overflowX)
    expect(wrappedOverflowX).toBe('hidden')
  })

  test('should preserve diff content in both modes', async ({ page }) => {
    const diffContent = page.locator('.diff-line-content')
    const contentCount = await diffContent.count()
    expect(contentCount).toBe(4)

    // Toggle wrapping and verify content is preserved
    await page.locator('.diff-wrap-toggle').click()
    const contentCountAfter = await diffContent.count()
    expect(contentCountAfter).toBe(4)
  })
})
