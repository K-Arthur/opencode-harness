import { test, expect, type Page } from '@playwright/test'
import { dispatchHostMessage, expectNoWebviewErrors, installVsCodeApi, postedMessages } from '../visual/webviewTestHarness'

const sessionId = 'session-live-1'
const messageId = 'assistant-live-1'
const toolId = 'tool-live-1'

async function initLiveTool(page: Page) {
  await dispatchHostMessage(page, {
    type: 'init_state',
    sessions: [{
      id: sessionId,
      name: 'Live output',
      model: '',
      mode: 'build',
      isStreaming: false,
      messages: [],
    }],
    activeSessionId: sessionId,
    globalModel: '',
  })
  await dispatchHostMessage(page, {
    type: 'stream_start',
    sessionId,
    messageId,
  })
  await dispatchHostMessage(page, {
    type: 'stream_tool_start',
    sessionId,
    toolCall: {
      id: toolId,
      name: 'bash',
      class: 'exec',
      state: 'running',
      args: { command: 'npm install', cwd: '/repo' },
      startedAt: Date.now(),
    },
  })
  await expect(page.locator(`[data-block-id="${toolId}"]`)).toHaveCount(1)
}

async function partial(page: Page, token: number, over: Record<string, unknown>) {
  await dispatchHostMessage(page, {
    type: 'stream_tool_partial',
    sessionId,
    toolCall: {
      id: toolId,
      name: 'bash',
      class: 'exec',
      state: 'running',
      token,
      stdoutLength: 0,
      stderrLength: 0,
      ...over,
    },
  })
}

async function openTool(page: Page) {
  const card = page.locator(`[data-block-id="${toolId}"]`)
  await card.locator('summary').click()
  await expect(card).toHaveAttribute('open', '')
  return card
}

async function toolText(page: Page): Promise<string> {
  return page.locator(`[data-block-id="${toolId}"]`).evaluate((el) => el.textContent || '')
}

test.describe('Live bash tool output', () => {
  test.beforeEach(async ({ page }) => {
    await installVsCodeApi(page)
    await page.goto('/')
    await initLiveTool(page)
  })

  test.afterEach(async ({ page }) => {
    await expectNoWebviewErrors(page)
  })

  test('appends partial stdout/stderr, ignores duplicate/stale tokens, and repairs replacement snapshots', async ({ page }) => {
    await partial(page, 1, {
      partialStdout: 'installing\n',
      partialStderr: 'warn\n',
      stdoutLength: 11,
      stderrLength: 5,
      stdoutLineCount: 1,
      stderrLineCount: 1,
    })
    const card = await openTool(page)

    await expect(card.locator('.tool-live-indicator')).toHaveCount(1)
    await expect(card.locator('.tool-command-output-label')).toContainText(['stdout', 'stderr'])
    await expect.poll(() => toolText(page)).toContain('installing')
    await expect.poll(() => toolText(page)).toContain('warn')

    await partial(page, 1, {
      partialStdout: 'duplicate\n',
      stdoutLength: 21,
      stderrLength: 5,
    })
    await expect.poll(() => toolText(page)).not.toContain('duplicate')

    await partial(page, 2, {
      replace: true,
      stdout: 'fresh\n',
      stderr: '',
      stdoutLength: 6,
      stderrLength: 0,
      stdoutLineCount: 1,
      stderrLineCount: 0,
    })
    await expect.poll(() => toolText(page)).toContain('fresh')
    await expect.poll(() => toolText(page)).not.toContain('installing')

    await dispatchHostMessage(page, {
      type: 'stream_tool_end',
      sessionId,
      toolCall: {
        id: toolId,
        name: 'bash',
        class: 'exec',
        state: 'result',
        result: 'fresh\n',
        exitCode: 0,
        durationMs: 1200,
      },
    })
    await partial(page, 3, {
      partialStdout: 'stale\n',
      stdoutLength: 12,
      stderrLength: 0,
    })

    await expect.poll(() => toolText(page)).not.toContain('stale')
    await expect(card).toContainText('exit 0')
  })

  test('truncates live output and expands with Show full', async ({ page }) => {
    const longOutput = Array.from({ length: 45 }, (_, i) => `line-${i}`).join('\n')
    await partial(page, 1, {
      partialStdout: longOutput,
      stdoutLength: longOutput.length,
      stderrLength: 0,
      stdoutLineCount: 45,
      stderrLineCount: 0,
    })
    const card = await openTool(page)

    await expect(card.locator('.tool-show-more')).toBeVisible()
    await expect(card.locator('.tool-result-body').first()).toContainText('line-39')
    await expect(card.locator('.tool-result-body').first()).not.toContainText('line-44')

    await card.locator('.tool-show-more').click()
    await expect(card.locator('.tool-result-body').first()).toContainText('line-44')
  })

  test('Cancel on the bash card posts cancel_tool with captured output', async ({ page }) => {
    await partial(page, 1, {
      partialStdout: 'partial out\n',
      partialStderr: 'partial err\n',
      stdoutLength: 12,
      stderrLength: 12,
    })
    const card = await openTool(page)
    await card.locator('.tool-result-action-btn--danger', { hasText: 'Cancel' }).click()

    await expect.poll(async () => postedMessages(page)).toContainEqual(expect.objectContaining({
      type: 'cancel_tool',
      sessionId,
      toolId,
      stdout: 'partial out\n',
      stderr: 'partial err\n',
    }))
  })
})
