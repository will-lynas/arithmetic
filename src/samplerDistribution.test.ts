import { expect, test } from 'vitest'
import { COVERAGE_BOOSTS, samplerDiagnostics } from './scheduler'
import type { AttemptRecord } from './types'

const now=Date.parse('2026-06-01T00:00:00Z')
const id=(n:number)=>`00000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`
const row=(n:number,left:number,right:number,roundId=id(n+1000),questionIndex=0):AttemptRecord=>({version:1,id:id(n),roundId,questionIndex,left,right,answer:left*right,correct:true,elapsedMs:1000,submittedAt:new Date(now+n*1000).toISOString()})

test('equal and empty histories are uniform with stable operand tie breaks',()=>{
  for(const history of [[],Array.from({length:432},(_,i)=>row(i+1,Math.floor(i/36)+1,Math.floor(i/3)%12+1))]) {
    const data=samplerDiagnostics(history,now)
    expect(data.rows.filter(q=>q.eligible).every(q=>Math.abs(q.probability-1/data.eligibleCount)<1e-12)).toBe(true)
    for(let i=1;i<data.rows.length;i++) {
      const a=data.rows[i-1]!,b=data.rows[i]!
      if(a.probability===b.probability) expect(a.left*12+a.right).toBeLessThan(b.left*12+b.right)
    }
    expect(data.coverage.reduce((sum,c)=>sum+c.count,0)).toBe(144)
    expect(data.coverage.reduce((sum,c)=>sum+c.probability,0)).toBeCloseTo(1,12)
    expect(data.factors.reduce((sum,c)=>sum+c.score,0)).toBeCloseTo(data.totalWeight,9)
  }
})

test('owned round is ordered last for cooldown and exact cap, fresh round does not inherit cap',()=>{
  const roundId=id(9000)
  const history=[row(1,9,6,roundId,0),row(2,9,6,roundId,1),row(3,1,2),row(4,3,4)]
  const active=samplerDiagnostics(history,now,roundId)
  const capped=active.rows.find(q=>q.left===9&&q.right===6)!
  expect(capped.exclusions).toHaveLength(2)
  expect(capped.probability).toBe(0)
  expect(capped.total).toBeGreaterThan(0)
  expect(active.rows.find(q=>q.left===6&&q.right===9)!.probability).toBe(0)
  const fresh=samplerDiagnostics(history,now)
  expect(fresh.rows.find(q=>q.left===9&&q.right===6)!.probability).toBeGreaterThan(0)
  expect(fresh.rows.find(q=>q.left===4&&q.right===3)!.probability).toBe(0)
})

test('raw factors keep corrected failures, uncapped completion and bounded slow clean evidence separate',()=>{
  const base=Array.from({length:20},(_,i)=>row(i+1,1+i%2,1+i%10))
  const wrong={...row(40,9,6),correct:false,answer:-1}
  const correction={...wrong,id:id(41),correct:true,answer:54,elapsedMs:5000}
  const slow={...row(42,8,7),elapsedMs:8000}
  const data=samplerDiagnostics([...base,wrong,correction,slow,row(43,3,4),row(44,4,5)],now)
  expect(data.rows.find(q=>q.left===9&&q.right===6)).toMatchObject({completed:1,coverageBoost:COVERAGE_BOOSTS[1],speedBoost:0})
  expect(data.rows.find(q=>q.left===9&&q.right===6)!.errorBoost).toBeGreaterThan(0)
  expect(data.rows.find(q=>q.left===8&&q.right===7)!.speedBoost).toBeGreaterThan(0)
})
