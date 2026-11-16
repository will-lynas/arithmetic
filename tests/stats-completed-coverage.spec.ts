import { expect, test, type Page } from '@playwright/test'

const coverage = (page: Page) => page.getByText(/^Completed: \d+ \/ 144$/)
const snapshot = (page: Page) => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)])))

async function addHistory(page: Page, full = false) {
  await page.evaluate(full => {
    const put = (left: number, right: number, roundId = crypto.randomUUID(), correct = true, elapsedMs = 1000) => {
      const id = crypto.randomUUID()
      localStorage.setItem('arithmetic:attempt:v1:' + id, JSON.stringify({ version: 1, id, roundId, questionIndex: 0, left, right, answer: correct ? left * right : 0, correct, elapsedMs, submittedAt: '2026-01-01T00:00:00.000Z', unknown: 'keep exact bytes' }, null, 2))
    }
    if (full) {
      for (let left = 1; left <= 12; left++) for (let right = 1; right <= 12; right++) put(left, right)
    } else {
      const round = crypto.randomUUID()
      put(9, 6, round, false)
      put(9, 6, round, true, 2000) // Correction completes a square.
      put(9, 6, round, true, 3000) // Retry does not create another square.
      for (let i = 0; i < 5; i++) put(9, 6) // Independent solves still count one square.
      put(6, 9) // Reversed order is distinct.
      put(2, 3, crypto.randomUUID(), false) // Wrong-only is not completed.
    }
  }, full)
}

test('coverage follows empty, partial and full history across storage refresh, routes and reload without writing', async ({ page, context }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.stack ?? error.message))
  await page.goto('/multiplication/stats')
  await expect(coverage(page)).toHaveText('Completed: 0 / 144')
  const other = await context.newPage()
  await other.goto('/multiplication/stats')
  await addHistory(other)
  await expect(coverage(page)).toHaveText('Completed: 2 / 144')
  const partial = await snapshot(page)
  await page.reload()
  await expect(coverage(page)).toHaveText('Completed: 2 / 144')
  expect(await snapshot(page)).toEqual(partial)
  await addHistory(other, true)
  await expect(coverage(page)).toHaveText('Completed: 144 / 144')
  const full = await snapshot(page)
  await page.getByRole('link', { name: 'Practice', exact: true }).click()
  await page.getByRole('link', { name: 'Stats', exact: true }).click()
  await expect(coverage(page)).toHaveText('Completed: 144 / 144')
  await page.reload()
  await expect(coverage(page)).toHaveText('Completed: 144 / 144')
  expect(await snapshot(page)).toEqual(full)
  expect(errors).toEqual([])
  await other.close()
})

for (const theme of ['dark', 'light']) for (const width of [1440, 320]) {
  test(`coverage is compact beside Completions in ${theme} at ${width}`, async ({ page }, testInfo) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.stack ?? error.message))
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/multiplication/stats')
    await addHistory(page, true)
    await page.evaluate(theme => localStorage.setItem('arithmetic:theme', theme), theme)
    await page.reload()
    await expect(coverage(page)).toHaveText('Completed: 144 / 144')
    await expect(page.getByRole('table')).toHaveCount(3)
    const metric = coverage(page)
    await metric.scrollIntoViewIfNeeded()
    const heading = page.getByRole('heading', { name: 'Completions', exact: true })
    const a = (await metric.boundingBox())!, b = (await heading.boundingBox())!
    if (width === 320) {
      expect(a.x).toBe(b.x)
      expect(a.y).toBeGreaterThanOrEqual(b.y + b.height)
      expect(a.y - b.y - b.height).toBeLessThanOrEqual(10)
    } else {
      expect(a.x).toBeGreaterThanOrEqual(b.x + b.width)
      expect(Math.abs(a.y - b.y)).toBeLessThan(6)
    }
    expect(a.x + a.width).toBeLessThanOrEqual(width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const color = theme === 'dark' ? 'rgb(50, 52, 55)' : 'rgb(225, 227, 224)'
    for (const selector of ['html', 'body', '#root', '.app']) await expect(page.locator(selector)).toHaveCSS('background-color', color)
    await page.screenshot({ path: testInfo.outputPath(`coverage-${theme}-${width}.png`) })
    expect(errors).toEqual([])
  })
}
