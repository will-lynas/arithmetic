import { expect, test, type Page } from '@playwright/test'
import { samplerHistory, syntheticNow } from './fixtures/samplerHistory'
import { samplerDiagnostics } from '../src/scheduler'
import { debugDistributions } from '../src/debugDistributions'

const errors=new WeakMap<Page,string[]>()
test.beforeEach(async({page})=>{const messages:string[]=[];errors.set(page,messages);page.on('pageerror',error=>messages.push(error.stack??error.message))})
test.afterEach(async({page})=>{expect(errors.get(page)).toEqual([])})

test('seven real histograms reconcile all bins with whole population and preserve every storage byte',async({page})=>{
  const history=samplerHistory()
  const expected=debugDistributions(samplerDiagnostics(history,syntheticNow),history)
  await page.clock.setFixedTime(new Date(syntheticNow))
  await page.goto('/multiplication/debug')
  const bytes=await page.evaluate(rows=>{
    for(const row of rows) {
      localStorage.setItem('arithmetic:attempt:v1:'+row.id,JSON.stringify({...row,synthetic:true,unknown:{keep:'exact'}}))
      localStorage.setItem('arithmetic:round-cancel:v1:'+row.roundId,JSON.stringify({version:1,roundId:row.roundId,canceledAt:row.submittedAt}))
    }
    localStorage.setItem('arithmetic:attempt:v1:unsupported','{ malformed untouched')
    localStorage.setItem('arithmetic:unknown','future bytes')
    return {...localStorage}
  },history)
  await page.reload()
  for(const d of expected) {
    const plot=page.getByRole('figure',{name:`${d.title} histogram`,exact:true})
    await expect(plot.locator('.recharts-surface')).toBeVisible()
    await expect(plot.getByText(`${d.known} known / 144 · ${d.missing} missing`,{exact:true})).toBeVisible()
    await plot.getByText('Bin counts',{exact:true}).click()
    const bins=await plot.getByRole('table').locator('tbody tr').evaluateAll(rows=>rows.map(r=>({lower:Number(r.getAttribute('data-lower')),upper:Number(r.getAttribute('data-upper')),count:Number(r.getAttribute('data-count'))})))
    expect(bins).toEqual(d.bins)
    await plot.getByText('Bin counts',{exact:true}).click()
  }
  const ranked=page.getByRole('table',{name:'Ranked next-draw probabilities'}).locator('tbody tr')
  const probabilities=await ranked.evaluateAll(rows=>rows.map(r=>Number(r.getAttribute('data-probability'))))
  expect(probabilities).toEqual(samplerDiagnostics(history,syntheticNow).rows.map(r=>r.probability))
  await page.getByRole('button',{name:'Refresh snapshot'}).click()
  await page.getByRole('link',{name:'Stats',exact:true}).click()
  await page.getByRole('link',{name:'Debug',exact:true}).click()
  expect(await page.evaluate(()=>({...localStorage}))).toEqual(bytes)
})

test('histogram axis labels fit the narrow chart viewport',async({page})=>{
  await page.setViewportSize({width:320,height:900})
  await page.goto('/multiplication/debug')
  await expect(page.locator('.debug-plot')).toHaveCount(7)
  for(const plot of await page.locator('.debug-plot').all()) {
    const svg=(await plot.locator('svg.recharts-surface').boundingBox())!
    const label=(await plot.locator('.recharts-label:not([transform])').boundingBox())!
    expect(label.x).toBeGreaterThanOrEqual(svg.x)
    expect(label.x+label.width).toBeLessThanOrEqual(svg.x+svg.width)
  }
})

test('Debug is tucked below Stats, all ranked rows and distributions use normalized next-draw chances',async({page})=>{
  await page.goto('/multiplication/stats')
  await expect(page.getByRole('navigation',{name:'Main navigation'}).getByRole('link')).toHaveCount(2)
  await page.getByRole('link',{name:'Debug',exact:true}).click()
  await expect(page).toHaveURL(/\/multiplication\/debug$/)
  await expect(page.getByRole('heading',{name:'Sampler debug',exact:true})).toBeVisible()
  const rows=page.getByRole('table',{name:'Ranked next-draw probabilities'}).locator('tbody tr')
  await expect(rows).toHaveCount(144)
  const data=await rows.evaluateAll(rows=>rows.map(r=>({pair:r.getAttribute('data-pair'),p:Number(r.getAttribute('data-probability'))})))
  expect(new Set(data.map(r=>r.pair)).size).toBe(144)
  expect(data.reduce((sum,r)=>sum+r.p,0)).toBeCloseTo(1,12)
  await expect(page.getByRole('table',{name:'Chance by lifetime completions'})).toBeVisible()
  await expect(page.getByRole('table',{name:'Weighted score contributions'})).toBeVisible()
  await page.reload()
  await expect(rows).toHaveCount(144)
  await page.goBack()
  await expect(page).toHaveURL(/\/multiplication\/stats$/)
})

test('Debug pauses practice and uses mounted active-round context without sampling or handling game keys',async({page})=>{
  await page.goto('/multiplication')
  await page.getByRole('button',{name:'Start',exact:true}).click()
  const question=await page.getByTestId('question').getAttribute('aria-label')
  await page.getByRole('textbox',{name:'Answer',exact:true}).fill('17')
  await page.getByRole('link',{name:'Stats',exact:true}).click()
  await page.getByRole('link',{name:'Debug',exact:true}).click()
  await expect(page.getByText('Active round · next draw', {exact:true})).toBeVisible()
  await expect(page.getByText(`Already chosen: ${question?.replace(' times ',' × ')}`,{exact:true})).toBeVisible()
  await page.locator('body').click({position:{x:1,y:1}})
  await page.keyboard.press('Escape');await page.keyboard.press('Enter')
  await page.getByRole('button',{name:'Refresh snapshot'}).click()
  await page.getByRole('link',{name:'Practice',exact:true}).click()
  await expect(page.getByTestId('question')).toHaveAttribute('aria-label',question!)
  await expect(page.getByRole('textbox',{name:'Answer',exact:true})).toHaveValue('17')
})
