import { expect, test, type Page } from '@playwright/test'

async function pan(page: Page, x: number, y: number, dx: number, dy: number) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  for (let step = 1; step <= 8; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * step / 8, y: y + dy * step / 8 }] })
    await page.waitForTimeout(25)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}

for (const theme of ['dark', 'light']) test(`touch maps support taps and native scrolling without accidental selection in ${theme}`, async ({ browser, baseURL }, testInfo) => {
  const context = await browser.newContext({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 375, height: 812 } })
  const page = await context.newPage()
  await page.goto('/stats')
  await page.evaluate(theme => {
    localStorage.setItem('arithmetic:theme', theme)
    const id = crypto.randomUUID()
    localStorage.setItem('arithmetic:attempt:v1:' + id, JSON.stringify({ version: 1, id, roundId: crypto.randomUUID(), questionIndex: 0, left: 1, right: 6, answer: 6, correct: true, elapsedMs: 3400, submittedAt: '2026-01-01T00:00:00.000Z' }))
  }, theme)
  await page.reload()
  await expect(page.locator('.app')).toHaveClass(`app ${theme}`)
  for (const metric of ['First-try accuracy', 'Average solve time']) {
    const table = page.getByRole('table', { name: `${metric} by ordered multiplication pair`, exact: true })
    const scroll = table.locator('..')
    const info = table.locator('xpath=../following-sibling::section[1]')
    await page.touchscreen.tap(1, 1)
    await table.locator('[data-pair="1x4"]').scrollIntoViewIfNeeded()
    const box = (await table.locator('[data-pair="1x4"]').boundingBox())!
    await pan(page, box.x + box.width / 2, box.y + box.height / 2, -160, 0)
    await expect.poll(() => scroll.evaluate(e => e.scrollLeft)).toBeGreaterThan(30)
    await expect(info).toHaveText('')
    await table.locator('[data-pair="1x6"]').tap()
    await expect(info).toHaveAttribute('aria-label', '1 × 6 details')
    const tapped = (await table.locator('[data-pair="1x6"]').boundingBox())!
    const before = await page.evaluate(() => scrollY)
    // Near the page bottom, swipe down rather than asserting scroll beyond its boundary.
    const dy = await page.evaluate(() => scrollY > document.documentElement.scrollHeight - innerHeight - 160 ? 120 : -120)
    await pan(page, tapped.x + tapped.width / 2, tapped.y + tapped.height / 2, 0, dy)
    await expect.poll(() => page.evaluate(before => Math.abs(scrollY - before), before)).toBeGreaterThan(20)
    await expect(info).toHaveAttribute('aria-label', '1 × 6 details')
    await info.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`stats-touch-${metric === 'Average solve time' ? 'speed' : 'accuracy'}-${theme}.png`) })
  }
  const accuracy = page.getByRole('table', { name: 'First-try accuracy by ordered multiplication pair', exact: true })
  await accuracy.locator('[data-pair="2x2"]').tap()
  await expect(accuracy.locator('xpath=../following-sibling::section[1]')).toHaveAttribute('aria-label', '2 × 2 details')
  const speed = page.getByRole('table', { name: 'Average solve time by ordered multiplication pair', exact: true })
  await expect(speed.locator('xpath=../following-sibling::section[1]')).toHaveText('')
  await page.getByRole('link', { name: 'Practice', exact: true }).tap()
  await page.getByRole('link', { name: 'Stats', exact: true }).tap()
  await expect(page.locator('.stats-detail').filter({ has: page.locator('h3') })).toHaveCount(0)
  await context.close()
})
