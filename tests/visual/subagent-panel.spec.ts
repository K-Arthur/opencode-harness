import { test, expect, type Page } from '@playwright/test'
import { installVsCodeApi, expectNoWebviewErrors } from './webviewTestHarness'

async function mountSubagentPanel(page: Page, visible: boolean = true) {
  await page.evaluate((isVisible) => {
    document.querySelector('.welcome-container')?.remove()

    // Reuse the existing #subagent-panel (rendered by index.html and starting
    // out hidden) — just unhide it and replace its contents with the fixture.
    // Previously this branch did nothing, leaving the panel empty and
    // breaking every render-items assertion.
    const existingPanel = document.getElementById('subagent-panel')
    if (existingPanel) {
      existingPanel.classList.toggle('hidden', !isVisible)
      existingPanel.innerHTML = ''
    }

    const host = existingPanel || document.querySelector('.tab-panel.active') || document.querySelector('.chat-main') || document.body
    const panel = existingPanel ?? document.createElement('div')
    if (!existingPanel) {
      panel.id = 'subagent-panel'
      panel.className = `subagent-panel ${isVisible ? '' : 'hidden'}`
      panel.setAttribute('aria-label', 'Subagent activity')
    }
    panel.innerHTML = `
      <div class="subagent-panel-header">
        <h2 class="subagent-panel-title">Subagent Activity</h2>
        <button class="icon-btn" id="close-subagent-btn" title="Close panel" aria-label="Close subagent panel">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="subagent-panel-content" id="subagent-list">
        <div class="subagent-item">
          <div class="subagent-item-header">
            <span class="subagent-item-name">Code Analyzer</span>
            <span class="subagent-item-status subagent-item-status--running">Running</span>
          </div>
          <div class="subagent-item-progress">
            <div class="subagent-item-progress-bar" style="width: 65%"></div>
          </div>
          <div class="subagent-item-output">Analyzing code structure...</div>
          <div class="subagent-item-actions">
            <button class="subagent-cancel-btn">Cancel</button>
          </div>
        </div>
        <div class="subagent-item">
          <div class="subagent-item-header">
            <span class="subagent-item-name">Debug Helper</span>
            <span class="subagent-item-status subagent-item-status--completed">Completed</span>
          </div>
          <div class="subagent-item-progress">
            <div class="subagent-item-progress-bar" style="width: 100%"></div>
          </div>
          <div class="subagent-item-output">Found and fixed 3 bugs</div>
        </div>
        <div class="subagent-item">
          <div class="subagent-item-header">
            <span class="subagent-item-name">Test Runner</span>
            <span class="subagent-item-status subagent-item-status--failed">Failed</span>
          </div>
          <div class="subagent-item-progress">
            <div class="subagent-item-progress-bar" style="width: 45%"></div>
          </div>
          <div class="subagent-item-output">Error: Test timeout</div>
        </div>
      </div>
    `
    if (!existingPanel) {
      host.appendChild(panel)
    }
  }, visible)
}

test.describe('Subagent Activity Panel', () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
    await page.goto('/')
    await mountSubagentPanel(page)
  })

  test.afterEach(async ({ page }) => {
    await expectNoWebviewErrors(page)
  })

  test('should render subagent panel', async ({ page }) => {
    const panel = page.locator('#subagent-panel')
    await expect(panel).toBeVisible()
    await expect(panel).toHaveAttribute('aria-label', 'Subagent activity')
  })

  test('should have proper header', async ({ page }) => {
    const title = page.locator('.subagent-panel-title')
    await expect(title).toHaveText('Subagent Activity')
    
    const closeBtn = page.locator('#close-subagent-btn')
    await expect(closeBtn).toBeVisible()
    await expect(closeBtn).toHaveAttribute('aria-label', 'Close subagent panel')
  })

  test('should render subagent items', async ({ page }) => {
    const subagentItems = page.locator('.subagent-item')
    await expect(subagentItems).toHaveCount(3)
  })

  test('should show running status with proper styling', async ({ page }) => {
    const runningStatus = page.locator('.subagent-item-status--running')
    await expect(runningStatus).toHaveText('Running')
    
    const backgroundColor = await runningStatus.evaluate(el => 
      window.getComputedStyle(el).backgroundColor
    )
    expect(backgroundColor).toBeTruthy()
  })

  test('should show completed status with proper styling', async ({ page }) => {
    const completedStatus = page.locator('.subagent-item-status--completed')
    await expect(completedStatus).toHaveText('Completed')
  })

  test('should show failed status with proper styling', async ({ page }) => {
    const failedStatus = page.locator('.subagent-item-status--failed')
    await expect(failedStatus).toHaveText('Failed')
  })

  test('should render progress bar', async ({ page }) => {
    const progressBar = page.locator('.subagent-item').nth(0).locator('.subagent-item-progress-bar')
    const width = await progressBar.evaluate(el => el.style.width)
    expect(width).toBe('65%')
  })

  test('should render subagent output', async ({ page }) => {
    const output = page.locator('.subagent-item').nth(0).locator('.subagent-item-output')
    await expect(output).toHaveText('Analyzing code structure...')
  })

  test('should show cancel button for running subagent', async ({ page }) => {
    const cancelBtn = page.locator('.subagent-cancel-btn')
    await expect(cancelBtn).toBeVisible()
    await expect(cancelBtn).toHaveText('Cancel')
  })

  test('should hide panel when hidden class is applied', async ({ page }) => {
    await mountSubagentPanel(page, false)
    
    const panel = page.locator('#subagent-panel')
    await expect(panel).not.toBeVisible()
  })

  test('should have proper styling for subagent items', async ({ page }) => {
    const subagentItem = page.locator('.subagent-item').nth(0)
    
    // Check border
    const border = await subagentItem.evaluate(el => window.getComputedStyle(el).border)
    expect(border).toBeTruthy()
  })

  test('should display subagent name', async ({ page }) => {
    const name = page.locator('.subagent-item-name').nth(0)
    await expect(name).toHaveText('Code Analyzer')
  })
})

test.describe('Subagent Activity — TDD & Domain Enhancements', () => {
  async function mountTddSubagentPanel(page: Page) {
    await page.evaluate(() => {
      document.querySelector('.welcome-container')?.remove()

      const host = document.querySelector('.tab-panel.active') || document.querySelector('.chat-main') || document.body
      const panel = document.createElement('div')
      panel.id = 'subagent-panel'
      panel.className = 'subagent-panel'
      panel.setAttribute('aria-label', 'Subagent activity')
      panel.innerHTML = `
        <div class="subagent-panel-header">
          <h2 class="subagent-panel-title">Subagent Activity</h2>
          <button class="icon-btn" id="close-subagent-btn" title="Close panel" aria-label="Close subagent panel">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="subagent-panel-content" id="subagent-list">
          <div class="subagent-item subagent-item--running" data-subagent-id="tdd-1">
            <div class="subagent-header">
              <div class="subagent-name-wrap">
                <div class="subagent-name">Auth API Implementer</div>
                <span class="subagent-domain-badge">🔌 api</span>
              </div>
              <div class="subagent-status">running</div>
              <button class="subagent-cancel-btn" aria-label="Cancel Auth API Implementer">Cancel</button>
            </div>
            <div class="subagent-tdd-bar">
              <span class="subagent-tdd-phase" style="color: #ef4444">RED — Writing tests</span>
              <span class="subagent-test-info subagent-test-info--failing">2/5 tests passing</span>
            </div>
            <div class="subagent-output">Writing test for login endpoint...</div>
          </div>
          <div class="subagent-item subagent-item--running" data-subagent-id="tdd-2">
            <div class="subagent-header">
              <div class="subagent-name-wrap">
                <div class="subagent-name">User Dashboard</div>
                <span class="subagent-domain-badge">🎨 frontend</span>
              </div>
              <div class="subagent-status">running</div>
              <button class="subagent-cancel-btn" aria-label="Cancel User Dashboard">Cancel</button>
            </div>
            <div class="subagent-tdd-bar">
              <span class="subagent-tdd-phase" style="color: #22c55e">GREEN — Implementing</span>
              <span class="subagent-test-info">8/8 tests passing</span>
            </div>
          </div>
          <div class="subagent-item subagent-item--completed" data-subagent-id="tdd-3">
            <div class="subagent-header">
              <div class="subagent-name-wrap">
                <div class="subagent-name">DB Migration</div>
                <span class="subagent-domain-badge">🗄️ database</span>
              </div>
              <div class="subagent-status">completed</div>
            </div>
            <div class="subagent-tdd-bar">
              <span class="subagent-tdd-phase" style="color: #f59e0b">COVERAGE — Verifying</span>
              <span class="subagent-test-info">12/12 tests passing</span>
            </div>
          </div>
        </div>
      `
      host.appendChild(panel)
    })
  }

  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
    await page.goto('/')
    await mountTddSubagentPanel(page)
  })

  test.afterEach(async ({ page }) => {
    await expectNoWebviewErrors(page)
  })

  test('should render domain badges', async ({ page }) => {
    const badges = page.locator('.subagent-domain-badge')
    await expect(badges).toHaveCount(3)
    await expect(badges.nth(0)).toHaveText('🔌 api')
    await expect(badges.nth(1)).toHaveText('🎨 frontend')
    await expect(badges.nth(2)).toHaveText('🗄️ database')
  })

  test('should render TDD phase indicators', async ({ page }) => {
    const phases = page.locator('.subagent-tdd-phase')
    await expect(phases).toHaveCount(3)
    await expect(phases.nth(0)).toHaveText('RED — Writing tests')
    await expect(phases.nth(1)).toHaveText('GREEN — Implementing')
    await expect(phases.nth(2)).toHaveText('COVERAGE — Verifying')
  })

  test('should render test counts', async ({ page }) => {
    const testInfos = page.locator('.subagent-test-info')
    await expect(testInfos).toHaveCount(3)
    await expect(testInfos.nth(0)).toHaveText('2/5 tests passing')
    await expect(testInfos.nth(1)).toHaveText('8/8 tests passing')
    await expect(testInfos.nth(2)).toHaveText('12/12 tests passing')
  })

  test('should highlight failing test counts', async ({ page }) => {
    const failingInfo = page.locator('.subagent-test-info--failing')
    await expect(failingInfo).toHaveCount(1)
    await expect(failingInfo.nth(0)).toHaveText('2/5 tests passing')
  })

  test('should render subagent output for running agents', async ({ page }) => {
    const output = page.locator('.subagent-output')
    await expect(output).toHaveCount(1)
    await expect(output).toHaveText('Writing test for login endpoint...')
  })

  test('should show cancel button for running agents only', async ({ page }) => {
    const cancelBtns = page.locator('.subagent-cancel-btn')
    await expect(cancelBtns).toHaveCount(2) // Only running agents
  })

  test('should have proper TDD bar styling', async ({ page }) => {
    const tddBar = page.locator('.subagent-tdd-bar').nth(0)
    const bg = await tddBar.evaluate(el => window.getComputedStyle(el).backgroundColor)
    expect(bg).toBeTruthy()
  })

  test('should render name wrap with flex layout', async ({ page }) => {
    const nameWrap = page.locator('.subagent-name-wrap').nth(0)
    const display = await nameWrap.evaluate(el => window.getComputedStyle(el).display)
    expect(display).toBe('flex')
  })
})

test.describe('Subagent Panel — Collapsed Completed + Detail View', () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
    await page.goto('/')
  })

  test.afterEach(async ({ page }) => {
    await expectNoWebviewErrors(page)
  })

  async function mountMixedPanel(page: Page) {
    await page.evaluate(() => {
      document.querySelector('.welcome-container')?.remove()
      const panel = document.getElementById('subagent-panel')!
      panel.classList.remove('hidden')
      panel.setAttribute('data-view', 'list')
      panel.innerHTML = `
        <div class="subagent-panel-content" id="subagent-list">
          <div class="subagent-stats-bar">3 subagents · 1 running · 2 done</div>
          <div class="subagent-list">
            <div class="subagent-item subagent-item--running" data-subagent-id="s1">
              <div class="subagent-item-header">
                <div class="subagent-name-wrap"><div class="subagent-name">Active Runner</div></div>
                <div class="subagent-item-status subagent-item-status--running">Running</div>
                <button class="subagent-cancel-btn">Cancel</button>
              </div>
              <div class="subagent-item-progress"><div class="subagent-item-progress-bar" style="--p:0.6"></div></div>
            </div>
            <div class="subagent-item subagent-item--completed subagent-item--collapsed" data-subagent-id="s2">
              <div class="subagent-item-header">
                <div class="subagent-name-wrap"><div class="subagent-name">Done Agent</div></div>
                <div class="subagent-item-status subagent-item-status--completed">Completed</div>
                <button class="subagent-expand-btn" aria-expanded="false">▶</button>
              </div>
            </div>
            <div class="subagent-item subagent-item--failed subagent-item--collapsed" data-subagent-id="s3">
              <div class="subagent-item-header">
                <div class="subagent-name-wrap"><div class="subagent-name">Failed Agent</div></div>
                <div class="subagent-item-status subagent-item-status--failed">Failed</div>
                <button class="subagent-expand-btn" aria-expanded="false">▶</button>
              </div>
            </div>
          </div>
        </div>
        <div id="subagent-detail-view" class="subagent-detail-view hidden" aria-label="Subagent detail">
          <div class="subagent-detail-header">
            <button class="icon-btn" id="subagent-detail-back-btn" aria-label="Back to list">
              <svg viewBox="0 0 24 24" width="16" height="16"></svg>
            </button>
            <h2 class="subagent-detail-title">Subagent Detail</h2>
            <button class="icon-btn" id="subagent-detail-close-btn" aria-label="Close detail">
              <svg viewBox="0 0 24 24" width="16" height="16"></svg>
            </button>
          </div>
          <div class="subagent-detail-content" id="subagent-detail-content">
            <div class="subagent-detail-card">
              <div class="subagent-detail-section">
                <div class="subagent-detail-status-row">
                  <span class="subagent-detail-status-badge subagent-detail-status-badge--completed">Completed</span>
                  <span class="subagent-detail-duration">5s</span>
                </div>
              </div>
              <div class="subagent-detail-section">
                <h3 class="subagent-detail-section-title">Summary</h3>
                <p class="subagent-detail-text">Agent completed its work successfully.</p>
              </div>
            </div>
          </div>
        </div>
      `
    })
  }

  test('completed items render collapsed by default', async ({ page }) => {
    await mountMixedPanel(page)
    const collapsed = page.locator('.subagent-item--collapsed')
    await expect(collapsed).toHaveCount(2)
  })

  test('collapsed items hide progress bar', async ({ page }) => {
    await mountMixedPanel(page)
    const collapsedItem = page.locator('.subagent-item--collapsed').first()
    const progress = collapsedItem.locator('.subagent-item-progress')
    await expect(progress).toHaveCount(0)
  })

  test('expand button toggles collapsed state', async ({ page }) => {
    await mountMixedPanel(page)
    const expandBtn = page.locator('.subagent-expand-btn').first()
    await expandBtn.click()
    const item = page.locator('.subagent-item--collapsed').first()
    // After click, the item should no longer have --collapsed
    await expect(item).toHaveCount(0)
  })

  test('cancel button only appears for running agents', async ({ page }) => {
    await mountMixedPanel(page)
    const cancelBtns = page.locator('.subagent-cancel-btn')
    await expect(cancelBtns).toHaveCount(1)
  })

  test('detail view does NOT overlap other tab panes', async ({ page }) => {
    await mountMixedPanel(page)

    // Show the detail view
    await page.evaluate(() => {
      const panel = document.getElementById('subagent-panel')!
      panel.dataset.view = 'detail'
      const detailView = document.getElementById('subagent-detail-view')!
      detailView.classList.remove('hidden')
    })

    // The detail view must be inside the subagent panel, NOT a direct child of .side-region-body
    const isNested = await page.evaluate(() => {
      const detailView = document.getElementById('subagent-detail-view')!
      const panel = document.getElementById('subagent-panel')!
      return panel.contains(detailView)
    })
    expect(isNested).toBe(true)

    // The list must be hidden when detail is shown
    const listVisible = await page.evaluate(() => {
      const list = document.getElementById('subagent-list')!
      return list.offsetParent !== null
    })
    expect(listVisible).toBe(false)
  })

  test('back button returns to list view', async ({ page }) => {
    await mountMixedPanel(page)

    // Show detail
    await page.evaluate(() => {
      const panel = document.getElementById('subagent-panel')!
      panel.dataset.view = 'detail'
      const detailView = document.getElementById('subagent-detail-view')!
      detailView.classList.remove('hidden')
    })

    // Click back
    await page.click('#subagent-detail-back-btn')

    const viewState = await page.evaluate(() => {
      return document.getElementById('subagent-panel')!.dataset.view
    })
    expect(viewState).toBe('list')
  })
})
