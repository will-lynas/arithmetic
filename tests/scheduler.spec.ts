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
    if (cancel) for (const roundId of new Set(rows.map(row => row.roundId))) {
      const key = 'arithmetic:round-cancel:v1:'+roundId
      const value = JSON.stringify({version:1,roundId,canceledAt:'2026-01-01T00:01:00.000Z'})
      localStorage.setItem(key,value); bytes[key] = value
      sessionStorage.setItem('arithmetic:round:v1',rows[0].roundId)
    }
    return bytes
  },{rows,cancel,prefix})
}
async function retained(page: Page, bytes: Record<string,string>) {
  expect(await page.evaluate(keys => Object.fromEntries(keys.map(k => [k,localStorage.getItem(k)])),Object.keys(bytes))).toEqual(bytes)
}

test('fresh history finishes a spaced first-coverage round with correction and durable completion',async({page})=>{
  await page.addInitScript(()=>{
    let state=73
    Math.random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32}
  })
  await page.goto('/')
  await page.getByRole('button',{name:'Start',exact:true}).click()
  const seen:string[]=[]
  for(let i=0;i<10;i++) {
    const question=page.getByTestId('question'), input=page.getByRole('textbox',{name:'Answer'})
    await expect(input).toBeFocused()
    const label=(await question.getAttribute('aria-label'))!
    const [left,right]=label.split(' times ').map(Number)
    expect(seen.slice(-2)).not.toContain(label)
    expect(seen.slice(-2)).not.toContain(`${right} times ${left}`)
    if(i===0) {
      await input.fill('0'); await input.press('Enter')
      await expect(question).toHaveAttribute('aria-label',label)
    }
    await input.fill(String(left!*right!)); await input.press('Enter')
    seen.push(label)
  }
  expect(new Set(seen).size).toBe(10)
  await expect(page.getByRole('button',{name:'New round',exact:true})).toBeVisible()
  const bytes=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('arithmetic:attempt:'))))
  expect(Object.keys(bytes)).toHaveLength(11)
  expect(Object.values(bytes).map(s=>JSON.parse(s)).filter(a=>a.correct)).toHaveLength(10)
  await page.reload()
  await expect(page.getByRole('button',{name:'New round',exact:true})).toBeVisible()
  await retained(page,bytes)
})

test('lifetime coverage survives old canceled history, correction, advance and restore without rewriting source bytes', async ({page}) => {
  await page.addInitScript(() => { Math.random = () => 0.005 })
  await page.goto('/')
  const rows = Array.from({length:263},(_,i) => ({
    version:1 as const,id:uuid(10000+i),roundId:uuid(20000+i),questionIndex:0,
    left:i<3 ? 1 : 2,right:i<3 ? 1 : 2,answer:i<3 ? 1 : 4,correct:true,elapsedMs:1000,
    submittedAt:new Date(Date.parse('2026-01-01T00:00:00.000Z')+i*1000).toISOString(),
  }))
  const bytes = await seed(page,rows)
  const cancels = await page.evaluate(rows => {
    const bytes: Record<string,string> = {}
    for (const row of rows) {
      const key = 'arithmetic:round-cancel:v1:'+row.roundId
      const value = JSON.stringify({version:1,roundId:row.roundId,canceledAt:row.submittedAt,unknown:'retain'})
      localStorage.setItem(key,value); bytes[key] = value
    }
    sessionStorage.setItem('arithmetic:round:v1',rows.at(-1)!.roundId)
    return bytes
  },rows)
  await page.reload()
  await page.getByRole('button',{name:'Start',exact:true}).click()
  // The single weighted draw excludes 1x1's completed lifetime deficit; using
  // only the latest 256 presentations would incorrectly pick 1x1 here.
  await expect(page.getByTestId('question')).toHaveAttribute('aria-label','1 times 2')
  const input = page.getByRole('textbox',{name:'Answer'})
  await input.fill('0'); await input.press('Enter')
  await expect(page.getByTestId('question')).toHaveAttribute('aria-label','1 times 2')
  await input.fill('2'); await input.press('Enter')
  await expect(page.getByTestId('question')).toHaveAttribute('aria-label','1 times 3')
  await page.reload()
  await expect(page.getByTestId('question')).toHaveAttribute('aria-label','1 times 3')
  await expect(page.getByText('2 / 10',{exact:true})).toBeVisible()
  await retained(page,{...bytes,...cancels})
})

test('start, saved advance and restored advance sample full persisted history without touching source bytes', async ({page}) => {
  await page.clock.setFixedTime(new Date('2026-01-01T00:01:00.000Z'))
  await page.addInitScript(() => { Math.random = () => Number(sessionStorage.getItem('test:draw') ?? '0.7') })
  await page.goto('/')
  const covered = Array.from({length:432},(_,i) => {
    const left=Math.floor(i/36)+1, right=Math.floor(i/3)%12+1
    return {version:1 as const,id:uuid(10000+i),roundId:uuid(20000+i),questionIndex:0,
      left,right,answer:left*right,correct:true,elapsedMs:1000,submittedAt:'2025-01-01T00:00:00.000Z'}
  })
  const bytes = {...await seed(page,covered,true),...await seed(page, history(100,9,6), true)}
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
  await page.evaluate(() => sessionStorage.setItem('test:draw','0.6'))
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
