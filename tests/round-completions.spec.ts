import { expect, test, type Page } from '@playwright/test'

const table = (page: Page) => page.getByRole('table', { name: 'Round calculations', exact: true })
const snapshot = (page: Page) => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)])))
const pairs = [[9,6],[6,9],[2,3],[9,6],[12,12],[1,2],[3,4],[5,6],[7,8],[9,6]]

async function multiplication(page: Page, theme = 'dark') {
  await page.goto('/multiplication')
  await page.evaluate(({pairs,theme}) => {
    localStorage.setItem('arithmetic:theme',theme)
    localStorage.setItem('arithmetic:future-preference','{ "retained": true }')
    const roundId=crypto.randomUUID(), old=crypto.randomUUID()
    const put=(roundId:string,questionIndex:number,left:number,right:number,correct=true,elapsedMs=1000) => {
      const id=crypto.randomUUID()
      localStorage.setItem('arithmetic:attempt:v1:'+id,JSON.stringify({version:1,id,roundId,questionIndex,left,right,answer:correct?left*right:0,correct,elapsedMs,submittedAt:'2026-01-01T00:00:00.000Z',unknown:{keep:true}},null,2))
    }
    put(old,0,9,6,false);put(old,0,9,6,true,2000);put(old,0,9,6,true,3000)
    put(old,1,9,6);put(old,2,2,3,false)
    localStorage.setItem('arithmetic:round-cancel:v1:'+old,JSON.stringify({version:1,roundId:old,canceledAt:'2026-01-01T00:00:00.000Z'}))
    // Deliberately insert out of order. Presentation order is the index, not key order.
    for(const i of [8,0,7,1,6,2,5,3,4]) {
      const [left,right]=pairs[i]
      if(i===0)put(roundId,i,left,right,false)
      put(roundId,i,left,right,true,2000)
    }
    put(roundId,9,9,6,false,0)
    sessionStorage.setItem('arithmetic:round:v1',roundId)
  },{pairs,theme})
  await page.reload()
  await expect(page.locator('.app')).toHaveClass(`app ${theme}`)
  await expect(page.getByLabel('Question progress')).toHaveText('10 / 10')
}

async function finishMultiplication(page: Page, failSave=false) {
  const input=page.getByRole('textbox',{name:'Answer',exact:true})
  await input.fill('0');await input.press('Enter')
  await expect(table(page)).toHaveCount(0)
  await input.fill('54')
  if(failSave) await page.evaluate(()=>{
    const original=Storage.prototype.setItem
    ;(window as any).restoreWrites=()=>{Storage.prototype.setItem=original}
    Storage.prototype.setItem=function(k,v){if(k.startsWith('arithmetic:attempt:'))throw new DOMException('Full','QuotaExceededError');original.call(this,k,v)}
  })
  await input.press('Enter')
  if(failSave) {
    await expect(page.getByRole('button',{name:'Retry saving'})).toBeVisible()
    await expect(table(page)).toHaveCount(0)
    await expect(page.getByRole('heading',{name:'Round complete'})).toHaveCount(0)
    await page.evaluate(()=>(window as any).restoreWrites())
    await page.getByRole('button',{name:'Retry saving'}).click()
  }
  await expect(page.getByRole('heading',{name:'Round complete'})).toBeVisible()
}

const expectedMultiplication = pairs.map(([a,b])=>[`${a} × ${b} = ${a*b}`,a===9&&b===6?'5':'1'])
async function expectRows(page:Page, expected:string[][]) {
  await expect(table(page).getByRole('columnheader')).toHaveText(['Calculation','Overall completions'])
  const rows=table(page).locator('tbody tr')
  await expect(rows).toHaveCount(expected.length)
  expect(await rows.evaluateAll(rows=>rows.map(row=>[...row.querySelectorAll('th,td')].map(cell=>cell.textContent)))).toEqual(expected)
}

test('completed multiplication shows every presentation with final lifetime counts, retries once, and unchanged history',async({page})=>{
  await multiplication(page)
  const before=await snapshot(page)
  await expect(table(page)).toHaveCount(0)
  await finishMultiplication(page,true)
  await expectRows(page,expectedMultiplication)
  const saved=await snapshot(page)
  for(const [key,value] of Object.entries(before))expect(saved[key]).toBe(value)
  expect(Object.keys(saved).length-Object.keys(before).length).toBe(2)
  await expect(page.getByRole('button',{name:'New round'})).toBeFocused()
  await page.getByRole('link',{name:'Stats',exact:true}).click()
  const stats=page.getByRole('table',{name:'Completions by ordered multiplication pair',exact:true})
  for(const [a,b] of pairs)await expect(stats.locator(`[data-pair="${a}x${b}"]`)).toHaveText(a===9&&b===6?'5':'1')
  await page.getByRole('link',{name:'Practice',exact:true}).click()
  await page.reload()
  await expectRows(page,expectedMultiplication)
  expect(await snapshot(page)).toEqual(saved)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('textbox',{name:'Answer',exact:true})).toBeFocused()
  await expect(table(page)).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button',{name:'Start',exact:true})).toBeVisible()
  await expect(table(page)).toHaveCount(0)
})

for(const theme of ['dark','light'])for(const width of [1440,320])test(`round list fits ${theme} at ${width}`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:1000})
  await multiplication(page,theme);await finishMultiplication(page)
  await expectRows(page,expectedMultiplication)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  expect(await table(page).evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true)
  const before=await snapshot(page)
  await page.screenshot({path:testInfo.outputPath(`round-${theme}-${width}.png`),fullPage:true})
  expect(await snapshot(page)).toEqual(before)
})
