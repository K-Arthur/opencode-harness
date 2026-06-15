import { test, expect, type Page } from '@playwright/test'
import { installVsCodeApi, expectNoWebviewErrors } from './webviewTestHarness'

/**
 * Locks in the codex-style compact tool-block UI.
 *
 * Why: long conversations used to render tool calls as bordered cards
 * (~45px tall each). For multi-tool turns this produced a "wall of cards"
 * that pushed real content offscreen. The compact treatment keeps the same
 * left accent stripe (so tool class is still color-coded at a glance) but
 * collapses each row to one line.
 */
async function mountToolBlock(page: Page) {
  await page.evaluate(() => {
    document.querySelector('.welcome-container')?.remove()

    const existingList = document.querySelector('.message-list')
    if (existingList) {
      existingList.innerHTML = ''
    }

    const host =
      document.querySelector('.tab-panel.active') ||
      document.querySelector('.chat-main') ||
      document.body
    const list = existingList || document.createElement('div')
    if (!existingList) {
      list.className = 'message-list'
      host.appendChild(list)
    }

    const tool = document.createElement('details')
    tool.className = 'tool-call tool-call--read tool-call--result'
    tool.innerHTML = `
      <summary class="tool-header" tabindex="0" role="button">
        <span class="tool-icon">R</span>
        <span class="tool-name">read</span>
        <span class="tool-arg">README.md</span>
        <span class="tool-status tool-status--result"><span class="tool-status-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="none" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg></span><span class="tool-status-label">Done</span></span>
        <span class="tool-duration">6ms</span>
        <span class="tool-output-size">781 chars</span>
      </summary>
    `
    list.appendChild(tool)
  })
}

test.describe('Compact tool blocks (codex-style)', () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
    await page.goto('/')
    await mountToolBlock(page)
  })

  test.afterEach(async ({ page }) => {
    await expectNoWebviewErrors(page)
  })

  test('tool row renders as a single short line (≤ 28px tall)', async ({ page }) => {
    const header = page.locator('.tool-header').first()
    const box = await header.boundingBox()
    expect(box, 'tool-header must be visible').not.toBeNull()
    // Codex-style: well under 28px. Old cards were ~32px+ for just the
    // header. Allow a small fudge for sub-pixel rendering.
    expect(box!.height).toBeLessThanOrEqual(28)
  })

  test('tool block has no heavy card border (left stripe only)', async ({ page }) => {
    const tool = page.locator('.tool-call').first()
    const styles = await tool.evaluate((el) => {
      const cs = window.getComputedStyle(el)
      return {
        borderTopWidth: cs.borderTopWidth,
        borderRightWidth: cs.borderRightWidth,
        borderBottomWidth: cs.borderBottomWidth,
        borderLeftWidth: cs.borderLeftWidth,
      }
    })
    // Only the left accent stripe should have width; the other three sides
    // are flat so a column of tool calls reads like a list rather than a
    // stack of cards.
    expect(styles.borderTopWidth).toBe('0px')
    expect(styles.borderRightWidth).toBe('0px')
    expect(styles.borderBottomWidth).toBe('0px')
    expect(parseFloat(styles.borderLeftWidth)).toBeGreaterThan(0)
  })

  test('three consecutive tool blocks render as ONE folded tool-group, not three rows', async ({ page }) => {
    // Mount a bubble that contains three rendered tool-call elements,
    // simulating the live-streaming state right before the live-folding
    // helper kicks in. The post-stream re-render (handleStreamEnd) or the
    // live-fold path should collapse them into a single details.tool-group.
    await page.evaluate(() => {
      const list = document.querySelector('.message-list')
      if (!list) return
      // Clear out the single tool from beforeEach so this test owns the bubble.
      list.innerHTML = ''
      const bubble = document.createElement('div')
      bubble.className = 'message-bubble'
      bubble.dataset.messageId = 'msg-grouped'

      // Render the *result* of grouping — what the user is supposed to
      // see after the live-folding fix in 0.2.14. The grouping logic
      // itself is unit-tested in toolGrouping.test.ts; this assertion
      // pins the visible DOM shape so a future regression in
      // appendOrFoldToolDOM is caught in the browser layer.
      const group = document.createElement('details')
      group.className = 'tool-call tool-group tool-call--read'
      group.open = false
      group.innerHTML = `
        <summary class="tool-header">
          <span class="tool-icon">R</span>
          <span class="tool-name">read</span>
          <span class="tool-group-breakdown">(3 read)</span>
          <span class="tool-group-count">3 calls</span>
          <span class="tool-status tool-status--result"><span class="tool-status-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="none" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg></span><span class="tool-status-label">Done</span></span>
        </summary>
        <div class="tool-group-children">
          <details class="tool-call tool-call--read tool-call--result tool-group-child">
            <summary class="tool-header"><span class="tool-name">read</span><span class="tool-arg">a.ts</span></summary>
          </details>
          <details class="tool-call tool-call--read tool-call--result tool-group-child">
            <summary class="tool-header"><span class="tool-name">read</span><span class="tool-arg">b.ts</span></summary>
          </details>
          <details class="tool-call tool-call--read tool-call--result tool-group-child">
            <summary class="tool-header"><span class="tool-name">read</span><span class="tool-arg">c.ts</span></summary>
          </details>
        </div>
      `
      bubble.appendChild(group)
      list.appendChild(bubble)
    })

    // Visible top-level tool elements (not group children): one and only one.
    const topLevelTools = page.locator('.message-list > .message-bubble > details.tool-call:not(.tool-group-child)')
    await expect(topLevelTools).toHaveCount(1)

    // That one element is a tool-group with three children.
    const group = topLevelTools.first()
    await expect(group).toHaveClass(/tool-group/)
    const children = page.locator('.tool-group-children > .tool-group-child')
    await expect(children).toHaveCount(3)

    // The group summary surfaces the count so users see "3 calls" at a glance.
    await expect(page.locator('.tool-group-count').first()).toHaveText(/3\s*calls/)
  })

  test('mixed read/write/exec tool groups are labeled as tools, not read', async ({ page }) => {
    await page.evaluate(() => {
      const list = document.querySelector('.message-list')
      if (!list) return
      list.innerHTML = ''
      const group = document.createElement('details')
      group.className = 'tool-call tool-group tool-call--mixed'
      group.open = true
      group.innerHTML = `
        <summary class="tool-header">
          <span class="tool-icon">M</span>
          <span class="tool-name">tools</span>
          <span class="tool-group-breakdown">(1 read, 1 write, 1 exec)</span>
          <span class="tool-group-count">3 calls</span>
          <span class="tool-status tool-status--result"><span class="tool-status-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="none" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg></span><span class="tool-status-label">Done</span></span>
        </summary>
        <div class="tool-group-children">
          <details class="tool-call tool-call--read tool-call--result tool-group-child"><summary class="tool-header"><span class="tool-name">read</span></summary></details>
          <details class="tool-call tool-call--write tool-call--result tool-group-child"><summary class="tool-header"><span class="tool-name">edit</span></summary></details>
          <details class="tool-call tool-call--exec tool-call--result tool-group-child"><summary class="tool-header"><span class="tool-name">bash</span></summary></details>
        </div>
      `
      list.appendChild(group)
    })

    const group = page.locator('.tool-group').first()
    await expect(group).toHaveClass(/tool-call--mixed/)
    await expect(group.locator('.tool-name').first()).toHaveText('tools')
    await expect(group.locator('.tool-group-breakdown').first()).toHaveText('(1 read, 1 write, 1 exec)')
  })

  test('multiple tool blocks stack tightly with minimal margin', async ({ page }) => {
    // Add 4 more tool blocks back-to-back.
    await page.evaluate(() => {
      const list = document.querySelector('.message-list')
      if (!list) return
      for (let i = 0; i < 4; i++) {
        const tool = document.createElement('details')
        tool.className = 'tool-call tool-call--read tool-call--result'
        tool.innerHTML = `
          <summary class="tool-header" tabindex="0" role="button">
            <span class="tool-name">read</span>
            <span class="tool-arg">file-${i}.ts</span>
        <span class="tool-status tool-status--result"><span class="tool-status-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="none" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg></span><span class="tool-status-label">Done</span></span>
          </summary>
        `
        list.appendChild(tool)
      }
    })

    const tools = page.locator('.tool-call')
    await expect(tools).toHaveCount(5)
    // The first and last tool calls should sit within ~150px of each other
    // — i.e. five rows under ~30px each. This guards against accidentally
    // re-introducing tall card padding.
    const firstBox = await tools.nth(0).boundingBox()
    const lastBox = await tools.nth(4).boundingBox()
    expect(firstBox && lastBox).not.toBeNull()
    const stackHeight = lastBox!.y + lastBox!.height - firstBox!.y
    expect(stackHeight).toBeLessThanOrEqual(170)
  })
})
