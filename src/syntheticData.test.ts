import { expect, test } from 'vitest'
import { generateSyntheticHistory } from './syntheticData'
import { loadAttempts, loadStorageWarnings } from './storage'
import { loadDivisionEvents } from './division'
import { aggregateStatistics } from './statistics'
import { groupQuestions } from './questions'
import type { AttemptRecord } from './types'
import { questionWeights } from './scheduler'

const now=Date.parse('2026-06-01T12:00:00.000Z')
function read(seed=71) {
  const history=generateSyntheticHistory(now,seed),map=new Map(Object.entries(history))
  Object.defineProperty(globalThis,'localStorage',{value:{get length(){return map.size},key:(i:number)=>[...map.keys()][i]??null,getItem:(k:string)=>map.get(k)??null},configurable:true})
  return {history,attempts:loadAttempts(),division:loadDivisionEvents(),stats:aggregateStatistics(loadAttempts())}
}
test('default demo is well-practised actual history, not a sparse edge-case fixture',()=>{
  const {attempts,division,stats}=read()
  expect(loadStorageWarnings()).toEqual([]);expect(division.warnings).toEqual([])
  expect(stats.pairs).toHaveLength(144)
  expect(Math.min(...stats.pairs.map(p=>p.solved))).toBeGreaterThanOrEqual(8)
  expect(stats.pairs.reduce((n,p)=>n+p.solved,0)).toBeGreaterThanOrEqual(2000)
  expect(stats.summary.completedRounds).toBeGreaterThanOrEqual(200)
  expect(new Set(stats.pairs.map(p=>p.solved)).size).toBeGreaterThan(8)
  expect(stats.pairs.every(p=>p.accuracy!==null && p.averageSolveMs!==null)).toBe(true)
  expect(questionWeights(attempts,now).every(row=>row.coverageBoost===0)).toBe(true)
  expect(attempts.every(a=>a.elapsedMs>0 && a.elapsedMs<60000)).toBe(true)
  expect(new Set(attempts.map(a=>a.submittedAt.slice(0,10))).size).toBeGreaterThan(50)
  const starts=division.events.filter(e=>e.kind==='start'),answers=division.events.filter(e=>e.kind==='attempt')
  expect(answers.filter(a=>a.correct).length).toBeGreaterThanOrEqual(400)
  expect(starts.filter(s=>s.questions.length===5).length).toBeGreaterThan(60)
  expect(starts.some(s=>s.questions.length===10)).toBe(true)
  expect(new Set(answers.map(e=>e.divisor)).size).toBe(12)
})

const mean=(values:number[])=>values.reduce((sum,n)=>sum+n,0)/values.length
for(const seed of [1,71,2026,98765])test(`seed ${seed}: noisy nine speed and twelve error trends survive recent practice`,()=>{
  const {attempts,stats}=read(seed)
  const first=groupQuestions(attempts).map(q=>q[0]).sort((a,b)=>a.submittedAt.localeCompare(b.submittedAt))
  for(const sample of [first,first.slice(-512),first.slice(-256)]) {
    const nine=(a:AttemptRecord)=>a.left===9 || a.right===9
    const twelve=(a:AttemptRecord)=>a.left===12 || a.right===12
    const clean=sample.filter(a=>a.correct)
    expect.soft(mean(clean.filter(nine).map(a=>a.elapsedMs))/mean(clean.filter(a=>!nine(a)).map(a=>a.elapsedMs))).toBeGreaterThan(1.6)
    const error=(rows:AttemptRecord[])=>rows.filter(a=>!a.correct).length/rows.length
    expect(error(sample.filter(twelve))-error(sample.filter(a=>!twelve(a)))).toBeGreaterThan(0.15)
    expect(error(sample.filter(twelve))).toBeLessThan(0.65)
  }
  for(const factor of [9,12]) {
    const cohort=stats.pairs.filter(p=>p.left===factor || p.right===factor)
    expect(new Set(cohort.map(p=>p.solved)).size).toBeGreaterThan(5)
    expect(new Set(cohort.map(p=>p.accuracy)).size).toBeGreaterThan(10)
    expect(new Set(cohort.map(p=>p.averageSolveMs)).size).toBe(cohort.length)
  }
})

test('deterministic valid chronological identities and retries stay within a bounded storage budget',()=>{
  const {history,attempts,division,stats}=read()
  expect(history).toEqual(generateSyntheticHistory(now,71))
  expect(history).not.toEqual(generateSyntheticHistory(now,72))
  expect(Object.keys(history).length).toBe(new Set(Object.keys(history)).size)
  for(const rows of groupQuestions(attempts)) {
    expect(rows.filter(a=>a.correct)).toHaveLength(1)
    expect(rows.at(-1)!.correct).toBe(true)
    for(let i=1;i<rows.length;i++) {
      expect(rows[i].elapsedMs).toBeGreaterThan(rows[i-1].elapsedMs)
      expect(Date.parse(rows[i].submittedAt)-Date.parse(rows[i-1].submittedAt)).toBe(rows[i].elapsedMs-rows[i-1].elapsedMs)
    }
  }
  expect(stats.summary.questions).toBe(attempts.filter(a=>a.correct).length)
  expect(stats.summary.errors).toBe(attempts.filter(a=>!a.correct).length)
  const rounds=new Map<string,typeof attempts>()
  for(const a of attempts)rounds.set(a.roundId,[...(rounds.get(a.roundId)??[]),a])
  for(const [roundId,rows] of rounds) {
    const presentations=groupQuestions(rows)
    for(let i=0;i<presentations.length;i++)expect(presentations[i][0].questionIndex).toBe(i)
    if(presentations.length!==10)expect(history['arithmetic:round-cancel:v1:'+roundId]).toBeDefined()
  }
  const starts=division.events.filter(e=>e.kind==='start')
  for(const start of starts) {
    const answers=division.events.filter(e=>e.kind==='attempt' && e.roundId===start.roundId)
    answers.forEach((a,i)=>{
      if(a.kind!=='attempt')throw Error('Expected attempt')
      expect(a.sequence).toBe(i)
      expect(Date.parse(a.submittedAt)).toBeGreaterThan(Date.parse(start.submittedAt))
      for(const key of ['divisor','dividend','quotient','remainder'] as const)expect(a[key]).toBe(start.questions[a.questionIndex][key])
    })
    const canceled=division.events.some(e=>e.kind==='cancel' && e.roundId===start.roundId)
    if(!canceled)expect(answers.filter(a=>a.kind==='attempt' && a.correct)).toHaveLength(start.questions.length)
  }
  expect(new Set(division.events.filter(e=>e.kind==='attempt').map(e=>`${e.divisor}:${e.quotient}`)).size).toBeGreaterThan(130)
  const entries=Object.entries(history),keyChars=entries.reduce((n,[k])=>n+k.length,0),valueChars=entries.reduce((n,[,v])=>n+v.length,0)
  const envelope=JSON.stringify({version:1,history})
  expect(keyChars+valueChars).toBeLessThan(1200000)
  // Worst demo-sized original backup + full journal + current history coexist.
  expect(keyChars+valueChars+2*envelope.length+500).toBeLessThan(4000000)
})
