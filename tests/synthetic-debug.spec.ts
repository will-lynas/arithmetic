import { expect, test, type Page } from '@playwright/test'
import { samplerDiagnostics } from '../src/scheduler'
import { debugDistributions } from '../src/debugDistributions'
import { aggregateStatistics } from '../src/statistics'
import type { AttemptRecord } from '../src/types'

const now=Date.parse('2026-11-16T12:00:00Z')
const bytes=(page:Page)=>page.evaluate(()=>({...localStorage}))
const errors=new WeakMap<Page,string[]>()
test.beforeEach(async({page})=>{const messages:string[]=[];errors.set(page,messages);page.on('pageerror',e=>messages.push(e.stack??e.message))})
test.afterEach(async({page})=>{expect(errors.get(page)).toEqual([])})
async function open(page:Page) {
  await page.locator('body').click({position:{x:1,y:1}})
  await page.keyboard.press('Control+Alt+Shift+KeyS')
  await expect(page.getByRole('dialog',{name:'Synthetic data'})).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true})).toBeFocused()
}
async function verifyLedger(page:Page,history:AttemptRecord[]) {
  const snapshot=samplerDiagnostics(history,now)
  const rows=page.getByRole('table',{name:'Ranked next-draw probabilities'}).locator('tbody tr')
  await expect(rows).toHaveCount(144)
  // Node and browser Math.exp can differ in the last bit; retain exact row,
  // eligibility and count checks, comparing probabilities to 14 decimal places.
  expect(await rows.evaluateAll(rows=>rows.map(r=>({pair:r.getAttribute('data-pair'),p:Number(r.getAttribute('data-probability')),eligible:r.getAttribute('data-eligible')==='true',completed:Number(r.children[3].textContent)})))).toEqual(snapshot.rows.map(r=>({pair:`${r.left}x${r.right}`,p:expect.closeTo(r.probability,14),eligible:r.eligible,completed:r.completed})))
  expect(snapshot.rows.reduce((sum,r)=>sum+r.probability,0)).toBeCloseTo(1,12)
  const statistics=aggregateStatistics(history)
  expect(snapshot.rows.reduce((sum,r)=>sum+r.completed,0)).toBe(statistics.pairs.reduce((sum,p)=>sum+p.solved,0))
  for(const d of debugDistributions(snapshot,history)) {
    const plot=page.getByRole('figure',{name:`${d.title} histogram`,exact:true})
    await expect(plot.locator('.recharts-surface')).toBeVisible()
    if(d.missing)await expect(plot.getByText(`${d.missing} missing`,{exact:true})).toBeVisible()
    else await expect(plot.getByText(/missing/)).toHaveCount(0)
    expect(await plot.locator('tbody tr').evaluateAll(rows=>rows.map(r=>({lower:Number(r.getAttribute('data-lower')),upper:Number(r.getAttribute('data-upper')),count:Number(r.getAttribute('data-count'))})))).toEqual(d.bins)
    const geometry=await plot.locator('[data-bin-index]').evaluateAll(nodes=>nodes.map(n=>({x:Number(n.getAttribute('x')),width:Number(n.getAttribute('width')),count:Number(n.getAttribute('data-count'))})))
    expect(geometry.map(b=>b.count)).toEqual(d.bins.map(b=>b.count))
    for(let i=1;i<geometry.length;i++)expect(Math.abs(geometry[i]!.x-geometry[i-1]!.x-geometry[i-1]!.width)).toBeLessThan(0.2)
    expect(d.bins.reduce((sum,b)=>sum+b.count,0)+d.missing).toBe(144)
  }
}
for(const theme of ['dark','light'])for(const width of [1440,320])test(`real hidden load refreshes Debug, reloads and exactly restores original ${theme} ${width}`,async({page},info)=>{
  await page.setViewportSize({width,height:1000})
  await page.clock.setFixedTime(new Date(now))
  await page.goto('/multiplication/debug?demo=1')
  await expect(page.getByRole('heading',{name:'Sampler debug',exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:/synthetic|backup/i})).toHaveCount(0)
  expect(await bytes(page)).toEqual({})
  const record:AttemptRecord={version:1,id:'11111111-1111-4111-8111-111111111111',roundId:'22222222-2222-4222-8222-222222222222',questionIndex:0,left:2,right:3,answer:6,correct:true,elapsedMs:1200,submittedAt:'2026-01-01T00:00:00.000Z'}
  const original={['arithmetic:attempt:v1:'+record.id]:' '+JSON.stringify({...record,unknown:{keep:'exact'}})+'\n',['arithmetic:round-cancel:v1:'+record.roundId]:JSON.stringify({version:1,roundId:record.roundId,canceledAt:record.submittedAt}),'arithmetic:theme':theme,'arithmetic:future-setting':' untouched ','unrelated:site':'leave alone'}
  await page.evaluate(original=>{for(const [key,value]of Object.entries(original))localStorage.setItem(key,value)},original)
  await page.reload();await verifyLedger(page,[record])
  await open(page);expect(await bytes(page)).toEqual(original)
  await page.getByRole('button',{name:'Load synthetic data',exact:true}).click()
  await expect(page.getByRole('button',{name:'Cancel',exact:true})).toBeFocused()
  expect(await bytes(page)).toEqual(original)
  await page.getByRole('button',{name:'Replace all practice data',exact:true}).click()
  await expect(page.getByRole('status')).toHaveText('Synthetic data loaded.')
  await page.getByRole('button',{name:'Cancel',exact:true}).click()
  const loaded=await bytes(page),backup=loaded['arithmetic:synthetic:backup:v1']
  const history=Object.entries(loaded).filter(([k])=>k.startsWith('arithmetic:attempt:v1:')).map(([,v])=>JSON.parse(v) as AttemptRecord)
  expect(history.filter(a=>a.correct).length).toBeGreaterThanOrEqual(2000)
  expect(samplerDiagnostics(history,now).rows.every(row=>row.coverageBoost===0)).toBe(true)
  await verifyLedger(page,history)
  expect(loaded['arithmetic:theme']).toBe(theme);expect(loaded['unrelated:site']).toBe(original['unrelated:site']);expect(loaded['arithmetic:future-setting']).toBe(original['arithmetic:future-setting'])
  await expect(page.locator('.app').first()).toHaveClass(new RegExp(theme))
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:info.outputPath(`seeded-debug-${theme}-${width}.png`),fullPage:true})
  await page.locator('.debug-plots').screenshot({path:info.outputPath(`seeded-debug-${theme}-${width}-charts.png`)})
  await info.attach('seeded-ledger-and-diagnostics',{body:JSON.stringify({history,snapshot:samplerDiagnostics(history,now),distributions:debugDistributions(samplerDiagnostics(history,now),history)},null,2),contentType:'application/json'})
  await page.reload();await verifyLedger(page,history);expect(await bytes(page)).toEqual(loaded)
  await page.getByRole('button',{name:'Refresh',exact:true}).click();await verifyLedger(page,history)
  await page.getByRole('link',{name:'Stats',exact:true}).click()
  const counts=page.getByRole('table',{name:'Completions by ordered multiplication pair',exact:true}).locator('[data-pair]')
  expect(await counts.evaluateAll(cells=>cells.reduce((sum,c)=>sum+Number(c.textContent),0))).toBe(aggregateStatistics(history).pairs.reduce((sum,p)=>sum+p.solved,0))
  await page.getByRole('link',{name:'Debug',exact:true}).click()
  await open(page);await page.getByRole('button',{name:'Restore backup',exact:true}).click()
  await expect(page.getByRole('button',{name:'Cancel',exact:true})).toBeFocused()
  await page.getByRole('button',{name:'Restore original backup',exact:true}).click()
  await expect(page.getByRole('status')).toHaveText('Original backup restored.')
  await page.getByRole('button',{name:'Cancel',exact:true}).click()
  await verifyLedger(page,[record])
  const restored=await bytes(page)
  expect(Object.fromEntries(Object.entries(restored).filter(([k])=>!k.startsWith('arithmetic:synthetic:')))).toEqual(original)
  expect(restored['arithmetic:synthetic:backup:v1']).toBe(backup)
  await page.reload();await verifyLedger(page,[record]);expect(await bytes(page)).toEqual(restored)
  await expect(page.getByRole('button',{name:/synthetic|backup/i})).toHaveCount(0)
})
test('Debug modal never starts or cancels paused active practice and refuses replacement',async({page})=>{
  await page.goto('/multiplication');await page.getByRole('button',{name:'Start',exact:true}).click()
  const input=page.getByRole('textbox',{name:'Answer',exact:true});await expect(input).toBeFocused();await input.fill('17')
  const question=await page.getByTestId('question').getAttribute('aria-label')
  await page.getByRole('link',{name:'Stats',exact:true}).click();await page.getByRole('link',{name:'Debug',exact:true}).click()
  const before=await bytes(page)
  await open(page);await page.keyboard.press('Escape');expect(await bytes(page)).toEqual(before)
  await open(page);await page.getByRole('button',{name:'Load synthetic data',exact:true}).click();await page.getByRole('button',{name:'Replace all practice data',exact:true}).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('active, starting or waiting to save');expect(await bytes(page)).toEqual(before)
  await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('link',{name:'Practice',exact:true}).click()
  await expect(page.getByTestId('question')).toHaveAttribute('aria-label',question!);await expect(input).toHaveValue('17')
  await input.press('Escape');await expect(page.getByRole('button',{name:'Start',exact:true})).toBeVisible()
})
