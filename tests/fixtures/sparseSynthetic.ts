// Historical sparse edge-case fixture, never loaded by the application.
import type { AttemptRecord } from '../../src/types'
import type { DivisionEvent, DivisionQuestion, DivisionStart } from '../../src/division'
import { DIVISION_PREFIX } from '../../src/division'
import { ATTEMPT_PREFIX, CANCELLATION_PREFIX } from '../../src/storage'
import type { HistoryBytes } from '../../src/syntheticStore'
// Invented observations only. All UI and sampling use the normal event readers.
export function generateSparseSyntheticHistory(now=Date.now(),seed=71):HistoryBytes {
  let state=seed>>>0,serial=0
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296}
  const id=()=>`${(seed>>>0).toString(16).padStart(8,'0')}-0000-4000-8000-${(++serial).toString(16).padStart(12,'0')}`
  const history:HistoryBytes={}
  const date=(time:number)=>new Date(time).toISOString()
  const add=(event:AttemptRecord)=>{history[ATTEMPT_PREFIX+event.id]=JSON.stringify(event)}
  for(let pair=0;pair<144;pair++) {
    const left=Math.floor(pair/12)+1,right=pair%12+1,count=pair%6
    for(let sample=0;sample<count;sample++) {
      const roundId=id(),old=(pair+sample)%3===0
      const time=now-(old?60*86400000:3600000)-(144-pair)*60000-sample*1000
      const elapsed=pair%17===0?0:pair%13===0?28000+sample*900:450+Math.floor(random()*6500)
      const base={version:1 as const,roundId,questionIndex:0,left,right}
      if((pair+sample)%7===0)add({...base,id:id(),answer:left*right+1,correct:false,elapsedMs:elapsed/2,submittedAt:date(time)})
      add({...base,id:id(),answer:left*right,correct:true,elapsedMs:elapsed,submittedAt:date(time+500)})
      if(sample%2===0)history[CANCELLATION_PREFIX+roundId]=JSON.stringify({version:1,roundId,canceledAt:date(time+1000)})
    }
    // Some zero-completion facts have wrong-only observations; others untouched.
    if(pair%12===6) {
      const roundId=id(),time=now-7200000-pair*1000
      add({version:1,id:id(),roundId,questionIndex:0,left,right,answer:left*right+2,correct:false,elapsedMs:9000,submittedAt:date(time)})
      history[CANCELLATION_PREFIX+roundId]=JSON.stringify({version:1,roundId,canceledAt:date(time+1000)})
    }
  }
  // One complete latest round makes reload deterministic, never auto-starting.
  const complete=id()
  for(let index=0;index<10;index++)add({version:1,id:id(),roundId:complete,questionIndex:index,left:12,right:index+1,answer:12*(index+1),correct:true,elapsedMs:index===0?0:700+index*400,submittedAt:date(now-600000+index*1000)})
  const division=(event:DivisionEvent)=>{history[DIVISION_PREFIX+event.id]=JSON.stringify(event)}
  for(let divisor=1;divisor<=12;divisor++) for(let sample=0;sample<3;sample++) {
    const roundId=id(),time=now-(sample===0?45*86400000:1800000)-divisor*60000-sample*10000
    const questions:DivisionQuestion[]=Array.from({length:sample===0?10:5},(_,i)=>{
      const quotient=1+Math.floor(random()*12),remainder=i%2===0?0:Math.floor(random()*divisor)
      return {divisor,quotient,remainder,dividend:divisor*quotient+remainder}
    })
    const start:DivisionStart={version:1,kind:'start',id:id(),roundId,submittedAt:date(time),questions}
    division(start)
    let sequence=0
    const count=sample===0?questions.length:sample===1?3:1
    for(let index=0;index<count;index++) {
      const q=questions[index],elapsed=divisor===1 && index===0?0:divisor%4===0?35000:900+Math.floor(random()*12000)
      const base={version:1 as const,kind:'attempt' as const,roundId,questionIndex:index,...q}
      if((divisor+index)%3===0 || sample===2)division({...base,id:id(),answerQuotient:q.quotient+1,answerRemainder:q.remainder,correct:false,elapsedMs:elapsed/2,sequence:sequence++,submittedAt:date(time+index*2000+500)})
      if(sample!==2)division({...base,id:id(),answerQuotient:q.quotient,answerRemainder:q.remainder,correct:true,elapsedMs:elapsed,sequence:sequence++,submittedAt:date(time+index*2000+1000)})
    }
    if(sample===2)division({version:1,kind:'cancel',id:id(),roundId,submittedAt:date(time+15000)})
  }
  return history
}
