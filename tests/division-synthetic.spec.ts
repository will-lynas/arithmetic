import { expect, test, type Page } from '@playwright/test'
import type { DivisionAttempt, DivisionEvent } from '../src/division'
const bytes=(page:Page)=>page.evaluate(()=>({...localStorage}))
const summary=(page:Page)=>page.locator('.division-stats-summary dd')
async function open(page:Page) {
  await page.locator('body').click({position:{x:1,y:1}})
  await page.keyboard.press('Control+Alt+Shift+KeyS')
  await expect(page.getByRole('dialog',{name:'Synthetic data'})).toBeVisible()
  await expect(page.getByRole('button',{name:'Cancel',exact:true})).toBeFocused()
}
async function seed(page:Page) {
  await open(page)
  await page.getByRole('button',{name:'Load synthetic data',exact:true}).click()
  await expect(page.getByRole('button',{name:'Cancel',exact:true})).toBeFocused()
  await page.getByRole('button',{name:'Replace all practice data',exact:true}).click()
  await expect(page.getByRole('status')).toHaveText('Synthetic data loaded.')
  await page.getByRole('button',{name:'Cancel',exact:true}).click()
}
// Independent acceptance oracle over the actual saved events, not UI aggregates
// or a second fixture/demo source. Presentation identity includes the full problem.
function expected(records:Record<string,string>) {
  const events=Object.entries(records).filter(([k])=>k.startsWith('arithmetic:division:event:v1:')).map(([,v])=>JSON.parse(v) as DivisionEvent)
  const groups=new Map<string,DivisionAttempt[]>()
  for(const e of events)if(e.kind==='attempt') {
    const key=[e.roundId,e.questionIndex,e.dividend,e.divisor,e.quotient,e.remainder].join(':')
    groups.set(key,[...(groups.get(key)??[]),e])
  }
  const presentations=[...groups.values()].map(g=>g.sort((a,b)=>a.sequence-b.sequence))
  const metrics=(p:DivisionAttempt[][])=>{
    const solved=p.flatMap(g=>g.find(e=>e.correct)??[])
    return [String(p.length),`${Number((100*p.filter(g=>g[0].correct).length/p.length).toFixed(1))}%`,`${(solved.reduce((n,e)=>n+e.elapsedMs,0)/solved.length/1000).toFixed(2)} s`]
  }
  const complete=events.filter(e=>e.kind==='start' && !events.some(c=>c.kind==='cancel' && c.roundId===e.roundId) && e.questions.every((q,i)=>events.some(a=>a.kind==='attempt' && a.roundId===e.roundId && a.questionIndex===i && a.correct && a.dividend===q.dividend && a.divisor===q.divisor && a.quotient===q.quotient && a.remainder===q.remainder)))
  return {summary:[...metrics(presentations),String(complete.length)],rows:Array.from({length:12},(_,i)=>metrics(presentations.filter(g=>g[0].divisor===i+1))),events}
}
async function check(page:Page,records:Record<string,string>) {
  const oracle=expected(records)
  expect(oracle.summary[0]).toBe('168');expect(oracle.summary[3]).toBe('12')
  await expect(summary(page)).toHaveText(oracle.summary,{useInnerText:true})
  const rows=page.getByRole('table',{name:'Division statistics by divisor'}).locator('tbody tr')
  for(const [i,row]of oracle.rows.entries()) {
    await expect(rows.nth(i).getByRole('cell').first()).toHaveText(row[0])
    await expect(rows.nth(i).locator('summary')).toHaveText(row.slice(1))
  }
  await expect(page.getByRole('alert')).toHaveCount(0)
}
const errors=new WeakMap<Page,string[]>()
test.beforeEach(({page})=>{const found:string[]=[];errors.set(page,found);page.on('pageerror',e=>found.push(e.stack??e.message));page.on('console',e=>{if(e.type()==='error')found.push(e.text())})})
test.afterEach(({page})=>expect(errors.get(page)).toEqual([]))

test('hidden real replacement on Division Stats refreshes both tabs and restores exact original strings',async({page,context},info)=>{
  await page.goto('/division/stats?demo=1&sample=1')
  await expect(summary(page)).toHaveText(['0','—','—','0'],{useInnerText:true})
  await expect(page.getByRole('button',{name:/synthetic|backup|demo|data tools/i})).toHaveCount(0)
  const original={'arithmetic:division:event:v9:future':' { "version":9, "unknown":true }\n','arithmetic:division:event:v1:broken':'{','arithmetic:attempt:v9:archived':' untouched\u0000bytes ','arithmetic:round:v8':' old round ','arithmetic:theme':'light','unrelated:keep':' exact string '}
  await page.evaluate(o=>{for(const[k,v]of Object.entries(o))localStorage.setItem(k,v)},original)
  await page.reload()
  const other=await context.newPage();await other.goto('/division/stats')
  await open(page);expect(await bytes(page)).toEqual(original)
  await page.getByRole('button',{name:'Load synthetic data',exact:true}).click()
  await page.keyboard.press('Enter');expect(await bytes(page)).toEqual(original)
  await seed(page)
  const loaded=await bytes(page),backup=loaded['arithmetic:synthetic:backup:v1']
  await check(page,loaded);await check(other,loaded)
  const events=expected(loaded).events
  expect(new Set(events.filter(e=>e.kind==='start').map(e=>e.questions.length))).toEqual(new Set([5,10]))
  await page.screenshot({path:info.outputPath('seeded-real-division-stats.png'),fullPage:true})
  await page.reload();await check(page,loaded);expect(await bytes(page)).toEqual(loaded)
  await page.getByRole('link',{name:'Practice',exact:true}).click()
  await page.getByRole('button',{name:'Start',exact:true}).click()
  await expect(page.getByLabel('Question progress')).toHaveText('1 / 5')
  const quotient=page.getByRole('textbox',{name:'Quotient',exact:true})
  await expect(quotient).toBeFocused();await quotient.press('Escape')
  await page.getByRole('link',{name:'Stats',exact:true}).click();await check(page,loaded)
  await page.getByRole('link',{name:'Multiplication',exact:true}).click()
  await page.getByRole('link',{name:'Stats',exact:true}).click()
  await expect(page.getByRole('table')).toHaveCount(3)
  await expect(page.getByRole('table',{name:'Completions by ordered multiplication pair',exact:true}).locator('[data-pair="1x6"]')).toHaveText('5')
  await page.goto('/division/stats');await seed(page)
  expect((await bytes(page))['arithmetic:synthetic:backup:v1']).toBe(backup)
  await open(page);await page.getByRole('button',{name:'Restore backup',exact:true}).click()
  await expect(page.getByRole('button',{name:'Cancel',exact:true})).toBeFocused()
  await page.getByRole('button',{name:'Restore original backup',exact:true}).click()
  await expect(page.getByRole('status')).toHaveText('Original backup restored.')
  await page.getByRole('button',{name:'Cancel',exact:true}).click()
  const restored=await bytes(page)
  expect(Object.fromEntries(Object.entries(restored).filter(([k])=>!k.startsWith('arithmetic:synthetic:')))).toEqual(original)
  expect(restored['arithmetic:synthetic:backup:v1']).toBe(backup)
  await expect(summary(other)).toHaveText(['0','—','—','0'],{useInnerText:true})
  await other.reload();await expect(summary(other)).toHaveText(['0','—','—','0'],{useInnerText:true})
  await page.reload();expect(await bytes(page)).toEqual(restored);await other.close()
})

test.describe('seeded Division Stats touch and themes',()=>{
  test.use({isMobile:true,hasTouch:true})
  for(const theme of ['dark','light'])for(const width of [320,375])test(`${theme} ${width}px real seeded values and phone actions`,async({page},info)=>{
    await page.setViewportSize({width,height:740});await page.goto('/division/stats')
    if(theme==='light')await page.getByRole('button',{name:'Switch to light theme'}).tap()
    await seed(page);const loaded=await bytes(page);await check(page,loaded)
    await expect(page.locator('.app')).toHaveClass(`app ${theme}`)
    for(const metric of await summary(page).all()) {
      const bounds=await metric.evaluate(dd=>{
        const range=document.createRange();range.selectNodeContents(dd.querySelector('summary')??dd)
        return {textRight:range.getBoundingClientRect().right,columnRight:dd.parentElement!.getBoundingClientRect().right}
      })
      expect(bounds.textRight).toBeLessThanOrEqual(bounds.columnRight+0.5)
    }
    await summary(page).nth(2).locator('summary').tap()
    const box=(await summary(page).nth(2).locator('.division-stat-count').boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await page.screenshot({path:info.outputPath(`seeded-${theme}-${width}.png`),fullPage:true})
    await page.getByRole('link',{name:'Practice',exact:true}).tap()
    await page.getByRole('button',{name:'Start',exact:true}).tap()
    const q=page.getByRole('textbox',{name:'Quotient',exact:true}),r=page.getByRole('textbox',{name:'Remainder',exact:true})
    await expect(q).toBeFocused();await q.fill('0');await r.fill('0')
    await page.getByRole('button',{name:'Submit',exact:true}).tap()
    await expect(q).toBeFocused();await expect(page.getByRole('status')).toContainText('Incorrect')
    await page.getByRole('button',{name:'Cancel',exact:true}).tap()
    await expect(page.getByRole('button',{name:'Start',exact:true})).toBeVisible()
    await expect(page.getByRole('button',{name:/synthetic|backup|demo|data tools/i})).toHaveCount(0)
  })
})
