import { expect, test } from 'vitest'
import { writeFileSync } from 'node:fs'
import { randomQuestion } from './game'
import { questionWeights } from './scheduler'
import { groupQuestions } from './questions'
import type { AttemptRecord } from './types'

const now = Date.parse('2026-06-01T00:00:00.000Z')
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`
function seeded(seed: number) {
  return () => { seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/2**32 }
}
type Selector = typeof randomQuestion
// Comparison-only curves retain the real difficulty scores and eligibility.
function geometric(start: number, decay: number): Selector {
  return (random=Math.random, history=[], roundId) => {
    const observed = groupQuestions(history).map(rows => rows[0]!)
    const cooling = new Set(observed.slice(-2).flatMap(q => [`${q.left}x${q.right}`,`${q.right}x${q.left}`]))
    const completions = new Map<string,number>()
    for (const rows of groupQuestions(history)) if (rows.some(q=>q.correct)) {
      const q=rows[0]!, key=`${q.left}x${q.right}`
      completions.set(key,(completions.get(key)??0)+1)
    }
    const choices=questionWeights(history,now,roundId).filter(q=>!cooling.has(`${q.left}x${q.right}`)
      && observed.filter(a=>a.roundId===roundId && a.left===q.left && a.right===q.right).length<2)
      .map(q=>{ const n=completions.get(`${q.left}x${q.right}`)??0
        return {...q,total:1+(n<3?start/decay**n:0)+q.difficultyWeight} })
    let target=random()*choices.reduce((sum,q)=>sum+q.total,0)
    return choices.find(q=>(target-=q.total)<0)??choices.at(-1)!
  }
}
function trajectory(select: Selector, seed: number, limit: number) {
  const random=seeded(seed), history: AttemptRecord[]=[], completed=new Set<string>(), recent:string[]=[]
  let distinct144=0, full:number|null=null
  for(let n=0;n<limit;n++) {
    const roundId=uuid(10000+Math.floor(n/10)), questionIndex=n%10
    const q=select(random,history,roundId,now), key=`${q.left}x${q.right}`
    expect(recent.slice(-2)).not.toContain(key)
    expect(recent.slice(-2)).not.toContain(`${q.right}x${q.left}`)
    expect(recent.slice(Math.floor(n/10)*10).filter(k=>k===key).length).toBeLessThan(2)
    const row:AttemptRecord={version:1,id:uuid(n*2+1),roundId,questionIndex,...q,answer:q.left*q.right,correct:true,
      elapsedMs:q.left===9?8000:1000,submittedAt:new Date(now+n*1000).toISOString()}
    // Some first attempts fail; mandatory correction is still one completion.
    if(n%7===0) history.push({...row,id:uuid(n*2+2),correct:false,answer:-1,elapsedMs:500})
    history.push(row); completed.add(key); recent.push(key)
    if(n===143) distinct144=completed.size
    if(completed.size===144) { full=n+1; break }
  }
  return {seed,distinct144,full}
}
function summary(rows:ReturnType<typeof trajectory>[],limit:number) {
  const quantile=(numbers:number[],p:number)=>[...numbers].sort((a,b)=>a-b)[Math.ceil(numbers.length*p)-1]!
  const full=rows.map(r=>r.full??limit+1)
  return {runs:rows.length,atLeast135:rows.filter(r=>r.distinct144>=135).length,
    unique144:{min:Math.min(...rows.map(r=>r.distinct144)),median:quantile(rows.map(r=>r.distinct144),0.5)},
    fullCoverage:{median:quantile(full,0.5),p95:quantile(full,0.95),max:Math.max(...full),censored:rows.filter(r=>r.full===null).length}}
}

test('seeded cold starts strongly favour first completion without becoming a strict curriculum (not learning efficacy)',()=>{
  const rows=Array.from({length:96},(_,i)=>trajectory(randomQuestion,73+i*7919,220))
  const result=summary(rows,220)
  if(process.env.SAMPLER_METRICS) writeFileSync(`${process.env.SAMPLER_METRICS}-actual.json`,JSON.stringify({summary:result,rows},null,2))
  console.info('Cold-start trajectories:',JSON.stringify({summary:result,rows}))
  expect(result.atLeast135/result.runs).toBeGreaterThanOrEqual(0.95)
  expect(result.fullCoverage.median).toBeLessThanOrEqual(155)
  expect(result.fullCoverage.p95).toBeLessThanOrEqual(165)
  expect(result.fullCoverage.censored).toBe(0)
},240000)

test('bounded comparison of gentle and steep geometric coverage curves reports actual trajectory tails',()=>{
  const results=[2,16,32,64,128].map(decay=>{
    const start=12*decay**2
    const rows=Array.from({length:24},(_,i)=>trajectory(geometric(start,decay),73+i*7919,800))
    return {decay,boosts:[start,start/decay,12,0],summary:summary(rows,800),rows}
  })
  if(process.env.SAMPLER_METRICS) writeFileSync(`${process.env.SAMPLER_METRICS}-comparison.json`,JSON.stringify(results,null,2))
  console.info('Geometric policy comparison:',JSON.stringify(results))
  expect(results[3]!.rows).toEqual(Array.from({length:24},(_,i)=>trajectory(randomQuestion,73+i*7919,800)))
  expect(results[1]!.summary.unique144.median).toBeGreaterThan(results[0]!.summary.unique144.median)
  expect(results[2]!.summary.fullCoverage.p95).toBeLessThan(results[0]!.summary.fullCoverage.p95)
},240000)
