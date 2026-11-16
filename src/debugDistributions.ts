import { samplerDiagnostics } from './scheduler'
import { aggregateStatistics } from './statistics'
import type { AttemptRecord } from './types'

// Half-open equal-width intervals; the last interval includes its upper end.
// A zero-width population gets a real [0,1] display domain, never drops zero.
export function histogram(values: readonly (number|null)[], maximum: number, count=8) {
  const max=maximum>0 ? maximum : 1
  const bins=Array.from({length:count},(_,i)=>({lower:i*max/count,upper:(i+1)*max/count,count:0}))
  let missing=0
  for(const value of values) {
    if(value===null) {missing++;continue}
    bins[Math.min(count-1,Math.max(0,Math.floor(value/max*count)))]!.count++
  }
  return {bins,known:values.length-missing,missing}
}

export function debugDistributions(snapshot: ReturnType<typeof samplerDiagnostics>, attempts:readonly AttemptRecord[]) {
  const stats=aggregateStatistics(attempts)
  const byPair=new Map(stats.pairs.map(q=>[`${q.left}x${q.right}`,q]))
  const fields=[
    {key:'coverageBoost',title:'Coverage boost',unit:'raw score',max:48,values:snapshot.rows.map(q=>q.coverageBoost)},
    {key:'errorBoost',title:'Error boost',unit:'raw score',max:12,values:snapshot.rows.map(q=>q.errorBoost)},
    {key:'speedBoost',title:'Speed boost',unit:'raw score',max:2,values:snapshot.rows.map(q=>q.speedBoost)},
    {key:'total',title:'Total weight',unit:'raw score',max:62.05,values:snapshot.rows.map(q=>q.total)},
    {key:'probability',title:'Next-draw chance',unit:'% probability',max:0,values:snapshot.rows.map(q=>100*q.probability)},
    {key:'accuracy',title:'First-try accuracy',unit:'% correct per question',max:100,values:snapshot.rows.map(q=>byPair.get(`${q.left}x${q.right}`)!.accuracy)},
    {key:'averageSolveMs',title:'Average solve time',unit:'seconds',max:0,values:snapshot.rows.map(q=>{const ms=byPair.get(`${q.left}x${q.right}`)!.averageSolveMs;return ms===null?null:ms/1000})},
  ]
  return fields.map(field=>{
    const max=field.max||Math.max(0,...field.values.filter((v):v is number=>v!==null))
    return {key:field.key,title:field.title,unit:field.unit,...histogram(field.values,max)}
  })
}
