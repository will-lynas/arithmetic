import { expect, test } from 'vitest'
import { generateSyntheticHistory } from './syntheticData'
import { loadAttempts, loadStorageWarnings } from './storage'
import { loadDivisionEvents } from './division'
import { aggregateStatistics } from './statistics'
test('seeded real events validate through production readers and span coverage, timing, errors and division plans',()=>{
  const now=Date.parse('2026-06-01T12:00:00.000Z')
  const history=generateSyntheticHistory(now,71)
  expect(history).toEqual(generateSyntheticHistory(now,71));expect(history).not.toEqual(generateSyntheticHistory(now,72))
  const map=new Map(Object.entries(history))
  Object.defineProperty(globalThis,'localStorage',{value:{get length(){return map.size},key:(i:number)=>[...map.keys()][i]??null,getItem:(k:string)=>map.get(k)??null},configurable:true})
  expect(loadStorageWarnings()).toEqual([]);expect(loadDivisionEvents().warnings).toEqual([])
  const attempts=loadAttempts(), stats=aggregateStatistics(attempts)
  const counts=stats.pairs.map(p=>p.solved)
  for(const n of [0,1,2,3])expect(counts).toContain(n)
  expect(Math.max(...counts)).toBeGreaterThan(3)
  expect(attempts.filter(a=>a.correct).length).toBeGreaterThan(12)
  expect(attempts.some(a=>a.elapsedMs===0)).toBe(true);expect(attempts.some(a=>a.elapsedMs>20000)).toBe(true)
  expect(attempts.some(a=>!a.correct && Date.parse(a.submittedAt)>now-86400000)).toBe(true)
  expect(attempts.some(a=>!a.correct && Date.parse(a.submittedAt)<now-30*86400000)).toBe(true)
  expect(stats.summary.completedRounds).toBeGreaterThan(0)
  const division=loadDivisionEvents().events
  expect(new Set(division.filter(e=>e.kind==='attempt').map(e=>e.divisor)).size).toBe(12)
  expect(division.some(e=>e.kind==='start' && e.questions.length===5)).toBe(true)
  expect(division.some(e=>e.kind==='start' && e.questions.length===10)).toBe(true)
  expect(division.some(e=>e.kind==='cancel')).toBe(true)
})
