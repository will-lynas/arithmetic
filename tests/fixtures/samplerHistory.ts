import type { AttemptRecord } from '../../src/types'

// Synthetic browser-acceptance observations only; never imported by the app.
export const syntheticNow=Date.parse('2026-06-01T12:00:00Z')
const uuid=(n:number)=>`00000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`
export function samplerHistory():AttemptRecord[] {
  const rows:AttemptRecord[]=[]
  for(let i=0;i<144;i++) for(let j=0;j<i%6;j++) {
    const left=Math.floor(i/12)+1,right=i%12+1,n=i*10+j
    const submittedAt=new Date(syntheticNow-(144-i)*300000-j*1000).toISOString()
    const row:AttemptRecord={version:1,id:uuid(n*2+1),roundId:uuid(10000+n),questionIndex:0,left,right,answer:left*right,correct:true,elapsedMs:i%5===0?8000:800+(i%8)*100,submittedAt}
    if(i%7===0) rows.push({...row,id:uuid(n*2+2),answer:-1,correct:false,elapsedMs:500})
    rows.push(row)
  }
  return rows
}
