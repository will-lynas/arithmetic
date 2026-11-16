import { expect, test, type Page } from '@playwright/test'
const backup='arithmetic:synthetic:backup:v1',journal='arithmetic:synthetic:journal:v1'
const history=(page:Page)=>page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(k=>/^(arithmetic:attempt:|arithmetic:round-cancel:|arithmetic:division:)/.test(k)).sort().map(k=>[k,localStorage.getItem(k)])))
async function open(page:Page){await page.locator('body').click({position:{x:5,y:5}});await page.keyboard.press('Control+Alt+Shift+KeyS');await expect(page.getByRole('dialog')).toBeVisible()}
async function choose(page:Page,operation:string){await open(page);await page.getByRole('button',{name:operation==='load'?'Load synthetic data':'Restore backup',exact:true}).click()}
async function confirm(page:Page,operation:string){await page.getByRole('button',{name:operation==='load'?'Replace all practice data':'Restore original backup',exact:true}).click()}
for(const operation of ['load','restore'])for(const failure of ['throw','silent','readback'])for(const stage of ['backup','journal','history-remove','history-set','epoch','journal-remove']) {
  if(operation==='restore' && stage==='backup')continue
  test(operation+' '+failure+' at '+stage+' retains backup and safely recovers after reload',async({page})=>{
    await page.goto('/multiplication/stats')
    await page.evaluate(()=>{localStorage.setItem('arithmetic:attempt:v9:original',' { unknown original }\n');localStorage.setItem('arithmetic:division:original',' raw division ');localStorage.setItem('arithmetic:theme','light');localStorage.setItem('unrelated','preserved')})
    const original=await history(page)
    if(operation==='restore') {
      await choose(page,'load');await confirm(page,'load');await expect(page.getByRole('status')).toHaveText('Synthetic data loaded.');await page.getByRole('button',{name:'Cancel',exact:true}).click()
    }
    const before=await history(page)
    await choose(page,operation)
    await page.evaluate(({failure,stage})=>{
      const set=Storage.prototype.setItem,remove=Storage.prototype.removeItem,get=Storage.prototype.getItem
      let fired=false,readKey:string|null=null
      const matches=(k:string,removing:boolean)=>stage==='backup'?k==='arithmetic:synthetic:backup:v1':stage==='journal'?k==='arithmetic:synthetic:journal:v1'&&!removing:stage==='epoch'?k==='arithmetic:synthetic:epoch:v1':stage==='journal-remove'?k==='arithmetic:synthetic:journal:v1'&&removing:stage==='history-remove'?removing && !k.includes(':synthetic:'):!removing && !k.includes(':synthetic:')
      const intercept=(k:string,removing:boolean)=>{
        if(fired || !matches(k,removing))return false
        fired=true;(window as any).faultFired=true
        if(failure==='throw')throw new DOMException('Injected quota failure','QuotaExceededError')
        if(failure==='silent')return true
        readKey=k;return false
      }
      Storage.prototype.setItem=function(k,v){if(!intercept(k,false))set.call(this,k,v)}
      Storage.prototype.removeItem=function(k){if(!intercept(k,true))remove.call(this,k)}
      Storage.prototype.getItem=function(k){if(k===readKey){readKey=null;return 'injected incorrect readback'}return get.call(this,k)}
    },{failure,stage})
    await confirm(page,operation)
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('No success was recorded')
    expect(await page.evaluate(()=>(window as any).faultFired)).toBe(true)
    const retained=await page.evaluate(k=>localStorage.getItem(k),backup)
    if(retained!==null)expect(JSON.parse(retained).history).toEqual(original)
    const pending=await page.evaluate(k=>localStorage.getItem(k),journal)
    if(!pending) {
      if(stage==='journal-remove') {if(operation==='restore')expect(await history(page)).toEqual(original);else expect(Object.keys(await history(page)).length).toBeGreaterThan(500)}
      else expect(await history(page)).toEqual(before)
    }
    // A page reload removes injected failures, not the persisted transaction.
    await page.reload()
    if(pending) {
      await expect(page.getByRole('alert')).toContainText('interrupted data change')
      await expect(page.locator('.app')).toHaveClass('app light')
      await expect(page.getByRole('button',{name:'Start',exact:true})).toHaveCount(0)
      await open(page);await page.getByRole('button',{name:'Recover interrupted change'}).click();await expect(page.getByRole('button',{name:'Cancel',exact:true})).toBeFocused()
      await page.getByRole('button',{name:'Confirm recovery'}).click();await expect(page.getByRole('status')).toHaveText('Interrupted change recovered.')
    }else {
      await choose(page,operation);await confirm(page,operation);await expect(page.getByRole('status')).toHaveText(operation==='load'?'Synthetic data loaded.':'Original backup restored.')
    }
    expect(await page.evaluate(k=>localStorage.getItem(k),journal)).toBeNull()
    expect(JSON.parse((await page.evaluate(k=>localStorage.getItem(k),backup))!).history).toEqual(original)
    if(operation==='restore')expect(await history(page)).toEqual(original)
    else expect(Object.keys(await history(page)).length).toBeGreaterThan(500)
    expect(await page.evaluate(()=>[localStorage.getItem('arithmetic:theme'),localStorage.getItem('unrelated')])).toEqual(['light','preserved'])
  })
}
test('interrupted replacement may instead be explicitly rolled back to the original backup',async({page})=>{
  await page.goto('/multiplication/stats');await page.evaluate(()=>localStorage.setItem('arithmetic:attempt:v9:original','unreadable original'))
  const original=await history(page)
  await choose(page,'load')
  await page.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('arithmetic:attempt:v1:'))throw Error('Interrupted');set.call(this,k,v)}})
  await confirm(page,'load');await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();await page.reload()
  await choose(page,'restore');await confirm(page,'restore');await expect(page.getByRole('status')).toHaveText('Original backup restored.')
  expect(await history(page)).toEqual(original)
})
