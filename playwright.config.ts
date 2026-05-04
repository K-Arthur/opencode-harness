import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/visual',
  timeout: 30000,
  expect: {
    toHaveScreenshot: { 
      maxDiffPixels: 100,
      threshold: 0.1
    },
    timeout: 10000
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }]],
  webServer: {
    command: 'npx serve dist/chat/webview -p 3000 -s',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 10000,
  },
  use: {
    baseURL: 'http://localhost:3000',
    bypassCSP: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        viewport: { width: 400, height: 700 }
      },
    },
  ],
})
