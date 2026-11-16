import { expect, test, type Page } from '@playwright/test'

const name = 'Completions by ordered multiplication pair'
const table = (page: Page) => page.getByRole('table', { name, exact: true })
const cell = (page: Page, pair: string) => table(page).locator(`[data-pair="${pair}"]`)
const snapshot = (page: Page) => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)])))

async function seed(page: Page, theme = 'dark') {
  await page.goto('/multiplication/stats')
  await page.evaluate(theme => {
    localStorage.setItem('arithmetic:theme', theme)
    localStorage.setItem('arithmetic:future-preference', '{ "unknown": [1, 2] }')
    const roundId = crypto.randomUUID()
    const base = { version: 1, roundId, questionIndex: 0, left: 9, right: 6, answer: 53, correct: false, elapsedMs: 1000, submittedAt: '2026-01-01T00:00:00.000Z', unknown: { keep: ['all', 'metadata'] } }
    const put = (overrides: object) => {
      const id = crypto.randomUUID()
      localStorage.setItem('arithmetic:attempt:v1:' + id, JSON.stringify({ ...base, ...overrides, id }, null, 2))
    }
    put({})
    put({ answer: 54, correct: true, elapsedMs: 3000 })
    put({ answer: 54, correct: true, elapsedMs: 4000 }) // Same-screen successful retry is not a presentation.
    put({ questionIndex: 1, answer: 54, correct: true, elapsedMs: 2000 })
    for (let i = 0; i < 3; i++) put({ roundId: crypto.randomUUID(), answer: 54, correct: true, elapsedMs: 1000 })
    put({ left: 6, right: 9, answer: 54, correct: true })
    put({ left: 2, right: 3 }) // Divergent historical pair at the same round/index stays independent.
    for (let i = 0; i < 1234; i++) put({ roundId: crypto.randomUUID(), left: 12, right: 12, answer: 144, correct: true })
    localStorage.setItem('arithmetic:round-cancel:v1:' + roundId, JSON.stringify({ version: 1, roundId, canceledAt: base.submittedAt, unknown: 'retained' }, null, 2))
  }, theme)
  const bytes = await snapshot(page)
  await page.reload()
  await expect(page.locator('.app')).toHaveClass(`app ${theme}`)
  await expect(page.getByRole('alert')).toHaveCount(0)
  return bytes
}

test('completion counts are lifetime solved ordered presentations, not submissions, accuracy or completed rounds', async ({ page, context }) => {
  const bytes = await seed(page)
  await expect(table(page).locator('[data-pair]')).toHaveCount(144)
  await expect(table(page).getByRole('columnheader')).toHaveCount(12)
  await expect(table(page).getByRole('rowheader')).toHaveCount(12)
  await expect(cell(page, '9x6')).toHaveText('5')
  await expect(cell(page, '9x6')).toHaveAccessibleName('9 × 6: 5 completions')
  await expect(cell(page, '6x9')).toHaveText('1')
  await expect(cell(page, '2x3')).toHaveText('0')
  await expect(cell(page, '1x1')).toHaveText('0')
  await expect(cell(page, '12x12')).toHaveText('1234')
  await expect(table(page).getByRole('button')).toHaveCount(0)
  await expect(page.locator('.stats-map-heading h2')).toHaveText(['First-try accuracy', 'Average solve time', 'Completions'])
  const accuracy = page.getByRole('table', { name: 'First-try accuracy by ordered multiplication pair', exact: true })
  const speed = page.getByRole('table', { name: 'Average solve time by ordered multiplication pair', exact: true })
  await expect(accuracy.locator('[data-pair="9x6"]')).toHaveText('80%')
  await expect(speed.locator('[data-pair="9x6"]')).toHaveText('1.60 s')
  await page.getByRole('link', { name: 'Practice', exact: true }).click()
  await page.getByRole('link', { name: 'Stats', exact: true }).click()
  await page.reload()
  await expect(cell(page, '9x6')).toHaveText('5')
  expect(await snapshot(page)).toEqual(bytes)

  const other = await context.newPage()
  await other.goto('/multiplication/stats')
  await other.evaluate(() => {
    const id = crypto.randomUUID()
    localStorage.setItem('arithmetic:attempt:v1:' + id, JSON.stringify({ version: 1, id, roundId: crypto.randomUUID(), questionIndex: 0, left: 9, right: 6, answer: 54, correct: true, elapsedMs: 0, submittedAt: '2026-01-02T00:00:00.000Z' }))
  })
  await expect(cell(page, '9x6')).toHaveText('6')
  await other.close()
})

for (const theme of ['dark', 'light']) for (const width of [1440, 375]) {
  test(`completion table matches existing geometry and readable counts in ${theme} at ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    const bytes = await seed(page, theme)
    const speed = page.getByRole('table', { name: 'Average solve time by ordered multiplication pair', exact: true })
    const a = (await speed.boundingBox())!
    const b = (await table(page).boundingBox())!
    expect(b.y).toBeGreaterThan(a.y + a.height)
    expect(b.width).toBe(a.width)
    expect(b.height).toBe(a.height)
    expect(await cell(page, '12x12').locator('span').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true)
    await expect(cell(page, '12x12').locator('span')).toHaveCSS('font-size', '12px')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`completions-${theme}-${width}-full.png`), fullPage: true })
    await table(page).scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`completions-${theme}-${width}.png`) })
    await cell(page, '12x12').scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`completions-${theme}-${width}-right.png`) })
    const region = page.getByRole('region', { name: 'Multiplication completions map', exact: true })
    await region.focus()
    await page.keyboard.press('End')
    await expect(region).toBeFocused()
    await page.reload()
    expect(await snapshot(page)).toEqual(bytes)
  })
}

test('phone completion grid scrolls natively, with no selectable cells or storage writes', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 320, height: 700 } })
  const page = await context.newPage()
  const bytes = await seed(page)
  await cell(page, '1x2').tap()
  await expect(page.locator('.stats-detail h3')).toHaveCount(0)
  const region = page.getByRole('region', { name: 'Multiplication completions map', exact: true })
  const box = (await cell(page, '1x2').boundingBox())!
  const cdp = await context.newCDPSession(page)
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  for (let step = 1; step <= 8; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 100 * step / 8, y }] })
    await page.waitForTimeout(25)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
  await expect.poll(() => region.evaluate(e => e.scrollLeft)).toBeGreaterThan(20)
  await expect(page.locator('.stats-detail h3')).toHaveCount(0)
  await region.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => region.evaluate(e => e.scrollLeft)).toBeGreaterThan(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await snapshot(page)).toEqual(bytes)
  await context.close()
})

test('real wrong-answer correction counts once and survives cancellation, reload and protected unknown bytes', async ({ page }) => {
  await page.goto('/multiplication')
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  const input = page.getByRole('textbox', { name: 'Answer', exact: true })
  await expect(input).toBeFocused()
  const [left, right] = (await page.getByTestId('question').innerText()).match(/\d+/g)!.map(Number)
  const pair = `${left}x${right}`
  await input.fill('0')
  await input.press('Enter')
  await page.getByRole('link', { name: 'Stats', exact: true }).click()
  await expect(cell(page, pair)).toHaveText('0')
  await expect(page.getByText('Completed: 0 / 144', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Practice', exact: true }).click()
  await input.fill(String(left * right))
  await input.press('Enter')
  await expect(page.getByLabel('Question progress')).toHaveText('2 / 10')
  await input.press('Escape')
  await page.getByRole('link', { name: 'Stats', exact: true }).click()
  await expect(cell(page, pair)).toHaveText('1')
  await expect(page.getByText('Completed: 1 / 144', { exact: true })).toBeVisible()
  await page.evaluate(() => {
    localStorage.setItem('arithmetic:attempt:v99:future', '{ "version": 99, "unknown": "preserve" }')
    localStorage.setItem('arithmetic:attempt:v1:unreadable', '{not json')
  })
  const bytes = await snapshot(page)
  await page.reload()
  await expect(cell(page, pair)).toHaveText('1')
  await expect(page.getByRole('alert')).toContainText('original data has been kept')
  await expect(page.getByText('Completed: 1 / 144', { exact: true })).toBeVisible()
  expect(await snapshot(page)).toEqual(bytes)
})
