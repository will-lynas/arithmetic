import { expect, test, type Page } from '@playwright/test'

const prefix = 'arithmetic:quadratics:'
const labels = ['First x coefficient', 'First constant', 'Second x coefficient', 'Second constant']
const fields = (page: Page) => labels.map(name => page.getByRole('textbox', {name, exact: true}))
const records = (page: Page) => page.evaluate(prefix => Object.entries(localStorage).filter(([key]) => key.startsWith(prefix)).map(([, bytes]) => JSON.parse(bytes)), prefix)

async function answer(page: Page, { swap = false, negate = false } = {}) {
  const q = await page.getByTestId('quadratic-question').evaluate(el => ({b: Number(el.getAttribute('data-b')), c: Number(el.getAttribute('data-c'))}))
  const d = Math.sqrt(q.b ** 2 - 4 * q.c)
  const n = negate ? -1 : 1
  const pair = [(q.b - d) / 2, (q.b + d) / 2]
  if (swap) pair.reverse()
  const values = [n, n * pair[0], n, n * pair[1]]
  for (const [i, field] of fields(page).entries()) await field.fill(String(values[i]))
}

test('keyboard practice accepts signed reversed factors, then shows per-question Stats on reload', async ({page}) => {
  await page.goto('/quadratics')
  await expect(page.getByRole('link', {name:'Factorising quadratics'})).toHaveAttribute('aria-current', 'page')
  await page.getByRole('button', {name:'Start', exact:true}).click()
  await expect(fields(page)[0]).toBeFocused()
  for (const field of fields(page)) await expect(field).toHaveValue('')
  await page.keyboard.press('Tab')
  await expect(fields(page)[1]).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(fields(page)[0]).toBeFocused()
  await fields(page)[0].fill('1')
  await fields(page)[1].fill('1.5')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status')).toHaveText('Enter four whole numbers')
  await expect(fields(page)[1]).toBeFocused()
  await expect(fields(page)[0]).toHaveAttribute('data-malformed', 'false')
  expect((await records(page)).filter(e => e.kind === 'attempt')).toHaveLength(0)
  for (const field of fields(page)) await field.fill('0')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('status')).toHaveText('Incorrect — try again')
  await expect(fields(page)[0]).toBeFocused()
  expect((await records(page)).filter(e => e.kind === 'attempt')).toHaveLength(1)
  const first = await page.getByTestId('quadratic-question').textContent()
  for (let i = 0; i < 5; i++) {
    await answer(page, {swap:true, negate:true})
    if (i === 0) await fields(page)[0].fill('−1')
    await page.keyboard.press('Enter')
    if (i < 4) {
      await expect(page.getByLabel('Question progress')).toHaveText(`${i + 2} / 5`)
      await expect(fields(page)[0]).toBeFocused()
      await expect(fields(page)[0]).toHaveValue('')
    }
  }
  await expect(page.getByRole('region', {name:'Round result'})).toContainText('4 / 5')
  await page.getByRole('link', {name:'Stats', exact:true}).click()
  await expect(page).toHaveURL(/\/quadratics\/stats$/)
  await page.reload()
  const table = page.getByRole('table', {name:'Statistics by quadratic'})
  const row = table.getByRole('row').filter({has:page.getByRole('rowheader', {name:first!, exact:true})})
  await expect(row.getByRole('cell')).toHaveText(['1', '0%', /\d+\.\d{2} s/])
  await expect(page.getByLabel('Quadratics summary')).toContainText('80%')
  await page.goBack()
  await expect(page.getByRole('region', {name:'Round result'})).toBeVisible()
})

test('mobile layout supports signed input, pause, reload and cancel without cross-mode writes', async ({browser}) => {
  const page = await browser.newPage({viewport:{width:320, height:568}, hasTouch:true, isMobile:true})
  try {
    await page.goto('/quadratics/stats')
    await expect(page.getByLabel('Quadratics summary')).toContainText('—')
    await page.getByRole('button', {name:'Switch to light theme'}).tap()
    await page.getByRole('link', {name:'Practice', exact:true}).tap()
    await page.getByRole('button', {name:'Start', exact:true}).tap()
    await expect(fields(page)[0]).toBeFocused()
    const question = await page.getByTestId('quadratic-question').textContent()
    const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth === innerWidth)
    expect(await noOverflow()).toBe(true)
    for (const field of fields(page)) {
      const box = await field.boundingBox()
      expect(box?.width).toBeGreaterThanOrEqual(44)
      expect(box?.height).toBeGreaterThanOrEqual(44)
    }
    await answer(page)
    await fields(page)[0].fill('+1')
    await fields(page)[1].fill('999')
    await page.getByRole('button', {name:'Submit', exact:true}).tap()
    await expect(page.getByRole('status')).toHaveText('Incorrect — try again')
    await page.getByRole('link', {name:'Stats', exact:true}).tap()
    await expect(page.getByLabel('Quadratics summary')).toContainText('0%')
    expect(await noOverflow()).toBe(true)
    await page.keyboard.press('Escape')
    await page.getByRole('link', {name:'Practice', exact:true}).tap()
    await expect(fields(page)[1]).toHaveValue('999')
    await page.reload()
    await expect(page.getByTestId('quadratic-question')).toHaveText(question!)
    await answer(page)
    await fields(page)[0].fill('+1')
    await page.getByRole('button', {name:'Submit', exact:true}).tap()
    await expect(page.getByLabel('Question progress')).toHaveText('2 / 5')
    await page.getByRole('button', {name:'Cancel', exact:true}).tap()
    await expect(page.getByRole('button', {name:'Start', exact:true})).toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', {name:'Start', exact:true})).toBeVisible()
    expect((await records(page)).map(e => e.kind).sort()).toEqual(['attempt','attempt','cancel','start'])
    expect(await page.evaluate(() => Object.keys(localStorage).filter(key => !key.startsWith('arithmetic:quadratics:')))).toEqual(['arithmetic:theme'])
  } finally { await page.close() }
})

test('an unverified write does not advance and Retry saving reuses the original event', async ({page}) => {
  await page.goto('/quadratics')
  await page.getByRole('button', {name:'Start', exact:true}).click()
  await answer(page)
  await page.evaluate(() => {
    const setter = Storage.prototype.setItem
    let attempts = 0
    Storage.prototype.setItem = function (key, bytes) {
      if (!key.startsWith('arithmetic:quadratics:') || JSON.parse(bytes).kind !== 'attempt') return setter.call(this, key, bytes)
      if (++attempts === 1) {
        sessionStorage.setItem('failed-attempt', bytes)
        return // Simulate a storage write silently refused.
      }
      return setter.call(this, key, bytes)
    }
  })
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alert')).toContainText('could not be saved')
  await expect(page.getByLabel('Question progress')).toHaveText('1 / 5')
  expect((await records(page)).filter(e => e.kind === 'attempt')).toHaveLength(0)
  await page.getByRole('button', {name:'Retry saving'}).click()
  await expect(page.getByLabel('Question progress')).toHaveText('2 / 5')
  await expect(fields(page)[0]).toBeFocused()
  expect(await page.evaluate(() => Object.values(localStorage).filter(bytes => bytes === sessionStorage.getItem('failed-attempt')).length)).toBe(1)
})
