import { expect, test, type Page } from '@playwright/test'
import { generateSyntheticHistory } from '../src/syntheticData'
import { generateSparseSyntheticHistory } from './fixtures/sparseSynthetic'

async function open(page:Page) {
  await page.locator('body').click({position:{x:1,y:1}})
  await page.keyboard.press('Control+Alt+Shift+KeyS')
}
async function load(page:Page) {
  await open(page);await page.getByRole('button',{name:'Load synthetic data',exact:true}).click()
  await expect(page.getByRole('button',{name:'Cancel',exact:true})).toBeFocused()
  await page.getByRole('button',{name:'Replace all practice data',exact:true}).click()
  await expect(page.getByRole('status')).toHaveText('Synthetic data loaded.')
  await page.getByRole('button',{name:'Cancel',exact:true}).click()
}
for(const originalKind of ['old sparse seed','rich demo-sized original'] as const)test(`real quota, repeated load and first-original restore: ${originalKind}`,async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.stack??e.message))
  await page.goto('/multiplication/stats')
  const original=(originalKind==='old sparse seed'?generateSparseSyntheticHistory:generateSyntheticHistory)(Date.parse('2026-06-01T12:00:00.000Z'),71)
  await page.evaluate(history=>{for(const[k,v]of Object.entries(history))localStorage.setItem(k,v)},original)
  await page.reload()
  // Deploy/reload never reseeds old data, even when the current generator changed.
  expect(await page.evaluate(()=>({...localStorage}))).toEqual(original)
  await page.evaluate(()=>{
    const w=window as any,set=Storage.prototype.setItem,remove=Storage.prototype.removeItem
    let chars=Object.entries(localStorage).reduce((n,[k,v])=>n+k.length+v.length,0)
    w.measure={peakChars:chars,transactions:[]};let start=0
    Storage.prototype.setItem=function(k,v){
      if(k==='arithmetic:synthetic:journal:v1')start=performance.now()
      const previous=this.getItem(k)
      set.call(this,k,v)
      chars+=k.length+v.length-(previous===null?0:k.length+previous.length)
      w.measure.peakChars=Math.max(w.measure.peakChars,chars)
    }
    Storage.prototype.removeItem=function(k){
      const previous=this.getItem(k);remove.call(this,k)
      if(previous!==null)chars-=k.length+previous.length
      if(k==='arithmetic:synthetic:journal:v1')w.measure.transactions.push(performance.now()-start)
    }
  })
  await load(page)
  const backup=await page.evaluate(()=>localStorage.getItem('arithmetic:synthetic:backup:v1'))
  expect(JSON.parse(backup!).history).toEqual(original)
  const counts=await page.getByRole('table',{name:'Completions by ordered multiplication pair',exact:true}).locator('[data-pair]').allTextContents()
  expect(counts).toHaveLength(144);expect(Math.min(...counts.map(Number))).toBeGreaterThanOrEqual(8)
  await load(page)
  expect(await page.evaluate(()=>localStorage.getItem('arithmetic:synthetic:backup:v1'))).toBe(backup)
  await open(page);await page.getByRole('button',{name:'Restore backup',exact:true}).click()
  await expect(page.getByRole('button',{name:'Cancel',exact:true})).toBeFocused()
  await page.getByRole('button',{name:'Restore original backup',exact:true}).click()
  await expect(page.getByRole('status')).toHaveText('Original backup restored.')
  const restored=await page.evaluate(()=>({...localStorage}))
  expect(Object.fromEntries(Object.entries(restored).filter(([k])=>!k.startsWith('arithmetic:synthetic:')))).toEqual(original)
  expect(restored['arithmetic:synthetic:backup:v1']).toBe(backup)
  const measurement=await page.evaluate(()=>(window as any).measure)
  expect(measurement.transactions).toHaveLength(3)
  expect(Math.max(...measurement.transactions)).toBeLessThan(2500)
  await info.attach('actual-storage-quota-and-timing',{body:JSON.stringify(measurement),contentType:'application/json'})
  expect(errors).toEqual([])
})
