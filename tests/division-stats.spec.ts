import { expect, test, type Page } from '@playwright/test'
const panel=(page:Page)=>page.getByRole('region',{name:'Division statistics',exact:true})
const table=(page:Page)=>page.getByRole('table',{name:'Division statistics by divisor'})
const values=(page:Page)=>panel(page).locator('.division-stats-summary dd')
const raw=(page:Page)=>page.evaluate(()=>({...localStorage}))
const errors=new WeakMap<Page,string[]>()
test.beforeEach(({page})=>{const found:string[]=[];errors.set(page,found);page.on('pageerror',e=>found.push(e.message));page.on('console',e=>{if(e.type()==='error')found.push(e.text())})})
test.afterEach(({page})=>expect(errors.get(page)).toEqual([]))
const uuid=(n:number)=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`
function fixture() {
  const records:Record<string,string>={}, q={dividend:20,divisor:3,quotient:6,remainder:2}
  let id=100
  const put=(round:number,event:object)=>{const n=id++;records['arithmetic:division:event:v1:'+uuid(n)]=JSON.stringify({version:1,id:uuid(n),roundId:uuid(round),submittedAt:'2026-01-01T00:00:00.000Z',...event,metadata:{archive:['keep',n]}},null,2)}
  for(const [round,length]of [[1,5],[2,10]]){
    put(round,{kind:'start',questions:Array.from({length},()=>({...q,unknown:'keep'}))})
    if(round===1)put(round,{kind:'attempt',questionIndex:0,...q,answerQuotient:0,answerRemainder:2,correct:false,elapsedMs:1000,sequence:0})
    for(let i=0;i<length;i++)put(round,{kind:'attempt',questionIndex:i,...q,answerQuotient:6,answerRemainder:2,correct:true,elapsedMs:round===2?0:i===0?7000:2000,sequence:i+(round===1?1:0)})
  }
  put(3,{kind:'attempt',questionIndex:0,dividend:155,divisor:12,quotient:12,remainder:11,answerQuotient:0,answerRemainder:0,correct:false,elapsedMs:9000,sequence:0})
  return records
}

test('Division Stats is a real direct route with Practice navigation and history',async({page})=>{
  await page.goto('/division/stats?sample=1#saved')
  await expect(page).toHaveURL(/\/division\/stats\?sample=1#saved$/)
  await expect(panel(page)).toBeVisible();await expect(table(page).locator('tbody tr')).toHaveCount(12)
  await expect(page.getByRole('link',{name:'Division',exact:true})).toHaveAttribute('aria-current','page')
  await expect(page.getByRole('link',{name:'Stats',exact:true})).toHaveAttribute('aria-current','page')
  await page.reload();await expect(panel(page)).toBeVisible()
  await page.getByRole('link',{name:'Practice',exact:true}).click();await expect(page).toHaveURL(/\/division$/)
  await expect(page.getByRole('main',{name:'Division'}).getByRole('button',{name:'Start',exact:true})).toBeVisible()
  await page.goBack();await expect(panel(page)).toBeVisible()
  await page.goForward();await expect(page).toHaveURL(/\/division$/)
})

test('empty, corrected, zero-duration and legacy ten-question populations preserve exact bytes',async({page})=>{
  await page.goto('/division/stats');await expect(values(page)).toHaveText(['0','—','—','0'],{useInnerText:true})
  const records=fixture()
  await page.evaluate(records=>{for(const[k,v]of Object.entries(records))localStorage.setItem(k,v)},records);await page.reload()
  await expect(values(page)).toHaveText(['16','87.5%','1.00 s','2'],{useInnerText:true})
  const solved=table(page).getByRole('row').filter({has:page.getByRole('rowheader',{name:'÷ 3',exact:true})})
  await expect(solved.getByRole('cell').first()).toHaveText('15');await expect(solved.locator('summary')).toHaveText(['93.3%','1.00 s'])
  const unsolved=table(page).getByRole('row').filter({has:page.getByRole('rowheader',{name:'÷ 12',exact:true})})
  await expect(unsolved.getByRole('cell').first()).toHaveText('1');await expect(unsolved.locator('summary')).toHaveText(['0%','—'])
  for(const name of ['Practice','Stats'])await page.getByRole('link',{name,exact:true}).click()
  await page.reload();expect(await raw(page)).toEqual(records)
})

test('Stats refreshes on cross-tab storage, focus and navigation without writes',async({page,context})=>{
  await page.goto('/division/stats');await expect(values(page)).toHaveText(['0','—','—','0'],{useInnerText:true})
  const other=await context.newPage();await other.goto('/division/stats');const records=fixture()
  await other.evaluate(records=>{for(const[k,v]of Object.entries(records))localStorage.setItem(k,v)},records)
  await expect(values(page)).toHaveText(['16','87.5%','1.00 s','2'],{useInnerText:true})
  await other.close();await page.bringToFront()
  const key='arithmetic:division:event:v1:'+uuid(900)
  const event=JSON.stringify({version:1,kind:'attempt',id:uuid(900),roundId:uuid(901),questionIndex:0,dividend:1,divisor:1,quotient:1,remainder:0,answerQuotient:1,answerRemainder:0,correct:true,sequence:0,elapsedMs:1000,submittedAt:'2026-01-01T00:00:00.000Z'})
  await page.evaluate(({key,event})=>{localStorage.setItem(key,event);window.dispatchEvent(new Event('focus'))},{key,event})
  await expect(values(page)).toHaveText(['17','88.2%','1.00 s','2'],{useInnerText:true})
  await page.getByRole('link',{name:'Practice',exact:true}).click();await page.evaluate(key=>localStorage.removeItem(key),key)
  await page.getByRole('link',{name:'Stats',exact:true}).click();await expect(values(page)).toHaveText(['16','87.5%','1.00 s','2'],{useInnerText:true})
  expect(await raw(page)).toEqual(records)
})

test('both mounted games retain inputs and progress while Stats pauses clocks and ignores shortcuts',async({page})=>{
  await page.addInitScript(()=>{(window as any).now=0;Object.defineProperty(performance,'now',{value:()=>(window as any).now});Math.random=()=>0.99999})
  const now=(n:number)=>page.evaluate(n=>{(window as any).now=n},n)
  await page.goto('/multiplication');await page.getByRole('button',{name:'Start',exact:true}).click()
  const mul=page.getByRole('textbox',{name:'Answer',exact:true})
  await expect(mul).toBeFocused();await mul.fill('144');await now(1000)
  await page.getByRole('link',{name:'Division',exact:true}).click();await page.getByRole('button',{name:'Start',exact:true}).click()
  const q=page.getByRole('textbox',{name:'Quotient',exact:true}),r=page.getByRole('textbox',{name:'Remainder',exact:true})
  await expect(q).toBeFocused();await now(2000);await q.fill('12');await r.fill('11')
  await page.getByRole('link',{name:'Stats',exact:true}).click();const before=await raw(page)
  await page.locator('body').click({position:{x:1,y:1}});await page.keyboard.press('Enter');await page.keyboard.press('Escape')
  await expect(values(page)).toHaveText(['0','—','—','0'],{useInnerText:true});expect(await raw(page)).toEqual(before)
  await now(12000);await page.getByRole('link',{name:'Practice',exact:true}).click()
  await expect(q).toHaveValue('12');await expect(r).toHaveValue('11')
  await expect(page.getByRole('main',{name:'Division'}).getByLabel('Question progress')).toHaveText('1 / 5')
  await now(13000);await r.press('Enter')
  await expect(page.getByRole('main',{name:'Division'}).getByLabel('Question progress')).toHaveText('2 / 5')
  const attempts=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('arithmetic:division:')).map(k=>JSON.parse(localStorage.getItem(k)!)).filter(e=>e.kind==='attempt'))
  expect(attempts.map(e=>e.elapsedMs)).toEqual([2000])
  await page.getByRole('link',{name:'Stats',exact:true}).click();await expect(values(page)).toHaveText(['1','100%','2.00 s','0'],{useInnerText:true})
  await page.getByRole('link',{name:'Multiplication',exact:true}).click()
  await expect(mul).toHaveValue('144');await expect(page.locator('.practice-page').getByLabel('Question progress')).toHaveText('1 / 10')
  await now(14000);await mul.press('Enter')
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('arithmetic:attempt:v1:')).map(k=>JSON.parse(localStorage.getItem(k)!).elapsedMs))).toEqual([2000])
  await page.goBack();await expect(values(page)).toHaveText(['1','100%','2.00 s','0'],{useInnerText:true})
})

test('failed division save survives Stats navigation and retries the exact event',async({page})=>{
  await page.addInitScript(()=>{Math.random=()=>0.99999});await page.goto('/division');await page.getByRole('button',{name:'Start',exact:true}).click()
  const q=page.getByRole('textbox',{name:'Quotient',exact:true}),r=page.getByRole('textbox',{name:'Remainder',exact:true})
  await expect(q).toBeFocused();await q.fill('12');await r.fill('11')
  await page.evaluate(()=>{const w=window as any;w.set=Storage.prototype.setItem;w.writes=[];Storage.prototype.setItem=function(k,v){w.writes.push([k,v]);throw new Error('Full')}})
  await r.press('Enter');await expect(page.getByRole('button',{name:'Retry saving'})).toBeVisible()
  const pending=await page.evaluate(()=>(window as any).writes[0])
  await page.getByRole('link',{name:'Stats',exact:true}).click();await expect(values(page)).toHaveText(['0','—','—','0'],{useInnerText:true})
  await page.locator('body').click({position:{x:1,y:1}});await page.keyboard.press('Escape');await page.keyboard.press('Enter')
  await page.getByRole('link',{name:'Practice',exact:true}).click()
  await expect(q).toHaveValue('12');await expect(r).toHaveValue('11');await expect(q).toBeDisabled()
  await page.evaluate(()=>{Storage.prototype.setItem=(window as any).set});await page.getByRole('button',{name:'Retry saving'}).click()
  await expect(page.getByLabel('Question progress')).toHaveText('2 / 5')
  expect(await page.evaluate(k=>localStorage.getItem(k),pending[0])).toBe(pending[1])
  await page.getByRole('link',{name:'Stats',exact:true}).click();await expect(values(page).first()).toHaveText('1')
})

test('Stats Enter and Escape cannot start either hidden ready game',async({page})=>{
  await page.goto('/division/stats');const before=await raw(page)
  await page.locator('body').click({position:{x:1,y:1}});await page.keyboard.press('Enter');await page.keyboard.press('Escape');expect(await raw(page)).toEqual(before)
  await page.getByRole('link',{name:'Practice',exact:true}).click();await expect(page.getByRole('button',{name:'Start',exact:true})).toBeVisible()
  await page.getByRole('link',{name:'Multiplication',exact:true}).click();await expect(page.getByRole('button',{name:'Start',exact:true})).toBeVisible()
})

test('unreadable future data warns and withholds completion without rewriting any source',async({page})=>{
  await page.goto('/division/stats')
  const records={...fixture(),'arithmetic:division:event:v9:future':'{ "version": 9, "extra": ["keep"] }','arithmetic:division:event:v1:broken':'{','arithmetic:unrelated:v7':'do not alter'}
  await page.evaluate(records=>{for(const[k,v]of Object.entries(records))localStorage.setItem(k,v)},records);await page.reload()
  await expect(page.getByRole('alert')).toContainText('original data has been kept')
  await expect(values(page)).toHaveText(['16','87.5%','1.00 s','0'],{useInnerText:true})
  await page.getByRole('link',{name:'Practice',exact:true}).click();await page.getByRole('link',{name:'Stats',exact:true}).click()
  expect(await raw(page)).toEqual(records)
})

for(const theme of ['dark','light'])for(const width of [1440,375,320])test(`Division Stats ${theme} ${width}px empty and populated disclosure fits`,async({page})=>{
  await page.setViewportSize({width,height:1000});await page.goto('/division/stats')
  if(theme==='light')await page.getByRole('button',{name:'Switch to light theme'}).click()
  await expect(page.locator('.app')).toHaveClass(`app ${theme}`);await expect(values(page)).toHaveText(['0','—','—','0'],{useInnerText:true})
  await page.screenshot({path:`artifacts/division-stats-integrated-empty-${theme}-${width}.png`,fullPage:true})
  const records=fixture();await page.evaluate(records=>{for(const[k,v]of Object.entries(records))localStorage.setItem(k,v);window.dispatchEvent(new Event('focus'))},records)
  await expect(values(page)).toHaveText(['16','87.5%','1.00 s','2'],{useInnerText:true})
  await page.screenshot({path:`artifacts/division-stats-integrated-${theme}-${width}.png`,fullPage:true})
  const disclosure=values(page).nth(2).locator('summary');await disclosure.focus();await page.keyboard.press('Enter')
  await expect(values(page).nth(2).locator('details')).toHaveAttribute('open','')
  const box=(await values(page).nth(2).locator('.division-stat-count').boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:`artifacts/division-stats-integrated-detail-${theme}-${width}.png`,fullPage:true})
  expect(await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([key])=>key!=='arithmetic:theme')))).toEqual(records)
})
