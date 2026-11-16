import { expect, test } from 'vitest'
import * as distributions from './debugDistributions'
import { samplerDiagnostics } from './scheduler'

test('histogram bins include zeros and maximum exactly once, use whole population and separate missing values',()=>{
  expect(distributions).toHaveProperty('histogram')
  const h=distributions.histogram([0,0,1,2,3,4,null],4,4)
  expect(h.bins.map(b=>b.count)).toEqual([2,1,1,2])
  expect(h.known).toBe(6);expect(h.missing).toBe(1)
  expect(h.bins.map(b=>[b.lower,b.upper])).toEqual([[0,1],[1,2],[2,3],[3,4]])
  expect(distributions.histogram([0,0],0,4).bins.reduce((n,b)=>n+b.count,0)).toBe(2)
})

test('all seven diagnostic histograms share 144-row population and retain absent accuracy and time',()=>{
  const d=distributions.debugDistributions(samplerDiagnostics([],0),[])
  expect(d.map(x=>x.key)).toEqual(['coverageBoost','errorBoost','speedBoost','total','probability','accuracy','averageSolveMs'])
  for(const h of d) {expect(h.known+h.missing).toBe(144);expect(h.bins.reduce((n,b)=>n+b.count,0)).toBe(h.known)}
  expect(d.find(x=>x.key==='accuracy')).toMatchObject({known:0,missing:144})
  expect(d.find(x=>x.key==='averageSolveMs')).toMatchObject({known:0,missing:144})
  expect(d.find(x=>x.key==='probability')!.bins.reduce((n,b)=>n+b.count,0)).toBe(144)
})
