import { appendAttempt, cancelRound } from './storage'
import { appendDivisionEvent } from './division'
import { beforeEach, expect, test } from 'vitest'
import { BACKUP_KEY, JOURNAL_KEY, captureHistory, replaceHistory, restoreHistory, recoverHistory } from './syntheticStore'
let storage: Storage
beforeEach(() => {
  const map = new Map<string,string>()
  storage = {get length(){return map.size},key:i=>[...map.keys()][i]??null,getItem:k=>map.get(k)??null,setItem:(k,v)=>{map.set(k,v)},removeItem:k=>{map.delete(k)},clear:()=>{throw Error('Never clear')}}
})
test('backs up exact malformed, future and unknown history bytes; restores scope only', () => {
  const original = {'arithmetic:attempt:v9:future':' { "version": 9, "extra":true }\n','arithmetic:round-cancel:v2:bad':'{','arithmetic:division:future':'raw\u0000bytes'}
  for(const [k,v] of Object.entries({...original,'arithmetic:theme':'light','other':'private','arithmetic:preference':'keep'})) storage.setItem(k,v)
  replaceHistory(storage, {'arithmetic:attempt:v1:generated':'synthetic'})
  expect(JSON.parse(storage.getItem(BACKUP_KEY)!)).toMatchObject({version:1,history:original})
  expect(captureHistory(storage)).toEqual({'arithmetic:attempt:v1:generated':'synthetic'})
  replaceHistory(storage, {'arithmetic:division:new':'second'})
  expect(JSON.parse(storage.getItem(BACKUP_KEY)!).history).toEqual(original)
  restoreHistory(storage)
  expect(captureHistory(storage)).toEqual(original)
  expect(storage.getItem('arithmetic:theme')).toBe('light');expect(storage.getItem('other')).toBe('private');expect(storage.getItem('arithmetic:preference')).toBe('keep')
  expect(storage.getItem(JOURNAL_KEY)).toBeNull()
})
for(const mode of ['throw','silent'] as const) for(const operation of ['load','restore'] as const) for(let failAt=1;failAt<=8;failAt++) {
  test(mode+' '+operation+' fails closed at write '+failAt,()=>{
    storage.setItem('arithmetic:attempt:v9:old',' { raw } ')
    const original=captureHistory(storage)
    if(operation==='restore') replaceHistory(storage,{'arithmetic:division:generated':'generated'})
    const before=captureHistory(storage)
    const set=storage.setItem.bind(storage),remove=storage.removeItem.bind(storage)
    let n=0
    const fail=()=>{if(++n!==failAt)return false;if(mode==='throw')throw Error('Quota');return true}
    storage.setItem=(k,v)=>{if(!fail())set(k,v)};storage.removeItem=k=>{if(!fail())remove(k)}
    let failed=false
    try {if(operation==='load')replaceHistory(storage,{'arithmetic:division:generated':'generated'});else restoreHistory(storage)}catch {failed=true}
    storage.setItem=set;storage.removeItem=remove
    const interrupted=storage.getItem(JOURNAL_KEY)!==null
    if(failed && interrupted)recoverHistory(storage)
    else if(failed)expect(captureHistory(storage)).toEqual(before)
    if(storage.getItem(BACKUP_KEY)!==null)expect(JSON.parse(storage.getItem(BACKUP_KEY)!).history).toEqual(original)
    if(!failed || interrupted)expect(captureHistory(storage)).toEqual(operation==='load'?{'arithmetic:division:generated':'generated'}:original)
    expect(storage.getItem(JOURNAL_KEY)).toBeNull()
  })
}
test('explicit restore can abandon an interrupted load without completing its oversized target',()=>{
  storage.setItem('arithmetic:attempt:v9:old','raw original')
  const original=captureHistory(storage),set=storage.setItem.bind(storage)
  storage.setItem=(k,v)=>{if(k==='arithmetic:division:generated')throw Error('Quota');set(k,v)}
  expect(()=>replaceHistory(storage,{'arithmetic:division:generated':'too large'})).toThrow('Quota')
  storage.setItem=set
  expect(storage.getItem(JOURNAL_KEY)).not.toBeNull()
  restoreHistory(storage)
  expect(captureHistory(storage)).toEqual(original);expect(storage.getItem(JOURNAL_KEY)).toBeNull()
})
test('all synchronous event writers refuse an unresolved replacement journal',()=>{
  Object.defineProperty(globalThis,'localStorage',{value:storage,configurable:true})
  storage.setItem(JOURNAL_KEY,'interrupted')
  const id='126a9d79-6343-457b-8b54-28aa2e85a912'
  expect(()=>appendAttempt({version:1,id,roundId:id,questionIndex:0,left:2,right:2,answer:4,correct:true,elapsedMs:0,submittedAt:'2026-01-01T00:00:00.000Z'})).toThrow('interrupted')
  expect(()=>cancelRound(id)).toThrow('interrupted')
  expect(()=>appendDivisionEvent({version:1,kind:'cancel',id,roundId:id,submittedAt:'2026-01-01T00:00:00.000Z'})).toThrow('interrupted')
  expect(captureHistory(storage)).toEqual({})
})
test('unknown backup and journal versions fail closed without touching source',()=>{
  storage.setItem('arithmetic:attempt:v9:old','raw');storage.setItem(BACKUP_KEY,'{"version":9}')
  const before=captureHistory(storage)
  expect(()=>replaceHistory(storage,{})).toThrow();expect(()=>restoreHistory(storage)).toThrow()
  expect(captureHistory(storage)).toEqual(before)
  storage.setItem(JOURNAL_KEY,'{"version":9}')
  expect(()=>recoverHistory(storage)).toThrow();expect(captureHistory(storage)).toEqual(before)
})
