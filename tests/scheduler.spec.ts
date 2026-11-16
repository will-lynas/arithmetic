import { expect, test, type Page } from '@playwright/test'
import type { AttemptRecord } from '../src/types'
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`
const prefix = 'arithmetic:attempt:v1:'
function history(n: number, left: number, right: number): AttemptRecord[] {
  const roundId = uuid(n)
  return [
    {version:1,id:uuid(n+1),roundId,questionIndex:0,left,right,answer:0,correct:false,elapsedMs:1000,submittedAt:'2026-01-01T00:00:00.000Z'},
    {version:1,id:uuid(n+2),roundId,questionIndex:1,left:2,right:2,answer:4,correct:true,elapsedMs:1000,submittedAt:'2026-01-01T00:00:01.000Z'},
    {version:1,id:uuid(n+3),roundId,questionIndex:2,left:3,right:3,answer:9,correct:true,elapsedMs:1000,submittedAt:'2026-01-01T00:00:02.000Z'},
  ]
}
async function seed(page: Page, rows: AttemptRecord[], cancel = false) {
  return page.evaluate(({rows,cancel,prefix}) => {
    const bytes: Record<string,string> = {}
    for (const row of rows) {
      const key = prefix+row.id, value = JSON.stringify({...row,unknown:{keep:'exact bytes'}})
      localStorage.setItem(key,value); bytes[key] = value
    }
    if (cancel) {
      const key = 'arithmetic:round-cancel:v1:'+rows[0].roundId
      const value = JSON.stringify({version:1,roundId:rows[0].roundId,canceledAt:'2026-01-01T00:01:00.000Z'})
      localStorage.setItem(key,value); bytes[key] = value
      sessionStorage.setItem('arithmetic:round:v1',rows[0].roundId)
    }
    return bytes
  },{rows,cancel,prefix})
}
async function retained(page: Page, bytes: Record<string,string>) {
  expect(await page.evaluate(keys => Object.fromEntries(keys.map(k => [k,localStorage.getItem(k)])),Object.keys(bytes))).toEqual(bytes)
}

test('start, saved advance and restored advance sample full persisted history without touching source bytes', async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-01-01T00:01:00.000Z'))
  await page.addInitScript(() => { Math.random = () => 0.75 })
  await page.goto('/')
  const bytes = await seed(page, history(100,9,6), true)
  await page.reload()
  await page.getByRole('button',{name:'Start',exact:true}).click()
  await expect(page.getByTestId('question')).toHaveAttribute('aria-label','9 times 6')
  const input = page.getByRole('textbox',{name:'Answer'})
  await input.fill('0'); await input.press('Enter')
  await expect(page.getByTestId('question')).toHaveAttribute('aria-label','9 times 6')
  // A different tab's newly saved evidence must be read at the commit boundary,
  // not the initial React closure. The selected question itself stays fixed.
  const otherBytes = await seed(page,history(200,8,7))
  await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage')))
  await page.getByRole('link',{name:'Stats',exact:true}).click()
  await page.getByRole('link',{name:'Practice',exact:true}).click()
  await expect(page.getByTestId('question')).toHaveAttribute('aria-label','9 times 6')
  await input.fill('54'); await input.press('Enter')
  await expect(page.getByTestId('question')).toHaveAttribute('aria-label','8 times 7')
  await expect(page.getByText('2 / 10',{exact:true})).toBeVisible()
  await page.reload()
  await expect(page.getByTestId('question')).toHaveAttribute('aria-label','8 times 7')
  await expect(page.getByText('2 / 10',{exact:true})).toBeVisible()
  await retained(page,{...bytes,...otherBytes})
  await input.fill('0'); await input.press('Enter')
  await page.reload()
  await expect(page.getByTestId('question')).toHaveAttribute('aria-label','8 times 7')
  await input.press('Escape'); await page.reload()
  await expect(page.getByRole('button',{name:'Start',exact:true})).toBeVisible()
  await retained(page,{...bytes,...otherBytes})
})
