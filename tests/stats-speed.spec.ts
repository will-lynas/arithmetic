import { expect, test, type Page } from '@playwright/test'

const map = (page: Page, metric: string) => page.getByRole('table', { name: `${metric} by ordered multiplication pair`, exact: true })
const cell = (page: Page, metric: string, pair: string) => map(page, metric).locator(`[data-pair="${pair}"]`)
const detail = (page: Page, metric: string) => map(page, metric).locator('xpath=../following-sibling::section[1]')
const accuracy = 'First-try accuracy'
const speed = 'Average solve time'

async function seed(page: Page, theme = 'dark') {
  await page.goto('/stats')
  const bytes = await page.evaluate(theme => {
    localStorage.setItem('arithmetic:theme', theme)
    const base = { version: 1, roundId: crypto.randomUUID(), questionIndex: 0, left: 9, right: 6, answer: 53, correct: false, elapsedMs: 1000, submittedAt: '2026-01-01T00:00:00.000Z', future: { nested: [1, 'unchanged'] } }
    const records = [base, { ...base, correct: true, answer: 54, elapsedMs: 5000 }, { ...base, roundId: crypto.randomUUID(), correct: true, answer: 54, elapsedMs: 3000 }, { ...base, left: 6, right: 9, correct: true, answer: 54, elapsedMs: 0 }, { ...base, left: 1, right: 1 }, { ...base, left: 12, right: 12, correct: true, answer: 144, elapsedMs: 1000000 }]
    return records.map(record => {
      const id = crypto.randomUUID()
      const key = 'arithmetic:attempt:v1:' + id
      const value = JSON.stringify({ ...record, id }, null, 2)
      localStorage.setItem(key, value)
      return [key, value]
    })
  }, theme)
  await page.reload()
  await expect(page.locator('.app')).toHaveClass(`app ${theme}`)
  return bytes
}

test('speed uses independent solved means, ordered operands, neutral unsolved cells and unchanged history bytes', async ({ page }) => {
  const bytes = await seed(page)
  await expect(map(page, speed).locator('.stats-cell')).toHaveCount(144)
  await expect(map(page, accuracy).locator('.stats-cell')).toHaveCount(144)
  await expect(cell(page, speed, '9x6')).toHaveText('4.00 s')
  await expect(cell(page, speed, '9x6')).toHaveAccessibleName(/average solve 4.00 s \(2 solved questions\).*including corrections/)
  await expect(cell(page, accuracy, '9x6')).toHaveText('50%')
  await expect(cell(page, speed, '6x9')).toHaveText('0.00 s')
  await expect(cell(page, speed, '1x1')).toHaveText('—')
  await expect(cell(page, speed, '1x1')).toHaveAccessibleName(/no solved questions \(1 attempted question\)/)
  await expect(cell(page, speed, '2x2')).toHaveAccessibleName(/unattempted/)
  const color = async (pair: string) => cell(page, speed, pair).evaluate(e => getComputedStyle(e).backgroundColor)
  expect(await color('1x1')).toBe(await color('2x2'))
  expect(await color('6x9')).not.toBe(await color('2x2'))
  expect(await color('6x9')).not.toBe(await color('12x12'))
  await expect(page.getByLabel('Solve time color scale')).toContainText('Fastest 0.00 s')
  await expect(page.getByLabel('Solve time color scale')).toContainText('Slowest 1000.00 s')
  await cell(page, speed, '9x6').hover()
  await expect(detail(page, speed)).toContainText('4.00 s (2 solved)')
  await page.getByRole('link', { name: 'Practice', exact: true }).click()
  await page.getByRole('link', { name: 'Stats', exact: true }).click()
  await page.reload()
  expect(await page.evaluate(keys => keys.map(([key]) => [key, localStorage.getItem(key)]), bytes)).toEqual(bytes)
})

for (const metric of [accuracy, speed]) {
  test(`${metric}: transient pointer, keyboard and cross-map details`, async ({ page }) => {
    await page.goto('/stats')
    const other = metric === speed ? accuracy : speed
    const info = detail(page, metric)
    await expect(info).toHaveText('')
    await expect(detail(page, other)).toHaveText('')
    const a = cell(page, metric, '9x6')
    await a.hover()
    await expect(info).toHaveAttribute('aria-label', '9 × 6 details')
    await cell(page, metric, '6x9').hover()
    await expect(info).toHaveAttribute('aria-label', '6 × 9 details')
    await map(page, metric).locator('thead th').first().hover()
    await expect(info).toHaveText('')
    await a.hover()
    const box = (await a.boundingBox())!
    await page.mouse.move(box.x - 2, box.y + box.height / 2)
    await expect(info).toHaveText('')
    await a.click()
    await page.mouse.move(1, 1)
    await expect(a).toBeFocused()
    await expect(info).toHaveText('')
    await page.keyboard.press('ArrowRight')
    await expect(cell(page, metric, '9x7')).toBeFocused()
    await expect(info).toHaveAttribute('aria-label', '9 × 7 details')
    await cell(page, other, '2x2').hover()
    await expect(detail(page, other)).toHaveAttribute('aria-label', '2 × 2 details')
    await expect(info).toHaveText('')
    await page.mouse.move(1, 1)
    await expect(detail(page, other)).toHaveText('')
    await expect(info).toHaveText('')
    await page.keyboard.press('ArrowDown')
    await expect(info).toHaveAttribute('aria-label', '10 × 7 details')
    await map(page, other).locator('thead th').first().hover()
    await expect(info).toHaveText('')
    await page.keyboard.press('ArrowUp')
    await expect(info).toHaveAttribute('aria-label', '9 × 7 details')
    await page.keyboard.press('Tab')
    await expect(info).toHaveText('')
    await page.getByRole('region', { name: metric === speed ? 'Multiplication solve time map' : 'Multiplication accuracy map', exact: true }).focus()
    await page.keyboard.press('Tab')
    await expect(cell(page, metric, '9x7')).toBeFocused()
    await expect(info).toHaveAttribute('aria-label', '9 × 7 details')
    await page.keyboard.press('Shift+Tab')
    await expect(info).toHaveText('')
  })
}

test('empty and equal scales show no false contrast; nearby and extreme means remain legible', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/stats')
  const legend = page.getByLabel('Solve time color scale')
  await expect(legend).toHaveText('Fastest —Slowest —Unsolved')
  await expect(legend.locator('.stats-legend-scale')).toHaveCSS('background-image', 'none')
  const add = async (left: number, ms: number) => page.evaluate(({ left, ms }) => {
    const id = crypto.randomUUID()
    localStorage.setItem('arithmetic:attempt:v1:' + id, JSON.stringify({ version: 1, id, roundId: crypto.randomUUID(), questionIndex: 0, left, right: 1, answer: left, correct: true, elapsedMs: ms, submittedAt: '2026-01-01T00:00:00.000Z' }))
  }, { left, ms })
  await add(1, 4000)
  await page.reload()
  await expect(legend).toContainText('Fastest 4.00 s')
  await expect(legend).toContainText('Slowest 4.00 s')
  await expect(legend.locator('.stats-legend-scale')).toHaveCSS('background-image', 'none')
  await add(2, 4000)
  await page.reload()
  expect(await cell(page, speed, '1x1').evaluate(e => getComputedStyle(e).backgroundColor)).toBe(await cell(page, speed, '2x1').evaluate(e => getComputedStyle(e).backgroundColor))
  await add(3, 4001)
  await page.reload()
  await expect(legend).toContainText('Fastest 4 s')
  await expect(legend).toContainText('Slowest 4.001 s')
  await add(4, Number.MAX_VALUE)
  await page.reload()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await cell(page, speed, '4x1').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true)
  await add(5, 10000000)
  await page.reload()
  expect(await cell(page, speed, '5x1').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true)
})

test('touch taps retain one detail across maps and outside taps clear it', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 } })
  const page = await context.newPage()
  await page.goto('/stats')
  for (const metric of [accuracy, speed]) {
    await cell(page, metric, '9x6').tap()
    await expect(detail(page, metric)).toHaveAttribute('aria-label', '9 × 6 details')
    const other = metric === speed ? accuracy : speed
    await expect(detail(page, other)).toHaveText('')
    await cell(page, metric, '6x9').tap()
    await expect(detail(page, metric)).toHaveAttribute('aria-label', '6 × 9 details')
    await page.touchscreen.tap(1, 1)
    await expect(detail(page, metric)).toHaveText('')
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await context.close()
})

for (const theme of ['dark', 'light']) for (const width of [1440, 375]) {
  test(`speed geometry and screenshots ${theme} ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    await seed(page, theme)
    const neutral = page.getByLabel('Solve time color scale').locator('.stats-legend-empty')
    const neutralLabel = page.getByLabel('Solve time color scale').getByText('Unsolved', { exact: true })
    const swatchBox = (await neutral.boundingBox())!
    const labelBox = (await neutralLabel.boundingBox())!
    expect(Math.abs(swatchBox.y + swatchBox.height / 2 - labelBox.y - labelBox.height / 2)).toBeLessThan(3)
    const info = detail(page, speed)
    const before = await info.boundingBox()
    const accuracyBox = (await map(page, accuracy).boundingBox())!
    const speedBox = (await map(page, speed).boundingBox())!
    expect(speedBox.width).toBe(accuracyBox.width)
    expect(speedBox.height).toBe(accuracyBox.height)
    await page.screenshot({ path: testInfo.outputPath(`speed-${theme}-${width}-empty.png`), fullPage: true })
    await cell(page, speed, '9x6').hover()
    await expect(info).toHaveAttribute('aria-label', '9 × 6 details')
    expect((await info.boundingBox())!.height).toBe(before!.height)
    expect(await map(page, speed).boundingBox()).toMatchObject({ width: speedBox.width, height: speedBox.height })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`speed-${theme}-${width}-hover.png`), fullPage: true })
  })
}
