import type { AttemptRecord } from './types'
import type { DivisionEvent, DivisionQuestion, DivisionStart } from './division'
import { DIVISION_PREFIX } from './division'
import { ATTEMPT_PREFIX, CANCELLATION_PREFIX } from './storage'
import type { HistoryBytes } from './syntheticStore'
// Invented observations only. All UI and sampling use the normal event readers.
export function generateSyntheticHistory(now=Date.now(),seed=71):HistoryBytes {
  let state=seed>>>0,serial=0
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296}
  const id=()=>`${(seed>>>0).toString(16).padStart(8,'0')}-0000-4000-8000-${(++serial).toString(16).padStart(12,'0')}`
  const history:HistoryBytes={}
  const date=(time:number)=>new Date(time).toISOString()
  const add=(event:AttemptRecord)=>{history[ATTEMPT_PREFIX+event.id]=JSON.stringify(event)}
  const integer=(n:number)=>Math.floor(random()*n)
  const shuffle=<T,>(items:T[])=>{for(let i=items.length-1;i>0;i--){const j=integer(i+1);[items[i],items[j]]=[items[j],items[i]]}return items}
  // Bounded, positively skewed retrieval times, not zero/extreme test fixtures.
  const duration=(base:number)=>Math.round(base*Math.exp((random()+random()+random()-1.5)*0.8))
  const pairs=Array.from({length:144},(_,i)=>{
    const left=Math.floor(i/12)+1,right=i%12+1
    const easy=[1,2,5,10].includes(left) || [1,2,5,10].includes(right)
    // Independent per-fact familiarity plus cohort trends; operand order stays distinct.
    const familiarity=0.85+random()*0.3,nine=left===9 || right===9,twelve=left===12 || right===12
    return {left,right,speed:2400*familiarity*(easy?0.72:1.1)*(nine?2.5:1),error:(twelve?0.42:easy?0.045:0.13)*(0.8+random()*0.4)}
  })
  const practice=shuffle(pairs.flatMap(pair=>Array.from({length:10+integer(11)},()=>pair)))
  const regularRounds=Math.ceil(practice.length/10),rounds=regularRounds+12
  for(let round=0;round<rounds;round++) {
    const roundId=id(),regular=round<regularRounds
    const questions=regular?practice.slice(round*10,round*10+10):Array.from({length:1+integer(6)},()=>pairs[integer(144)])
    let time=now-(rounds-round)*12*3600000+integer(3*3600000)
    for(const [questionIndex,{left,right,speed,error}] of questions.entries()) {
      const base={version:1 as const,roundId,questionIndex,left,right}
      let elapsed=duration(speed)
      const wrong=random()<error
      if(wrong) {
        time+=elapsed
        add({...base,id:id(),answer:left*right+1+integer(4),correct:false,elapsedMs:elapsed,submittedAt:date(time)})
        const correction=duration(1600)
        elapsed+=correction;time+=correction
      } else time+=elapsed
      add({...base,id:id(),answer:left*right,correct:true,elapsedMs:elapsed,submittedAt:date(time)})
      time+=600+integer(1600)
    }
    // Partials are canceled: no manufactured active round on reload.
    if(questions.length<10)history[CANCELLATION_PREFIX+roundId]=JSON.stringify({version:1,roundId,canceledAt:date(time+1000)})
  }
  const division=(event:DivisionEvent)=>{history[DIVISION_PREFIX+event.id]=JSON.stringify(event)}
  for(let round=0;round<96;round++) {
    const roundId=id(),length=round<8?10:5,partial=round>=88
    let time=now-(97-round)*86400000+integer(3*3600000)
    const questions:DivisionQuestion[]=Array.from({length},()=>{
      const divisor=1+integer(12),quotient=1+integer(12),remainder=integer(divisor)
      return {divisor,quotient,remainder,dividend:divisor*quotient+remainder}
    })
    const start:DivisionStart={version:1,kind:'start',id:id(),roundId,submittedAt:date(time),questions}
    division(start)
    let sequence=0
    const count=partial?1+integer(3):length
    for(let questionIndex=0;questionIndex<count;questionIndex++) {
      const q=questions[questionIndex],base={version:1 as const,kind:'attempt' as const,roundId,questionIndex,...q}
      let elapsed=duration(5200)
      const wrong=random()<0.23
      if(wrong) {
        time+=elapsed
        division({...base,id:id(),answerQuotient:q.quotient+1,answerRemainder:q.remainder,correct:false,elapsedMs:elapsed,sequence:sequence++,submittedAt:date(time)})
        const correction=duration(2300)
        elapsed+=correction;time+=correction
      } else time+=elapsed
      division({...base,id:id(),answerQuotient:q.quotient,answerRemainder:q.remainder,correct:true,elapsedMs:elapsed,sequence:sequence++,submittedAt:date(time)})
      time+=1000+integer(2000)
    }
    if(partial)division({version:1,kind:'cancel',id:id(),roundId,submittedAt:date(time+1000)})
  }
  return history
}
