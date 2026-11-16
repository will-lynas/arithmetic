import { expect, test, type Page } from '@playwright/test'

const table = (page: Page) => page.getByRole('table', { name: 'Completions by ordered multiplication pair', exact: true })
const cell = (page: Page, pair: string) => table(page).locator(`[data-pair="${pair}"] .stats-cell`)
const legend = (page: Page) => page.getByLabel('Completion count color scale', { exact: true })

async function seed(page: Page, theme: string, counts: number[]) {
  await page.goto('/multiplication/stats')
  await page.evaluate(({ theme, counts }) => {
    localStorage.clear()
    localStorage.setItem('arithmetic:theme', theme)
    counts.forEach((count, pair) => {
      const left = Math.floor(pair / 12) + 1, right = pair % 12 + 1
      for (let i = 0; i < count; i++) {
        const id = crypto.randomUUID()
        localStorage.setItem('arithmetic:attempt:v1:' + id, JSON.stringify({ version: 1, id, roundId: crypto.randomUUID(), questionIndex: 0, left, right, answer: left * right, correct: true, elapsedMs: (pair + 1) * 100, submittedAt: '2026-01-01T00:00:00.000Z' }))
      }
    })
  }, { theme, counts })
  await page.reload()
  await expect(page.locator('.app')).toHaveClass(`app ${theme}`)
  await expect(page.getByRole('alert')).toHaveCount(0)
}

async function palette(page: Page) {
  return page.locator('.stats-page').evaluate(element => {
    const style = getComputedStyle(element)
    const result: Record<string, string> = {}
    for (const token of ['low', 'mid', 'high', 'empty']) {
      const sample = document.createElement('span')
      sample.style.backgroundColor = style.getPropertyValue(`--stats-${token}`)
      element.append(sample)
      result[token] = getComputedStyle(sample).backgroundColor
      sample.remove()
    }
    return result
  })
}

// color-mix() is serialized as color(srgb ...), unlike the rgb() custom-property samples.
async function normalizedFill(page: Page, pair: string) {
  return cell(page, pair).evaluate(element => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = getComputedStyle(element).backgroundColor
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return `rgb(${r}, ${g}, ${b})`
  })
}

for (const theme of ['dark', 'light']) for (const width of [1440, 320]) {
  test(`count heatmap uses the existing palette and exact uncapped counts ${theme} ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 })
    await seed(page, theme, Array.from({ length: 144 }, (_, index) => index % 6))
    const colors = await palette(page)
    for (const [pair, count, token] of [['1x1', 0, 'empty'], ['1x2', 1, 'low'], ['1x4', 3, 'mid'], ['1x6', 5, 'high']] as const) {
      await expect(cell(page, pair)).toHaveText(String(count))
      expect(await normalizedFill(page, pair)).toBe(colors[token])
    }
    expect(await normalizedFill(page, '1x3')).not.toBe(colors.low)
    expect(await normalizedFill(page, '1x3')).not.toBe(colors.mid)
    expect(await normalizedFill(page, '1x5')).not.toBe(colors.mid)
    expect(await normalizedFill(page, '1x5')).not.toBe(colors.high)
    await expect(legend(page)).toHaveText('Fewest 1Most 50')
    await expect(legend(page).locator('.stats-legend-scale')).toHaveCSS('background-image', /linear-gradient/)
    // Keep the new map contained at 320px; the pre-existing accuracy legend is wider than its column there.
    if (width > 320) expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const heading = legend(page)
    expect(await heading.evaluate(e => e.getBoundingClientRect().right <= innerWidth)).toBe(true)
    await table(page).scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`heatmap-${theme}-${width}.png`) })
    await table(page).locator('xpath=../..').screenshot({ path: testInfo.outputPath(`heatmap-map-${theme}-${width}.png`) })
  })
}

for (const theme of ['dark', 'light']) {
  test(`empty and equal positive count scales make no false distinctions ${theme}`, async ({ page }) => {
    await seed(page, theme, [])
    const colors = await palette(page)
    await expect(legend(page)).toHaveText('No completions')
    await expect(legend(page).locator('.stats-legend-scale')).toHaveCSS('background-image', 'none')
    await expect(legend(page).locator('.stats-legend-scale')).toHaveCSS('background-color', colors.empty)
    expect(await normalizedFill(page, '1x1')).toBe(colors.empty)
    await seed(page, theme, [1])
    await expect(legend(page)).toHaveText('1 completion0')
    expect(await normalizedFill(page, '1x1')).toBe(colors.mid)
    await seed(page, theme, [2, 2])
    await expect(legend(page)).toHaveText('2 completions0')
    await expect(legend(page).locator('.stats-legend-scale')).toHaveCSS('background-image', 'none')
    await expect(legend(page).locator('.stats-legend-scale')).toHaveCSS('background-color', colors.mid)
    expect(await normalizedFill(page, '1x1')).toBe(colors.mid)
    expect(await normalizedFill(page, '1x2')).toBe(colors.mid)
    expect(await normalizedFill(page, '1x3')).toBe(colors.empty)
  })
}
