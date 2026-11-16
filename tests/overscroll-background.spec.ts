import { expect, test, type Page } from '@playwright/test'

// These checks deliberately leave native wheel/elastic behavior enabled. They
// prove canvas painting, not a physical macOS trackpad's elastic animation.

async function canvasMatchesPage(page: Page, color: string) {
  await expect(page.locator('.app').first()).toHaveCSS('background-color', color)
  for (const selector of ['html', 'body', '#root']) {
    await expect(page.locator(selector)).toHaveCSS('background-color', color)
    await expect(page.locator(selector)).toHaveCSS('overscroll-behavior-y', 'auto')
    expect(await page.locator(selector).evaluate(e => getComputedStyle(e).overflowY)).not.toMatch(/hidden|clip/)
  }
  expect(await page.evaluate(() => {
    const app = document.querySelector('#root > .app')!.getBoundingClientRect()
    const root = document.getElementById('root')!.getBoundingClientRect()
    return app.width >= innerWidth && app.height >= innerHeight && root.height >= app.height
  })).toBe(true)
}

for (const [width, height] of [[1440, 900], [320, 568]]) {
  test(`canvas follows page theme across scrolling and navigation ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.stack ?? error.message))
    await page.goto('/multiplication')
    await page.evaluate(() => {
      localStorage.setItem('arithmetic:theme', 'dark')
      localStorage.setItem('arithmetic:future-history', '{"version":99,"keep":"exact bytes"}')
      localStorage.setItem('unrelated', 'keep me')
    })
    await page.reload()
    const snapshot = () => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(k => k !== 'arithmetic:theme').sort().map(k => [k, localStorage.getItem(k)])))
    const original = await snapshot()
    for (const [theme, color] of [['dark', 'rgb(50, 52, 55)'], ['light', 'rgb(225, 227, 224)']]) {
      if (theme === 'light') await page.getByRole('button', { name: 'Switch to light theme' }).click()
      for (const route of ['Practice', 'Stats']) {
        await page.getByRole('link', { name: route, exact: true }).click()
        await canvasMatchesPage(page, color)
        await page.evaluate(() => scrollTo(0, 0))
        await page.mouse.move(width - 4, height / 2)
        await page.mouse.wheel(0, -800)
        await canvasMatchesPage(page, color)
        if (route === 'Stats') {
          const bottom = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)
          expect(bottom).toBeGreaterThan(0)
          await page.mouse.wheel(0, 10000)
          await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0)
          await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
          await expect.poll(() => page.evaluate(() => Math.abs(scrollY - (document.documentElement.scrollHeight - innerHeight)))).toBeLessThan(2)
        }
        await page.mouse.wheel(0, 800)
        await canvasMatchesPage(page, color)
        await page.screenshot({ path: testInfo.outputPath(`${route}-${theme}-${width}-bottom.png`) })
        await page.evaluate(() => scrollTo(0, 0))
        await page.screenshot({ path: testInfo.outputPath(`${route}-${theme}-${width}-top.png`) })
        await page.reload()
        await canvasMatchesPage(page, color)
        expect(await snapshot()).toEqual(original)
      }
    }
    await page.getByRole('button', { name: 'Switch to dark theme' }).click()
    await canvasMatchesPage(page, 'rgb(50, 52, 55)')
    await page.reload()
    await canvasMatchesPage(page, 'rgb(50, 52, 55)')
    expect(errors).toEqual([])
  })
}

for (const failure of ['write', 'read', 'unknown-theme']) test(`storage ${failure} cannot desynchronize the canvas`, async ({ page }) => {
  await page.goto('/multiplication')
  await page.evaluate(failure => {
    localStorage.setItem('arithmetic:theme', failure === 'unknown-theme' ? 'future-theme' : 'light')
    localStorage.setItem('unrelated', 'exact bytes')
  }, failure)
  if (failure === 'read') await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('Unavailable', 'SecurityError') }
  })
  await page.reload()
  const color = failure === 'write' ? 'rgb(225, 227, 224)' : 'rgb(50, 52, 55)'
  await canvasMatchesPage(page, color)
  if (failure === 'write') await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Full', 'QuotaExceededError') }
  })
  await page.getByRole('button', { name: failure === 'write' ? 'Switch to dark theme' : 'Switch to light theme' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Theme could not be saved' })).toBeVisible()
  await canvasMatchesPage(page, color)
  if (failure !== 'read') expect(await page.evaluate(() => [localStorage.getItem('arithmetic:theme'), localStorage.getItem('unrelated')])).toEqual([failure === 'write' ? 'light' : 'future-theme', 'exact bytes'])
})

test('recovery page retains the stored light canvas without writing history', async ({ page }) => {
  await page.goto('/multiplication')
  await page.evaluate(() => {
    localStorage.setItem('arithmetic:theme', 'light')
    localStorage.setItem('arithmetic:synthetic:journal:v1', 'unknown journal bytes')
  })
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('An interrupted data change needs recovery')
  await canvasMatchesPage(page, 'rgb(225, 227, 224)')
  expect(await page.evaluate(() => localStorage.getItem('arithmetic:synthetic:journal:v1'))).toBe('unknown journal bytes')
})

test('render-blocking stylesheet paints a nonwhite canvas before the app starts', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto(`${baseURL}/multiplication`)
  await expect(page.locator('.app')).toHaveCount(0)
  for (const selector of ['html', 'body', '#root']) await expect(page.locator(selector)).toHaveCSS('background-color', 'rgb(50, 52, 55)')
  await context.close()
})
