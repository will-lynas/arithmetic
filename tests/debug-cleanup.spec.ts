import { expect, test } from '@playwright/test'
import { samplerHistory, syntheticNow } from './fixtures/samplerHistory'
import { COVERAGE_BOOSTS } from '../src/scheduler'

for(const theme of ['dark','light'])for(const width of [1440,320])test(`compact diagnostics ${theme} ${width}`,async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.stack??e.message))
  await page.setViewportSize({width,height:1000})
  await page.clock.setFixedTime(new Date(syntheticNow))
  await page.goto('/multiplication/debug')
  await page.evaluate(({history,theme})=>{
    for(const row of history)localStorage.setItem('arithmetic:attempt:v1:'+row.id,JSON.stringify(row))
    localStorage.setItem('arithmetic:theme',theme)
  },{history:samplerHistory(),theme})
  await page.reload()
  await expect(page.locator('.app').first()).toHaveClass(new RegExp(theme))
  await expect(page.getByText('Definitions and formula',{exact:true})).toHaveCount(0)
  await expect(page.getByText('Bin counts',{exact:true})).toHaveCount(0)
  await expect(page.getByText(/known \/ 144/)).toHaveCount(0)
  await expect(page.locator('.debug-plot')).toHaveCount(7)
  const colors:string[]=[]
  for(const plot of await page.locator('.debug-plot').all()) {
    const bins=await plot.locator('tbody tr').evaluateAll(rows=>rows.map(r=>Number(r.getAttribute('data-count'))))
    const bars=plot.locator('[data-bin-index]')
    await expect(bars).toHaveCount(bins.length)
    const geometry=await bars.evaluateAll(nodes=>nodes.map(n=>({x:Number(n.getAttribute('x')),width:Number(n.getAttribute('width')),height:Number(n.getAttribute('height')),count:Number(n.getAttribute('data-count')),fill:getComputedStyle(n).fill})))
    expect(geometry.map(b=>b.count)).toEqual(bins)
    for(let i=1;i<geometry.length;i++)expect(Math.abs(geometry[i]!.x-geometry[i-1]!.x-geometry[i-1]!.width)).toBeLessThan(0.2)
    expect(geometry.every(b=>b.width>0&&b.height>=0)).toBe(true)
    colors.push(geometry[0]!.fill)
    const svg=(await plot.locator('svg.recharts-surface').boundingBox())!
    for(const label of await plot.locator('svg text').all()) {
      const rect=(await label.boundingBox())!
      expect(rect.x).toBeGreaterThanOrEqual(svg.x-1)
      expect(rect.x+rect.width).toBeLessThanOrEqual(svg.x+svg.width+1)
    }
    const ticks=await plot.locator('.recharts-yAxis-tick-labels text').allTextContents()
    expect(ticks.length).toBeGreaterThanOrEqual(2)
    expect(ticks.every(v=>Number.isInteger(Number(v)))).toBe(true)
    // Hover the actual nonzero bar and reconcile exact range/count with hidden data.
    const index=geometry.findIndex(b=>b.height>0)
    await bars.nth(index).hover()
    await expect(plot.locator('.recharts-tooltip-wrapper')).toContainText(String(bins[index]))
    await expect(plot.locator('.recharts-tooltip-wrapper')).toContainText((await plot.locator('tbody tr').nth(index).locator('td').first().textContent())!)
  }
  expect(new Set(colors).size).toBe(7)
  const coverage=page.locator('[data-metric="coverageBoost"]')
  expect(await coverage.locator('tbody tr td:first-child').allTextContents()).toEqual([...COVERAGE_BOOSTS].sort((a,b)=>a-b).map(String))
  await expect(page.getByRole('columnheader',{name:/Uniform|Weighted ½/})).toHaveCount(0)
  if(width===1440) {
    const boxes=await page.locator('.debug-plot').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().top))
    expect(boxes.filter(y=>y===boxes[0]).length).toBe(3)
    expect((await page.getByRole('heading',{name:'Ranked questions',exact:true}).boundingBox())!.y).toBeLessThan(850)
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  const before=await page.evaluate(()=>({...localStorage}))
  await page.getByRole('button',{name:'Refresh',exact:true}).click()
  expect(await page.evaluate(()=>({...localStorage}))).toEqual(before)
  await page.mouse.move(0,0)
  await page.screenshot({path:info.outputPath(`debug-${theme}-${width}-full.png`),fullPage:true})
  await page.locator('.debug-plots').screenshot({path:info.outputPath(`debug-${theme}-${width}-charts.png`)})
  expect(errors).toEqual([])
})
