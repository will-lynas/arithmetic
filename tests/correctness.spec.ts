import { expect, test } from '@playwright/test'
import type { AttemptRecord } from '../src/types'
const roundId = '30e91bd6-fb88-4645-8c76-22b03751f8b0'
const prefix = 'arithmetic:attempt:v1:'
function record(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {version:1, id:crypto.randomUUID(), roundId, questionIndex:0, left:9, right:6, answer:0, correct:false, elapsedMs:1000, submittedAt:'2026-01-01T00:00:00.000Z', ...overrides}
}
for (const tied of [true, false]) test(`round result and Stats agree with ${tied ? 'tied' : 'reversed'} wall times`, async ({page}) => {
  await page.addInitScript(() => { performance.now = () => 0; Object.defineProperty(document, 'hasFocus', {value:() => true}) })
  await page.goto('/')
  const at = tied ? '2026-01-01T00:00:00.000Z' : '2027-01-01T00:00:00.000Z'
  const attempts = Array.from({length:9}, (_,questionIndex) => record({questionIndex,left:1,right:1,answer:1,correct:true,elapsedMs:0}))
  attempts.push(record({id:'f26a9d79-6343-457b-8b54-28aa2e85a912',questionIndex:9,submittedAt:at}))
  await page.evaluate(attempts => { for (const a of attempts) localStorage.setItem('arithmetic:attempt:v1:'+a.id,JSON.stringify(a)) }, attempts)
  await page.reload()
  await page.clock.setFixedTime(new Date('2026-01-01T00:00:00.000Z'))
  await page.evaluate(() => {
    const originalUUID = crypto.randomUUID.bind(crypto)
    let first = true
    crypto.randomUUID = () => { if (first) { first = false; return '126a9d79-6343-457b-8b54-28aa2e85a912' }; return originalUUID() }
  })
  await expect(page.getByText('10 / 10',{exact:true})).toBeVisible()
  await page.getByRole('textbox',{name:'Answer'}).fill('54')
  await page.getByRole('textbox',{name:'Answer'}).press('Enter')
  await expect(page.locator('.result-metrics > div').nth(1).locator('strong')).toHaveText('9 / 10')
  await page.getByRole('link',{name:'Stats',exact:true}).click()
  await expect(page.getByRole('table', { name: 'First-try accuracy by ordered multiplication pair', exact: true }).locator('[data-pair="9x6"]')).toHaveText('0%')
  await page.reload()
  await expect(page.getByRole('table', { name: 'First-try accuracy by ordered multiplication pair', exact: true }).locator('[data-pair="9x6"]')).toHaveText('0%')
})

test('two simultaneous restores have one owner, release on close and reload retain partial attempts', async ({page, context}) => {
  await page.goto('/stats')
  const seeded = record({answer:54,correct:true, extra:{retained:'legacy'}} as Partial<AttemptRecord>)
  const bytes = JSON.stringify(seeded)
  await page.evaluate(({key,bytes}) => localStorage.setItem(key,bytes), {key:prefix+seeded.id,bytes})
  const other = await context.newPage()
  await page.addInitScript(() => { Math.random = () => 0.1 })
  await other.addInitScript(() => { Math.random = () => 0.8 })
  await Promise.all([page.goto('/'),other.goto('/')])
  await expect.poll(async () => (await Promise.all([page,other].map(p => p.getByRole('textbox',{name:'Answer'}).count()))).reduce((a,b) => a+b,0)).toBe(1)
  const owner = await page.getByRole('textbox',{name:'Answer'}).count() ? page : other
  const waiting = owner === page ? other : page
  await expect(waiting.getByRole('button',{name:'Start',exact:true})).toBeEnabled()
  await owner.close()
  await waiting.reload()
  const input = waiting.getByRole('textbox',{name:'Answer'})
  await expect(input).toBeVisible()
  await expect(waiting.getByText('2 / 10',{exact:true})).toBeVisible()
  const pair = await waiting.getByTestId('question').innerText()
  await input.fill('0'); await input.press('Enter')
  const saved = await waiting.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k,localStorage.getItem(k)])))
  expect(saved[prefix+seeded.id]).toBe(bytes)
  await waiting.reload()
  await expect(waiting.getByTestId('question')).toHaveText(pair)
  expect(await waiting.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k,localStorage.getItem(k)])))).toEqual(saved)
})

test('a duplicated active round starts independently; simultaneous submissions never share identity', async ({page,context}) => {
  await page.goto('/'); await page.getByRole('button',{name:'Start',exact:true}).click()
  const input = page.getByRole('textbox',{name:'Answer'})
  await input.fill('0'); await input.press('Enter')
  const other = await context.newPage(); await other.goto('/')
  await expect(other.getByRole('button',{name:'Start',exact:true})).toBeEnabled()
  await other.getByRole('button',{name:'Start',exact:true}).click()
  await Promise.all([page,other].map(async p => {
    const input = p.getByRole('textbox',{name:'Answer'})
    await input.fill('-1'); await input.press('Enter')
  }))
  const attempts = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('arithmetic:attempt:v1:')).map(k => JSON.parse(localStorage.getItem(k)!)))
  expect(attempts).toHaveLength(3)
  expect(new Set(attempts.map(a => a.roundId)).size).toBe(2)
  await page.getByRole('link',{name:'Stats',exact:true}).click()
  await expect(page.locator('.stats-summary > div').first().locator('dd')).toHaveText('2')
  await page.getByRole('link',{name:'Practice',exact:true}).click()
  await page.reload()
  await expect(page.getByRole('textbox',{name:'Answer'})).toBeVisible()
  await other.reload()
  await expect(other.getByRole('textbox',{name:'Answer'})).toBeVisible()
})
