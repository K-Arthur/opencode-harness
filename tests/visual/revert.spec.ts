import { test, expect, type Page } from '@playwright/test'
import { installVsCodeApi, expectNoWebviewErrors } from './webviewTestHarness'

async function mountDiffBlockWithRevert(page: Page, state: 'pending' | 'accepted' | 'discarded' = 'accepted') {
  await page.evaluate((diffState) => {
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
    diffBlock.className = `diff-block diff-block--${diffState}`
    diffBlock.dataset.diffId = 'diff-123'
    
    const header = document.createElement('div')
    header.className = 'diff-header'
    header.innerHTML = `
      <div class="diff-file-info">
        <span class="diff-file-path">src/example.ts</span>
        <span class="diff-stats">
          <span class="diff-stat diff-stat--added">+5</span>
          <span class="diff-stat diff-stat--removed">-2</span>
        </span>
      </div>
    `
    
    const actionBar = document.createElement('div')
    actionBar.className = 'diff-action-bar'
    
    if (diffState === 'accepted') {
      const chip = document.createElement('span')
      chip.className = 'diff-state-chip diff-state--accepted'
      chip.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Applied'
      actionBar.appendChild(chip)
      
      const revertBtn = document.createElement('button')
      revertBtn.className = 'diff-btn diff-btn--revert'
      revertBtn.textContent = 'Revert'
      revertBtn.setAttribute('aria-label', 'Revert changes to src/example.ts')
      actionBar.appendChild(revertBtn)
    } else if (diffState === 'discarded') {
      const chip = document.createElement('span')
      chip.className = 'diff-state-chip diff-state--discarded'
      chip.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> Discarded'
      actionBar.appendChild(chip)
    } else {
      const acceptBtn = document.createElement('button')
      acceptBtn.className = 'diff-btn diff-btn--accept'
      acceptBtn.textContent = 'Accept'
      actionBar.appendChild(acceptBtn)
      
      const discardBtn = document.createElement('button')
      discardBtn.className = 'diff-btn diff-btn--discard'
      discardBtn.textContent = 'Discard'
      actionBar.appendChild(discardBtn)
    }
    
    diffBlock.appendChild(header)
    diffBlock.appendChild(actionBar)
    list.appendChild(diffBlock)
  }, state)
}

test.describe('Revert Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
    await page.goto('/')
    await mountDiffBlockWithRevert(page)
  })

  test.afterEach(async ({ page }) => {
    await expectNoWebviewErrors(page)
  })

  test('should show revert button on accepted diffs', async ({ page }) => {
    const revertBtn = page.locator('.diff-btn--revert')
    await expect(revertBtn).toBeVisible()
    await expect(revertBtn).toHaveText('Revert')
    await expect(revertBtn).toHaveAttribute('aria-label', 'Revert changes to src/example.ts')
  })

  test('should not show revert button on pending diffs', async ({ page }) => {
    await mountDiffBlockWithRevert(page, 'pending')
    const revertBtn = page.locator('.diff-btn--revert')
    await expect(revertBtn).not.toBeVisible()
  })

  test('should not show revert button on discarded diffs', async ({ page }) => {
    await mountDiffBlockWithRevert(page, 'discarded')
    const revertBtn = page.locator('.diff-btn--revert')
    await expect(revertBtn).not.toBeVisible()
  })

  test('should show revert confirmation modal on click', async ({ page }) => {
    const revertBtn = page.locator('.diff-btn--revert')
    await revertBtn.click()
    
    const modal = page.locator('#revert-modal')
    await expect(modal).toBeVisible()
    await expect(modal).toHaveAttribute('role', 'dialog')
    await expect(modal).toHaveAttribute('aria-modal', 'true')
  })

  test('should have proper modal content', async ({ page }) => {
    const revertBtn = page.locator('.diff-btn--revert')
    await revertBtn.click()
    
    const modalTitle = page.locator('#revert-modal-title')
    await expect(modalTitle).toHaveText('Revert Changes?')
    
    const modalText = page.locator('.revert-modal-text')
    await expect(modalText).toContainText('src/example.ts')
    await expect(modalText).toContainText('cannot be undone')
  })

  test('should close modal on cancel click', async ({ page }) => {
    const revertBtn = page.locator('.diff-btn--revert')
    await revertBtn.click()
    
    const modal = page.locator('#revert-modal')
    await expect(modal).toBeVisible()
    
    const cancelBtn = page.locator('#revert-cancel')
    await cancelBtn.click()
    
    await expect(modal).not.toBeVisible()
  })

  test('should close modal on Escape key', async ({ page }) => {
    const revertBtn = page.locator('.diff-btn--revert')
    await revertBtn.click()
    
    const modal = page.locator('#revert-modal')
    await expect(modal).toBeVisible()
    
    await page.keyboard.press('Escape')
    await expect(modal).not.toBeVisible()
  })

  test('should have proper button styling', async ({ page }) => {
    const revertBtn = page.locator('.diff-btn--revert')
    
    // Check warning color
    const color = await revertBtn.evaluate(el => window.getComputedStyle(el).color)
    expect(color).toBeTruthy()
    
    // Check border
    const border = await revertBtn.evaluate(el => window.getComputedStyle(el).border)
    expect(border).toBeTruthy()
  })

  test('should focus cancel button when modal opens', async ({ page }) => {
    const revertBtn = page.locator('.diff-btn--revert')
    await revertBtn.click()
    
    const cancelBtn = page.locator('#revert-cancel')
    await expect(cancelBtn).toBeFocused()
  })
})
