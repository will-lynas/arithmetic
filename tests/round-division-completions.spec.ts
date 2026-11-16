import { expect, test, type Page } from '@playwright/test'

const table=(page:Page)=>page.getByRole('table',{name:'Round calculations',exact:true})
const snapshot=(page:Page)=>page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)])))
const facts=[{dividend:155,divisor:12,quotient:12,remainder:11},{dividend:154,divisor:12,quotient:12,remainder:10},{dividend:35,divisor:6,quotient:5,remainder:5}]

async function seed(page:Page,length:number,theme='dark') {
  const questions=Array.from({length},(_,i)=>facts[i%facts.length])
  await page.goto('/division')
  await page.evaluate(({questions,theme})=>{
    localStorage.setItem('arithmetic:theme',theme)
    const roundId=crypto.randomUUID(),old=crypto.randomUUID()
    const put=(data:object)=>{const id=crypto.randomUUID();localStorage.setItem('arithmetic:division:event:v1:'+id,JSON.stringify({version:1,id,roundId,submittedAt:'2026-01-01T00:00:00.000Z',unknown:{keep:true},...data},null,2))}
    put({kind:'start',questions})
    const attempt=(roundId:string,questionIndex:number,q:typeof questions[number],correct=true,sequence=questionIndex)=>put({roundId,kind:'attempt',questionIndex,...q,correct,answerQuotient:correct?q.quotient:0,answerRemainder:q.remainder,elapsedMs:1000+sequence,sequence})
    attempt(old,0,questions[0],false,0);attempt(old,0,questions[0],true,1);attempt(old,0,questions[0],true,2)
    attempt(old,1,questions[0],true,3)
    attempt(old,2,questions[1],false,4)
    // An actual different dividend with the same divisor/quotient is not this fact.
    attempt(old,3,{dividend:153,divisor:12,quotient:12,remainder:9},true,5)
    put({roundId:old,kind:'cancel'})
    for(let i=0;i<questions.length-1;i++)attempt(roundId,i,questions[i])
    sessionStorage.setItem('arithmetic:division-round:v1',roundId)
  },{questions,theme})
  await page.reload()
  await expect(page.locator('.app')).toHaveClass(`app ${theme}`)
  await expect(page.getByLabel('Question progress')).toHaveText(`${length} / ${length}`)
  await expect(table(page)).toHaveCount(0)
  return questions
}
async function finish(page:Page,questions:typeof facts,failSave=false) {
  const last=questions.at(-1)!
  const quotient=page.getByRole('textbox',{name:'Quotient',exact:true}),remainder=page.getByRole('textbox',{name:'Remainder',exact:true})
  await quotient.fill('0');await remainder.fill(String(last.remainder));await remainder.press('Enter')
  await expect(table(page)).toHaveCount(0)
  await quotient.fill(String(last.quotient))
  if(failSave)await page.evaluate(()=>{
    const original=Storage.prototype.setItem
    ;(window as any).restoreWrites=()=>{Storage.prototype.setItem=original}
    Storage.prototype.setItem=function(k,v){if(k.startsWith('arithmetic:division:'))throw new DOMException('Full','QuotaExceededError');original.call(this,k,v)}
  })
  await quotient.press('Enter')
  if(failSave) {
    await expect(page.getByRole('button',{name:'Retry saving'})).toBeVisible()
    await expect(table(page)).toHaveCount(0)
    await page.evaluate(()=>(window as any).restoreWrites())
    await page.getByRole('button',{name:'Retry saving'}).click()
  }
  await expect(page.getByRole('heading',{name:'Round complete'})).toBeVisible()
}
function expected(questions:typeof facts) {
  return questions.map(q=>[`${q.dividend} ÷ ${q.divisor} = ${q.quotient} r ${q.remainder}`,String(questions.filter(p=>p.dividend===q.dividend && p.divisor===q.divisor).length+(q.dividend===155?2:0))])
}
async function expectRows(page:Page,questions:typeof facts) {
  const rows=table(page).locator('tbody tr')
  await expect(rows).toHaveCount(questions.length)
  expect(await rows.evaluateAll(rows=>rows.map(row=>[...row.querySelectorAll('th,td')].map(cell=>cell.textContent)))).toEqual(expected(questions))
}
for(const length of [5,10])test(`division ${length}-question result counts full calculations, not retries or same-divisor facts`,async({page})=>{
  const questions=await seed(page,length),before=await snapshot(page)
  await finish(page,questions,true)
  await expectRows(page,questions)
  await expect(page.getByRole('button',{name:'New round'})).toBeFocused()
  const saved=await snapshot(page)
  for(const [k,v] of Object.entries(before))expect(saved[k]).toBe(v)
  expect(Object.keys(saved).length-Object.keys(before).length).toBe(2)
  await page.reload();await expectRows(page,questions)
  expect(await snapshot(page)).toEqual(saved)
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Question progress')).toHaveText('1 / 5')
  await expect(page.getByRole('textbox',{name:'Quotient',exact:true})).toBeFocused()
  await expect(table(page)).toHaveCount(0)
  await page.keyboard.press('Escape');await expect(table(page)).toHaveCount(0)
})
for(const theme of ['dark','light'])for(const width of [1440,320])test(`division round list fits ${theme} at ${width}`,async({page},testInfo)=>{
  await page.setViewportSize({width,height:1000})
  const questions=await seed(page,5,theme)
  await finish(page,questions);await expectRows(page,questions)
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  expect(await table(page).evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true)
  await page.screenshot({path:testInfo.outputPath(`division-round-${theme}-${width}.png`),fullPage:true})
})
