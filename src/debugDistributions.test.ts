import { expect, test } from 'vitest'
import { debugDistributions, histogram, countTicks } from './debugDistributions'
import { samplerDiagnostics } from './scheduler'

test('count ticks stay integer and use nice intervals for sparse and full populations',()=>{
  expect(countTicks(0)).toEqual([0,1])
  expect(countTicks(1)).toEqual([0,1])
  expect(countTicks(3)).toEqual([0,1,2,3])
  expect(countTicks(75)).toEqual([0,50,100])
  expect(countTicks(144)).toEqual([0,50,100,150])
})

test('coverage uses every supported discrete value, including empty categories',()=>{
  const snapshot=samplerDiagnostics([],0)
  snapshot.rows.forEach((q,i)=>{q.coverageBoost=[0,16,32,48][i%4]!})
  const coverage=debugDistributions(snapshot,[])[0]!
  expect(coverage.bins.map(b=>[b.lower,b.upper,b.count])).toEqual([[0,0,36],[16,16,36],[32,32,36],[48,48,36]])
  const empty=debugDistributions(samplerDiagnostics([],0),[])[0]!
  expect(empty.bins.map(b=>b.count)).toEqual([0,0,0,144])
})

test('histogram bins include zeros and maximum exactly once, use whole population and separate missing values',()=>{
  const h=histogram([0,0,1,2,3,4,null],4,4)
  expect(h.bins.map(b=>b.count)).toEqual([2,1,1,2])
  expect(h.known).toBe(6);expect(h.missing).toBe(1)
  expect(h.bins.map(b=>[b.lower,b.upper])).toEqual([[0,1],[1,2],[2,3],[3,4]])
  expect(histogram([0,0],0,4).bins.reduce((n,b)=>n+b.count,0)).toBe(2)
})

test('continuous bins have nice observed-domain edges, exact boundary membership and no clamped outliers',()=>{
  expect(histogram([0,0.1,1.99,2,4,8.1,null],undefined,5).bins).toEqual([
    {lower:0,upper:2,count:3},{lower:2,upper:4,count:1},{lower:4,upper:6,count:1},{lower:6,upper:8,count:0},{lower:8,upper:10,count:1},
  ])
  const h=histogram([-3,0,1,999,null,NaN,Infinity],2)
  expect(h.known).toBe(4);expect(h.missing).toBe(3)
  expect(h.bins[0]!.lower).toBeLessThanOrEqual(-3)
  expect(h.bins.at(-1)!.upper).toBeGreaterThanOrEqual(999)
  for(const value of [-3,0,1,999])expect(h.bins.filter((b,i)=>value>=b.lower&&(value<b.upper||i===h.bins.length-1&&value<=b.upper))).toHaveLength(1)
  for(const values of [[0,0],[4.125,4.125],[],[null,null]]) {
    const equal=histogram(values)
    expect(equal.bins.length).toBeLessThanOrEqual(1)
    expect(equal.bins.reduce((sum,b)=>sum+b.count,0)).toBe(values.filter(v=>v!==null).length)
  }
  const snapshot=samplerDiagnostics([],0)
  snapshot.rows.forEach((q,i)=>{q.errorBoost=i===0?8.1:0;q.speedBoost=i===0?0.83:0;q.total=i===0?62.05:0.05})
  const d=debugDistributions(snapshot,[])
  expect(d.find(h=>h.key==='errorBoost')!.bins.at(-1)!.upper).toBe(10)
  expect(d.find(h=>h.key==='speedBoost')!.bins.at(-1)!.upper).toBe(1)
  expect(d.find(h=>h.key==='total')!.bins.at(-1)!.upper).toBe(80)
})

test('all seven diagnostic histograms share 144-row population and retain absent accuracy and time',()=>{
  const d=debugDistributions(samplerDiagnostics([],0),[])
  expect(d.map(x=>x.key)).toEqual(['coverageBoost','errorBoost','speedBoost','total','probability','accuracy','averageSolveMs'])
  for(const h of d) {expect(h.known+h.missing).toBe(144);expect(h.bins.reduce((n,b)=>n+b.count,0)).toBe(h.known)}
  expect(d.find(x=>x.key==='accuracy')).toMatchObject({known:0,missing:144})
  expect(d.find(x=>x.key==='averageSolveMs')).toMatchObject({known:0,missing:144})
})
