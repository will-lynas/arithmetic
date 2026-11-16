import { samplerDiagnostics } from './scheduler'
import { aggregateStatistics } from './statistics'
import type { AttemptRecord } from './types'

const tidy=(value:number)=>Number(value.toPrecision(15))
const niceStep=(value:number)=>{
  const power=10**Math.floor(Math.log10(value))
  return [1,2,5,10].find(n=>n*power>=value)!*power
}

export function countTicks(maximum:number) {
  const step=Math.max(1,niceStep(Math.max(1,maximum)/3))
  return Array.from({length:Math.max(1,Math.ceil(maximum/step))+1},(_,i)=>i*step)
}

// Half-open intervals, final upper edge inclusive. Never clamp observations.
export function histogram(values: readonly (number|null)[], maximum?: number, count=6) {
  const knownValues=values.filter((v):v is number=>v!==null&&Number.isFinite(v))
  const known=knownValues.length,missing=values.length-known
  if(!known)return {bins:[] as {lower:number;upper:number;count:number}[],known,missing}
  const min=Math.min(...knownValues),max=Math.max(...knownValues,maximum??-Infinity)
  const equal=min===max&&maximum===undefined
  const step=niceStep(equal ? Math.max(Math.abs(max)/5,1) : (max-Math.min(0,min)||1)/count)
  const lower=tidy(Math.floor((equal?min:Math.min(0,min))/step)*step)
  const upper=tidy(Math.max(lower+step,Math.ceil(max/step)*step))
  const length=Math.round((upper-lower)/step)
  const bins=Array.from({length},(_,i)=>({lower:tidy(lower+i*step),upper:tidy(lower+(i+1)*step),count:0}))
  for(const value of knownValues) {
    const bin=bins.find((b,i)=>value>=b.lower&&(value<b.upper||i===length-1&&value<=b.upper))!
    bin.count++
  }
  return {bins,known,missing}
}

export function debugDistributions(snapshot: ReturnType<typeof samplerDiagnostics>, attempts:readonly AttemptRecord[]) {
  const stats=aggregateStatistics(attempts)
  const byPair=new Map(stats.pairs.map(q=>[`${q.left}x${q.right}`,q]))
  const fields=[
    {key:'coverageBoost',title:'Coverage boost',unit:'',values:snapshot.rows.map(q=>q.coverageBoost)},
    {key:'errorBoost',title:'Error boost',unit:'',values:snapshot.rows.map(q=>q.errorBoost)},
    {key:'speedBoost',title:'Speed boost',unit:'',values:snapshot.rows.map(q=>q.speedBoost)},
    {key:'total',title:'Total weight',unit:'',values:snapshot.rows.map(q=>q.total)},
    {key:'probability',title:'Next-draw chance',unit:'%',values:snapshot.rows.map(q=>100*q.probability)},
    {key:'accuracy',title:'First-try accuracy',unit:'%',values:snapshot.rows.map(q=>byPair.get(`${q.left}x${q.right}`)!.accuracy)},
    {key:'averageSolveMs',title:'Average solve time',unit:'s',values:snapshot.rows.map(q=>{const ms=byPair.get(`${q.left}x${q.right}`)!.averageSolveMs;return ms===null?null:ms/1000})},
  ]
  return fields.map(field=>{
    const distribution=field.key==='coverageBoost'
      ? {bins:[0,16,32,48].map(value=>({lower:value,upper:value,count:field.values.filter(v=>v===value).length})),known:field.values.length,missing:0}
      : histogram(field.values,field.key==='accuracy'?100:undefined,field.key==='accuracy'?5:6)
    return {key:field.key,title:field.title,unit:field.unit,...distribution}
  })
}
