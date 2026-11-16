import { defineConfig } from '@playwright/test'
const port = process.env.PLAYWRIGHT_PORT ?? '4185'
const remote = process.env.PLAYWRIGHT_BASE_URL
export default defineConfig({
  testDir: './tests', fullyParallel: true, forbidOnly: Boolean(process.env.CI), retries: 0,
  reporter: [['list'], ['json', { outputFile: process.env.PLAYWRIGHT_REPORT ?? 'artifacts/browser-report.json' }]],
  outputDir: process.env.PLAYWRIGHT_OUTPUT ?? 'artifacts/browser',
  use: { baseURL: remote ?? `http://127.0.0.1:${port}`, viewport: {width: 1440, height: 1000}, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  ...(!remote && { webServer: { command: `npm run preview -- --port ${port} --strictPort`, url: `http://127.0.0.1:${port}`, reuseExistingServer: false } }),
})
