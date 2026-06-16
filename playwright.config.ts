import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/visual',
  timeout: 30000,
  expect: {
    toHaveScreenshot: { 
      maxDiffPixels: 25,
      threshold: 0.04
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
    timeout: 30000,
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
      testDir: './tests/visual',
      testIgnore: '**/screenshots/**',
      use: { 
        ...devices['Desktop Chrome'],
        viewport: { width: 400, height: 700 }
      },
    },
    {
      name: 'chromium-webview',
      testDir: './tests/webview',
      use: { 
        ...devices['Desktop Chrome'],
        viewport: { width: 400, height: 700 }
      },
    },
    {
      name: 'screenshots-generate',
      testDir: './tests/visual/screenshots',
      testMatch: 'generate.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1600, height: 1000 },
      },
    },
    {
      name: 'screenshots-verify',
      testDir: './tests/visual/screenshots',
      testMatch: 'verify.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1600, height: 1000 },
      },
    },
  ],
})
