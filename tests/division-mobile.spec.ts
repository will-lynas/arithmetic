import { expect, test, type Page } from '@playwright/test'
test.use({viewport:{width:375,height:740},isMobile:true,hasTouch:true})
const main=(page:Page)=>page.getByRole('main',{name:'Division'})
const quotient=(page:Page)=>page.getByRole('textbox',{name:'Quotient',exact:true})
const remainder=(page:Page)=>page.getByRole('textbox',{name:'Remainder',exact:true})
async function events(page:Page){return page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('arithmetic:division:event:v1:')).map(k=>JSON.parse(localStorage.getItem(k)!)))}
test('division Start focuses within the tap but blocks edits and submits until ownership',async({page})=>{
  await page.goto('/division');await expect(main(page).getByRole('button',{name:'Start',exact:true})).toBeEnabled()
  await page.evaluate(()=>{
    const w=window as any,request=navigator.locks.request.bind(navigator.locks)
    navigator.locks.request=((...args:any[])=>String(args[0]).startsWith('arithmetic:round:')?new Promise(resolve=>{w.releaseClaim=()=>resolve((request as any)(...args))}):(request as any)(...args))as any
    w.focusLog=[];w.inClick=false
    document.addEventListener('click',()=>{w.inClick=true},true);document.addEventListener('click',()=>{w.inClick=false})
    document.addEventListener('focusin',e=>{if((e.target as HTMLElement).getAttribute('aria-label')==='Starting quotient')w.focusLog.push({inClick:w.inClick,readOnly:(e.target as HTMLInputElement).readOnly})})
  })
  await main(page).getByRole('button',{name:'Start',exact:true}).tap()
  expect(await page.evaluate(()=>(window as any).focusLog)).toEqual([{inClick:true,readOnly:false}])
  const starting=page.getByRole('textbox',{name:'Starting quotient',exact:true})
  await expect(starting).toBeFocused();await page.keyboard.insertText('12');await starting.press('Enter')
  await expect(main(page).getByRole('button',{name:'Submit',exact:true})).toBeDisabled()
  expect(await events(page)).toHaveLength(0)
  await expect.poll(()=>page.evaluate(()=>typeof (window as any).releaseClaim)).toBe('function')
  await page.evaluate(()=>(window as any).releaseClaim())
  await expect(quotient(page)).toBeFocused();await expect(quotient(page)).toHaveValue('')
  expect((await events(page)).filter(e=>e.kind==='start')).toHaveLength(1)
})
test('division touch correction, five-question completion and cancellation preserve immutable events',async({page})=>{
  await page.addInitScript(()=>{Math.random=()=>0.99999});await page.goto('/division')
  await main(page).getByRole('button',{name:'Start',exact:true}).tap()
  const q=quotient(page),r=remainder(page),submit=main(page).getByRole('button',{name:'Submit',exact:true})
  await q.fill('0');await r.fill('11');await submit.tap()
  await expect(q).toBeFocused();expect(await q.evaluate((e:HTMLInputElement)=>[e.selectionStart,e.selectionEnd])).toEqual([0,1])
  for(let i=0;i<5;i++){
    await expect(main(page).getByLabel('Question progress')).toHaveText(`${i+1} / 5`)
    await q.fill('12');await r.fill('11');await submit.tap()
    if(i<4)await expect(q).toBeFocused()
  }
  await expect(main(page).getByLabel('Round result')).toContainText('4 / 5')
  expect((await events(page)).filter(e=>e.kind==='attempt')).toHaveLength(6)
  await main(page).getByRole('button',{name:'New round'}).tap();await expect(q).toBeFocused()
  await main(page).getByRole('button',{name:'Cancel',exact:true}).tap();await page.reload()
  await expect(main(page).getByRole('button',{name:'Start',exact:true})).toBeVisible()
  expect((await events(page)).filter(e=>e.kind==='cancel')).toHaveLength(1)
})
test('touch save failure keeps exact pending event and disables Cancel until retry succeeds',async({page})=>{
  await page.addInitScript(()=>{Math.random=()=>0.99999});await page.goto('/division');await main(page).getByRole('button',{name:'Start',exact:true}).tap()
  await quotient(page).fill('12');await remainder(page).fill('11')
  await page.evaluate(()=>{const w=window as any;w.originalSet=Storage.prototype.setItem;w.writes=[];Storage.prototype.setItem=function(k,v){w.writes.push([k,v]);throw new DOMException('Full','QuotaExceededError')}})
  await main(page).getByRole('button',{name:'Submit',exact:true}).tap()
  await expect(main(page).getByRole('button',{name:'Cancel',exact:true})).toBeDisabled()
  await expect(main(page).getByRole('button',{name:'Submit',exact:true})).toBeDisabled()
  const pending=await page.evaluate(()=>(window as any).writes[0])
  await page.evaluate(()=>{Storage.prototype.setItem=(window as any).originalSet})
  await main(page).getByRole('button',{name:'Retry saving'}).tap()
  await expect(main(page).getByLabel('Question progress')).toHaveText('2 / 5')
  expect(await page.evaluate(k=>localStorage.getItem(k),pending[0])).toBe(pending[1])
  await main(page).getByRole('button',{name:'Cancel',exact:true}).tap();await page.reload()
  expect(await page.evaluate(k=>localStorage.getItem(k),pending[0])).toBe(pending[1])
})
for(const theme of ['dark','light'])test(`division ${theme} max operands and tap targets fit narrow/keyboard-height viewports`,async({page})=>{
  await page.addInitScript(theme=>{localStorage.setItem('arithmetic:theme',theme);Math.random=()=>0.99999},theme)
  await page.goto('/division');await main(page).getByRole('button',{name:'Start',exact:true}).tap()
  await quotient(page).fill('12');await remainder(page).fill('11')
  for(const [width,height]of [[320,568],[375,667],[390,320],[667,320],[812,375]]){
    await page.setViewportSize({width,height})
    for(const name of ['Submit','Cancel']){
      const box=(await main(page).getByRole('button',{name,exact:true}).boundingBox())!
      expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44)
      expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width)
      expect(box.y+box.height).toBeLessThanOrEqual(height)
    }
    for(const field of [quotient(page),remainder(page)]){
      expect(await field.evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(16)
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await page.screenshot({path:`artifacts/integrated-division-${theme}-${width}x${height}.png`})
  }
})
