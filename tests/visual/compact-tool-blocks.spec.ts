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
        <span class="tool-status tool-status--result">✓ Done</span>
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
            <span class="tool-status tool-status--result">✓ Done</span>
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
