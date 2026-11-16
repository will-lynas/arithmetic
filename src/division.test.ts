import { expect, test } from 'vitest'
import { divisionQuestion, appendDivisionEvent, loadDivisionEvents, type DivisionEvent, DIVISION_PREFIX } from './division'

function storage() {
  const values = new Map<string,string>()
  const api = {get length(){return values.size}, key:(i:number)=>[...values.keys()][i]??null, getItem:(k:string)=>values.get(k)??null, setItem:(k:string,v:string)=>{values.set(k,v)}}
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:api})
  return {values,api}
}
const id = '00000000-0000-4000-8000-000000000001'
const roundId = '00000000-0000-4000-8000-000000000002'
const attempt: DivisionEvent = {version:1,kind:'attempt',id,roundId,submittedAt:'2026-01-01T00:00:00.000Z', questionIndex:0,divisor:12,dividend:155,quotient:12,remainder:11,answerQuotient:12,answerRemainder:0,correct:false,elapsedMs:123,sequence:0}
test('division events are immutable, isolated and retain richer source bytes', () => {
  const {values} = storage()
  values.set('arithmetic:attempt:v1:legacy','{legacy}')
  const richer = {...attempt, metadata:{future:'kept'}}
  appendDivisionEvent(richer)
  const bytes = values.get(DIVISION_PREFIX+id)
  expect(loadDivisionEvents().events).toEqual([richer])
  expect(values.get(DIVISION_PREFIX+id)).toBe(bytes)
  expect(values.get('arithmetic:attempt:v1:legacy')).toBe('{legacy}')
  expect(()=>appendDivisionEvent({...attempt,elapsedMs:999})).toThrow()
  expect(values.get(DIVISION_PREFIX+id)).toBe(bytes)
})
test('failed writes and malformed or future source bytes never get repaired', () => {
  const {values,api} = storage()
  values.set(DIVISION_PREFIX+'broken','{')
  values.set('arithmetic:division:event:v9:future','{"version":9}')
  api.setItem = () => {throw new Error('Full')}
  expect(()=>appendDivisionEvent(attempt)).toThrow('Full')
  expect(loadDivisionEvents().warnings.length).toBeGreaterThan(0)
  expect(values.get(DIVISION_PREFIX+'broken')).toBe('{')
  expect(values.get('arithmetic:division:event:v9:future')).toBe('{"version":9}')
  expect(values.size).toBe(2)
})
test.each([5,10])('loads %i-question starts and every attempt without rewriting richer historical bytes', length => {
  const {values} = storage()
  const question = {divisor:12,quotient:12,remainder:11,dividend:155}
  const started = {version:1,kind:'start',id,roundId,submittedAt:attempt.submittedAt,questions:Array.from({length},()=>({...question,extra:{kept:true}})),metadata:{source:'archived'}}
  values.set(DIVISION_PREFIX+id,JSON.stringify(started,null,2))
  for(let i=0;i<length;i++) {
    const eventId = `00000000-0000-4000-8000-${String(i+10).padStart(12,'0')}`
    values.set(DIVISION_PREFIX+eventId,JSON.stringify({...attempt,id:eventId,questionIndex:i,sequence:i,metadata:{retained:i}},null,2))
  }
  const before = new Map(values)
  const loaded = loadDivisionEvents()
  expect(loaded.warnings).toEqual([])
  expect(loaded.events).toHaveLength(length+1)
  expect(loaded.events[0]).toEqual(started)
  expect(values).toEqual(before)
})
test('division spans the 12 by 12 tables plus zero and maximum remainders', () => {
  expect(divisionQuestion(() => 0)).toEqual({divisor:1, quotient:1, remainder:0, dividend:1})
  expect(divisionQuestion(() => 0.99999)).toEqual({divisor:12, quotient:12, remainder:11, dividend:155})
  for (let i=0;i<1000;i++) {
    const q = divisionQuestion()
    expect(q.divisor).toBeGreaterThanOrEqual(1); expect(q.divisor).toBeLessThanOrEqual(12)
    expect(q.quotient).toBeGreaterThanOrEqual(1); expect(q.quotient).toBeLessThanOrEqual(12)
    expect(q.remainder).toBeGreaterThanOrEqual(0); expect(q.remainder).toBeLessThan(q.divisor)
    expect(q.dividend).toBe(q.divisor*q.quotient+q.remainder)
  }
})
