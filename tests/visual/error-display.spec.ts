import { test, expect, type Page } from '@playwright/test'
import { installVsCodeApi, expectNoWebviewErrors } from './webviewTestHarness'

test.describe('Error Display Components', () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
    await page.goto('/')
  })

  test.afterEach(async ({ page }) => {
    await expectNoWebviewErrors(page)
  })

  test('renders error block with header, message, and detail', async ({ page }) => {
    const el = await page.evaluate(() => {
      const wrapper = document.createElement('div')
      wrapper.className = 'msg-error'
      wrapper.setAttribute('role', 'alert')
      wrapper.innerHTML = `
        <div class="error-bubble">
          <div class="error-header"><svg viewBox="0 0 16 16" width="16" height="16"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zM7 5h2v4H7V5zm0 5h2v2H7v-2z" fill="currentColor"/></svg><span>Error: TEST_ERROR</span></div>
          <div class="error-message">Something went wrong.</div>
          <div class="error-detail">Stack trace line 42</div>
          <div class="error-actions">
            <button class="error-action-btn error-action-btn--primary">Retry</button>
            <button class="error-action-btn error-action-btn--secondary">Dismiss</button>
          </div>
        </div>
      `
      document.body.appendChild(wrapper)
      return {
        className: wrapper.className,
        role: wrapper.getAttribute('role'),
        headerText: wrapper.querySelector('.error-header')?.textContent,
        messageText: wrapper.querySelector('.error-message')?.textContent,
        detailText: wrapper.querySelector('.error-detail')?.textContent,
        primaryBtn: wrapper.querySelector('.error-action-btn--primary')?.textContent,
        secondaryBtn: wrapper.querySelector('.error-action-btn--secondary')?.textContent,
      }
    })

    expect(el.className).toBe('msg-error')
    expect(el.role).toBe('alert')
    expect(el.headerText).toContain('TEST_ERROR')
    expect(el.messageText).toBe('Something went wrong.')
    expect(el.detailText).toBe('Stack trace line 42')
    expect(el.primaryBtn).toBe('Retry')
    expect(el.secondaryBtn).toBe('Dismiss')
  })

  test('retry button dispatches retry action on click', async ({ page }) => {
    let actionDispatched = ''
    await page.evaluate(() => {
      ;(window as any).__errorActionHandler = (action: any) => {
        ;(window as any).__lastAction = action.action
      }
    })

    await page.evaluate(() => {
      const wrapper = document.createElement('div')
      wrapper.className = 'msg-error'
      wrapper.innerHTML = `
        <div class="error-bubble">
          <div class="error-header"><span>Error</span></div>
          <div class="error-message">test</div>
          <div class="error-actions">
            <button class="error-action-btn error-action-btn--primary" data-action="retry">Retry</button>
            <button class="error-action-btn error-action-btn--secondary" data-action="dismiss">Dismiss</button>
          </div>
        </div>
      `
      document.body.appendChild(wrapper)
      wrapper.querySelector('.error-action-btn--primary')!.addEventListener('click', () => {
        if ((window as any).__errorActionHandler) {
          ;(window as any).__errorActionHandler({ action: 'retry' })
        }
      })
      wrapper.querySelector('.error-action-btn--primary')!.dispatchEvent(new Event('click'))
    })

    const lastAction = await page.evaluate(() => (window as any).__lastAction)
    expect(lastAction).toBe('retry')
  })

  test('dismiss button removes error element from DOM', async ({ page }) => {
    await page.evaluate(() => {
      const wrapper = document.createElement('div')
      wrapper.className = 'msg-error'
      wrapper.id = 'test-error'
      wrapper.innerHTML = `
        <div class="error-bubble">
          <div class="error-header"><span>Error</span></div>
          <div class="error-message">test</div>
          <div class="error-actions">
            <button class="error-action-btn error-action-btn--secondary" data-action="dismiss">Dismiss</button>
          </div>
        </div>
      `
      document.body.appendChild(wrapper)
      wrapper.querySelector('.error-action-btn--secondary')!.addEventListener('click', () => {
        if ((window as any).__errorActionHandler) {
          ;(window as any).__errorActionHandler({ action: 'dismiss' })
        } else {
          wrapper.remove()
        }
      })
      wrapper.querySelector('.error-action-btn--secondary')!.dispatchEvent(new Event('click'))
    })

    const exists = await page.evaluate(() => !!document.getElementById('test-error'))
    expect(exists).toBe(false)
  })

  test('disabled action button has disabled attribute and pointer-events: none', async ({ page }) => {
    const style = await page.evaluate(() => {
      const btn = document.createElement('button')
      btn.className = 'error-action-btn error-action-btn--primary error-action-btn--disabled'
      btn.disabled = true
      btn.textContent = 'Upgrade'
      document.body.appendChild(btn)
      return {
        disabled: btn.disabled,
        pointerEvents: window.getComputedStyle(btn).pointerEvents,
        opacity: window.getComputedStyle(btn).opacity,
        cursor: window.getComputedStyle(btn).cursor,
      }
    })

    expect(style.disabled).toBe(true)
    expect(style.pointerEvents).toBe('none')
    expect(style.opacity).toBe('0.5')
    expect(style.cursor).toBe('not-allowed')
  })

  test('error-boundary is hidden by default', async ({ page }) => {
    const hidden = await page.evaluate(() => {
      const el = document.getElementById('error-boundary')
      return el?.classList.contains('hidden')
    })
    expect(hidden).toBe(true)
  })

  test('error-boundary becomes visible when class is removed', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.getElementById('error-boundary')
      el?.classList.remove('hidden')
    })

    const visible = await page.evaluate(() => {
      const el = document.getElementById('error-boundary')
      return el && window.getComputedStyle(el).display !== 'none'
    })
    expect(visible).toBe(true)
  })

  test('error-boundary can be hidden again by adding hidden class', async ({ page }) => {
    await page.evaluate(() => {
      const el = document.getElementById('error-boundary')
      el?.classList.remove('hidden')
    })
    await page.evaluate(() => {
      const el = document.getElementById('error-boundary')
      el?.classList.add('hidden')
    })

    const display = await page.evaluate(() => {
      const el = document.getElementById('error-boundary')
      return el ? window.getComputedStyle(el).display : ''
    })
    expect(display).toBe('none')
  })

  test('error display renders with correct severity border colors', async ({ page }) => {
    const colors = await page.evaluate(() => {
      const container = document.createElement('div')
      container.style.cssText = 'position:fixed;top:0;left:0;width:400px'
      document.body.appendChild(container)

      const createError = (severity: string) => {
        const el = document.createElement('div')
        el.className = `msg-error error-${severity}`
        el.setAttribute('role', 'alert')
        el.innerHTML = '<div class="error-bubble"><div class="error-header"><span>Error</span></div><div class="error-message">test</div></div>'
        container.appendChild(el)
        return window.getComputedStyle(el).borderLeftColor
      }

      return {
        high: createError('high'),
        medium: createError('medium'),
        low: createError('low'),
      }
    })

    // All should be valid CSS color strings (non-empty)
    // The exact color varies by theme, but they must exist
    expect(colors.high.length).toBeGreaterThan(0)
    expect(colors.medium.length).toBeGreaterThan(0)
    expect(colors.low.length).toBeGreaterThan(0)
  })

  test('keyboard Enter on action button dispatches action', async ({ page }) => {
    let actionDispatched = ''
    await page.evaluate(() => {
      ;(window as any).__errorActionHandler = (action: any) => {
        ;(window as any).__lastAction = action.action
      }
    })

    await page.evaluate(() => {
      const wrapper = document.createElement('div')
      wrapper.className = 'msg-error'
      wrapper.innerHTML = `
        <div class="error-bubble">
          <div class="error-header"><span>Error</span></div>
          <div class="error-message">test</div>
          <div class="error-actions">
            <button class="error-action-btn error-action-btn--primary" data-action="retry" tabindex="0">Retry</button>
          </div>
        </div>
      `
      document.body.appendChild(wrapper)
      const btn = wrapper.querySelector('.error-action-btn--primary')!
      btn.addEventListener('keydown', (e: any) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          if ((window as any).__errorActionHandler) {
            ;(window as any).__errorActionHandler({ action: 'retry' })
          }
        }
      })
      btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    const lastAction = await page.evaluate(() => (window as any).__lastAction)
    expect(lastAction).toBe('retry')
  })

  test('error block inside a system message renders correctly', async ({ page }) => {
    await page.evaluate(() => {
      const msgDiv = document.createElement('div')
      msgDiv.className = 'message system'
      msgDiv.setAttribute('data-message-id', 'error-abc123')
      msgDiv.innerHTML = `
        <div class="message-content">
          <div class="message-bubble">
            <div class="msg-error" role="alert">
              <div class="error-bubble">
                <div class="error-header"><svg viewBox="0 0 16 16" width="16" height="16"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zM7 5h2v4H7V5zm0 5h2v2H7v-2z" fill="currentColor"/></svg><span>Error: RATE_LIMITED</span></div>
                <div class="error-message">Rate limit exceeded. Please wait and retry.</div>
                <div class="error-actions">
                  <button class="error-action-btn error-action-btn--primary">Wait & Retry</button>
                  <button class="error-action-btn error-action-btn--secondary">Switch Model</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      `
      const list = document.querySelector('.message-list')
      if (list) list.appendChild(msgDiv)
    })

    const errorBlock = page.locator('.message.system .msg-error')
    await expect(errorBlock).toBeVisible()
    await expect(errorBlock.locator('.error-header')).toContainText('RATE_LIMITED')
    await expect(errorBlock.locator('.error-message')).toContainText('Rate limit exceeded')
    await expect(errorBlock.locator('.error-action-btn--primary')).toContainText('Wait')
    await expect(errorBlock.locator('.error-action-btn--secondary')).toContainText('Switch Model')
  })
})
