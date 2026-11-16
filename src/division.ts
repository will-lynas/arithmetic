export const DIVISION_PREFIX = 'arithmetic:division:event:v1:'
export const DIVISION_ROUND_LENGTH = 5
// Version-one rounds previously contained ten questions; keep their planned length.
const LEGACY_ROUND_LENGTH = 10
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export type DivisionAttempt = DivisionQuestion & {version:1; kind:'attempt'; id:string; roundId:string; submittedAt:string; questionIndex:number; answerQuotient:number; answerRemainder:number; correct:boolean; elapsedMs:number; sequence:number}
export type DivisionStart = {version:1; kind:'start'; id:string; roundId:string; submittedAt:string; questions:DivisionQuestion[]}
export type DivisionEvent = DivisionAttempt | DivisionStart | {version:1; kind:'cancel'; id:string; roundId:string; submittedAt:string}
function isQuestion(q: DivisionQuestion) {
  return !!q && Number.isInteger(q.divisor) && q.divisor>=1 && q.divisor<=12
    && Number.isInteger(q.quotient) && q.quotient>=1 && q.quotient<=12
    && Number.isInteger(q.remainder) && q.remainder>=0 && q.remainder<q.divisor
    && q.dividend === q.divisor*q.quotient+q.remainder
}
function isEvent(value:unknown): value is DivisionEvent {
  if (!value || typeof value !== 'object') return false
  const e = value as DivisionEvent
  if (e.version!==1 || !UUID.test(e.id) || !UUID.test(e.roundId) || typeof e.submittedAt!=='string' || !Number.isFinite(Date.parse(e.submittedAt)) || new Date(e.submittedAt).toISOString()!==e.submittedAt) return false
  if(e.kind==='cancel') return true
  if(e.kind==='start') return Array.isArray(e.questions) && [DIVISION_ROUND_LENGTH,LEGACY_ROUND_LENGTH].includes(e.questions.length) && e.questions.every(isQuestion)
  return e.kind==='attempt' && isQuestion(e) && Number.isInteger(e.questionIndex) && e.questionIndex>=0 && e.questionIndex<LEGACY_ROUND_LENGTH
    && Number.isSafeInteger(e.answerQuotient) && Number.isSafeInteger(e.answerRemainder)
    && e.correct===(e.answerQuotient===e.quotient && e.answerRemainder===e.remainder)
    && Number.isFinite(e.elapsedMs) && e.elapsedMs>=0 && Number.isSafeInteger(e.sequence) && e.sequence>=0
}
export function appendDivisionEvent(event:DivisionEvent) {
  if(!isEvent(event)) throw new Error('Invalid division event')
  const key = DIVISION_PREFIX+event.id, bytes = JSON.stringify(event)
  const previous = localStorage.getItem(key)
  if(previous!==null && previous!==bytes) throw new Error('Event already exists; original bytes were kept')
  if(previous===null) localStorage.setItem(key,bytes)
  if(localStorage.getItem(key)!==bytes) throw new Error('Saved event could not be verified')
}
export function loadDivisionEvents() {
  const events:DivisionEvent[] = [], warnings:string[] = []
  try {
    const keys = Array.from({length:localStorage.length},(_,i)=>localStorage.key(i))
    for(const key of keys) {
      if(!key?.startsWith('arithmetic:division:')) continue
      try {
        const value:unknown = JSON.parse(localStorage.getItem(key)??'')
        if(!isEvent(value) || key!==DIVISION_PREFIX+value.id) throw new Error('Unsupported event')
        events.push(value)
      } catch { warnings.push('Some saved division data could not be read. Its original data has been kept.') }
    }
  } catch { warnings.push('Browser storage is unavailable. Existing division data has been kept.') }
  return {events,warnings:[...new Set(warnings)]}
}
export type DivisionQuestion = { divisor:number; quotient:number; remainder:number; dividend:number }
export function divisionQuestion(random = Math.random): DivisionQuestion {
  const divisor = Math.floor(random()*12)+1
  const quotient = Math.floor(random()*12)+1
  const remainder = Math.floor(random()*divisor)
  return {divisor, quotient, remainder, dividend:divisor*quotient+remainder}
}
