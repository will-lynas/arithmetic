import { expect, test } from '@playwright/test'
const prefix='arithmetic:division:event:v1:'
const uuid=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const question={divisor:12,quotient:12,remainder:11,dividend:155}
function fixture(length:number,solved:number) {
  const roundId=uuid(1), submittedAt='2026-01-01T00:00:00.000Z'
  const records:Record<string,string>={}
  const put=(n:number,event:object)=>{records[prefix+uuid(n)]=JSON.stringify({version:1,id:uuid(n),roundId,submittedAt,...event,metadata:{archive:['retain',n]}},null,2)}
  put(2,{kind:'start',questions:Array.from({length},()=>({...question,unknown:{source:true}}))})
  for(let i=0;i<solved;i++)put(10+i,{kind:'attempt',questionIndex:i,...question,answerQuotient:12,answerRemainder:11,correct:true,elapsedMs:1000,sequence:i})
  // An unrelated historical ten-question round must survive every operation too.
  records[prefix+uuid(100)]=JSON.stringify({version:1,kind:'start',id:uuid(100),roundId:uuid(101),submittedAt,questions:Array.from({length:10},()=>question),unknown:{untouched:true}},null,2)
  return {records,roundId,put}
}
for(const [length,solved] of [[5,4],[10,8],[10,10]])test(`${length}-question stored round with ${solved} solved restores its own plan and preserves all source bytes`,async({page})=>{
  const {records,roundId}=fixture(length,solved)
  await page.goto('/division')
  await page.evaluate(({records,roundId})=>{for(const [k,v] of Object.entries(records))localStorage.setItem(k,v);sessionStorage.setItem('arithmetic:division-round:v1',roundId)},{records,roundId})
  await page.reload()
  const main=page.getByRole('main',{name:'Division'})
  await expect(main.getByRole('alert')).toHaveCount(0)
  for(let i=solved;i<length;i++) {
    await expect(main.getByLabel('Question progress')).toHaveText(`${i+1} / ${length}`)
    await expect(main.getByRole('heading',{name:'Round complete'})).toHaveCount(0)
    await page.getByRole('textbox',{name:'Quotient',exact:true}).fill('12')
    await page.getByRole('textbox',{name:'Remainder',exact:true}).fill('11')
    await page.getByRole('textbox',{name:'Remainder',exact:true}).press('Enter')
  }
  await expect(main.getByLabel('Round result')).toContainText(`${length} / ${length}`)
  expect(Number.parseFloat(await main.locator('.result-metrics strong').first().innerText())).toBeGreaterThanOrEqual(solved)
  await page.reload()
  await expect(main.getByLabel('Round result')).toContainText(`${length} / ${length}`)
  await page.getByRole('link',{name:'Multiplication',exact:true}).click()
  await page.getByRole('link',{name:'Stats',exact:true}).click()
  await page.getByRole('link',{name:'Division',exact:true}).click()
  expect(await page.evaluate(records=>Object.fromEntries(Object.keys(records).map(k=>[k,localStorage.getItem(k)])),records)).toEqual(records)
  await main.getByRole('button',{name:'New round'}).click()
  await expect(main.getByLabel('Question progress')).toHaveText('1 / 5')
  expect(await page.evaluate(records=>Object.fromEntries(Object.keys(records).map(k=>[k,localStorage.getItem(k)])),records)).toEqual(records)
})
test('an out-of-plan legacy-index attempt on a five-question start is retained but cannot strand round ownership',async({page})=>{
  const {records,roundId,put}=fixture(5,0)
  put(10,{kind:'attempt',questionIndex:9,...question,answerQuotient:12,answerRemainder:11,correct:true,elapsedMs:1000,sequence:0})
  await page.goto('/division')
  await page.evaluate(({records,roundId})=>{for(const [k,v] of Object.entries(records))localStorage.setItem(k,v);sessionStorage.setItem('arithmetic:division-round:v1',roundId)},{records,roundId})
  await page.reload()
  await expect(page.getByRole('main',{name:'Division'}).getByRole('button',{name:'Start',exact:true})).toBeEnabled()
  expect(await page.evaluate(async roundId=>(await navigator.locks.query()).held?.some(l=>l.name===`arithmetic:round:${roundId}`),roundId)).toBe(false)
  expect(await page.evaluate(records=>Object.fromEntries(Object.keys(records).map(k=>[k,localStorage.getItem(k)])),records)).toEqual(records)
})
