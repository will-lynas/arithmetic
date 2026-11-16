import { expect, test, vi } from 'vitest'
import * as scheduler from './scheduler'
import { randomQuestion } from './game'
import type { AttemptRecord } from './types'

const now = Date.parse('2026-06-01T00:00:00Z')
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`
const record = (n: number, left = 9, right = 6, correct = true): AttemptRecord => ({version:1,id:uuid(n+1),roundId:uuid(n+1000),questionIndex:0,left,right,answer:correct?left*right:-1,correct,elapsedMs:1000,submittedAt:new Date(now+n*1000).toISOString()})

test('seeded fully weighted sampler output is stable and consumes exactly one draw per question', () => {
  const histories = [[], [record(1),record(2,3,4,false),record(3,2,2)], Array.from({length:432},(_,i)=>record(i,Math.floor(i/36)+1,Math.floor(i/3)%12+1))]
  const result = histories.map(history => {
    let state = 73, calls = 0
    const rng = () => {calls++; state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32}
    return {draws:Array.from({length:24},()=>randomQuestion(rng,history,undefined,now)),get calls(){return calls}}
  })
  expect(result.every(r=>r.calls===24)).toBe(true)
  expect(JSON.parse(JSON.stringify(result))).toMatchSnapshot()
})

test('diagnostic probabilities are exactly the single weighted roulette intervals, with no uniform component',()=>{
  const history=[record(1),record(2),record(3),record(4,2,2),record(5,3,4,false)]
  const data=scheduler.samplerDiagnostics(history,now)
  let cumulative=0
  for(const q of [...data.rows].filter(q=>q.eligible).sort((a,b)=>a.left-b.left||a.right-b.right)) {
    expect(q).not.toHaveProperty('uniformProbability')
    expect(q).not.toHaveProperty('weightedProbability')
    expect(q.probability).toBe(q.total/data.totalWeight)
    expect(q.probability).toBeGreaterThan(0)
    const random=vi.fn(()=>(cumulative+q.total/2)/data.totalWeight)
    expect(randomQuestion(random,history,undefined,now)).toEqual({left:q.left,right:q.right})
    expect(random).toHaveBeenCalledTimes(1)
    cumulative+=q.total
  }
})

test('diagnostics rank all 144 pairs with normalized chances, raw factors and no randomness or mutation', () => {
  expect(scheduler).toHaveProperty('samplerDiagnostics')
  const random = vi.spyOn(Math,'random').mockImplementation(()=>{throw Error('diagnostics used random')})
  const history = [record(1),record(2),record(3),record(4),record(5,2,2),record(6,3,4,false)]
  const bytes=JSON.stringify(history)
  try {
    const data=scheduler.samplerDiagnostics(history,now)
    expect(data.rows).toHaveLength(144)
    expect(new Set(data.rows.map(q=>`${q.left}x${q.right}`)).size).toBe(144)
    expect(data.rows.reduce((n,q)=>n+q.probability,0)).toBeCloseTo(1,12)
    expect(data.rows.find(q=>q.left===9&&q.right===6)).toMatchObject({completed:4,coverageBoost:0,floor:1,total:1})
    for (const row of data.rows) {
      expect(row.total).toBe(row.floor+row.weight)
      expect(row.difficultyWeight).toBe(row.errorBoost+row.speedBoost)
      expect(row.probability).toBe(row.eligible?row.total/data.totalWeight:0)
      if (!row.eligible) {expect(row.probability).toBe(0); expect(row.exclusions.length).toBeGreaterThan(0)}
    }
    for(let i=1;i<data.rows.length;i++) expect(data.rows[i-1]!.probability).toBeGreaterThanOrEqual(data.rows[i]!.probability)
    expect(JSON.stringify(history)).toBe(bytes)
    expect(random).not.toHaveBeenCalled()
  } finally {random.mockRestore()}
})
