import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { ActiveClock, parseAnswer } from './game'
import { acquireRound } from './ownership'
import { appendDivisionEvent, divisionQuestion, DIVISION_ROUND_LENGTH, loadDivisionEvents, type DivisionAttempt, type DivisionEvent, type DivisionStart } from './division'

type Round = {start:DivisionStart; index:number; finished:boolean}
export function DivisionPage({visible}:{visible:boolean}) {
  const [round,setRound] = useState<Round|null>(null)
  const current = useRef(round)
  const [values,setValues] = useState(['',''])
  const valuesRef = useRef(values)
  const [wrong,setWrong] = useState([false,false])
  const [feedback,setFeedback] = useState('')
  const [error,setError] = useState('')
  const [warnings,setWarnings] = useState<string[]>([])
  const [available,setAvailable] = useState(false)
  const [preparing,setPreparing] = useState(false)
  const [failed,setFailed] = useState(false)
  const [attempts,setAttempts] = useState<DivisionAttempt[]>([])
  const inputs = [useRef<HTMLInputElement>(null),useRef<HTMLInputElement>(null)]
  const action = useRef<HTMLButtonElement>(null)
  const owner = useRef<(()=>void)|null>(null)
  const claiming = useRef(true)
  const generation = useRef(0)
  const pending = useRef<DivisionEvent|null>(null)
  const armed = useRef(true)
  const visibleRef = useRef(visible); visibleRef.current=visible
  const clock = useRef(new ActiveClock())
  function syncClock() {clock.current.setActive(visibleRef.current && document.visibilityState==='visible' && document.hasFocus() && !!current.current && !current.current.finished && !!owner.current && !pending.current)}
  function transition(next:Round|null) {current.current=next;setRound(next)}
  function clear() {valuesRef.current=['',''];setValues(['','']);setWrong([false,false]);setFeedback('');armed.current=true}
  function refresh() {const data=loadDivisionEvents();setWarnings(data.warnings);setAttempts(data.events.filter((e):e is DivisionAttempt=>e.kind==='attempt'));return data}
  function hint(roundId:string) {
    try {
      const previous=sessionStorage.getItem('arithmetic:division-round:v1')
      if(previous===null || /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(previous)) sessionStorage.setItem('arithmetic:division-round:v1',roundId)
    } catch { /* Optional tab hint; immutable events remain authoritative. */ }
  }
  function commit(event:DivisionEvent) {
    if(!owner.current) return
    pending.current=event
    try {appendDivisionEvent(event)} catch {
      setFailed(true);setError('Your division data could not be saved. Allow site storage or free browser space, then retry saving. This question has not advanced.');syncClock();return
    }
    pending.current=null;setFailed(false);setError('');refresh()
    if(event.kind==='start') {
      hint(event.roundId);transition({start:event,index:0,finished:false});clear();clock.current=new ActiveClock()
    } else if(event.kind==='attempt') {
      const state=current.current
      if(!state) return
      if(!event.correct) {
        const invalid=[event.answerQuotient!==event.quotient,event.answerRemainder!==event.remainder]
        setWrong(invalid);setFeedback('Incorrect — try again')
        const input=inputs[invalid[0]?0:1].current;input?.focus();input?.select()
      } else {
        clock.current.setActive(false)
        const finished=state.index+1===state.start.questions.length
        transition({...state,index:state.index+1,finished});clear();clock.current=new ActiveClock()
        if(finished) {owner.current?.();owner.current=null}
      }
    } else if(event.kind==='cancel') {
      clock.current.setActive(false);owner.current?.();owner.current=null;transition(null);clear()
    }
    syncClock()
  }
  function cancel() {
    const state=current.current
    if(!visibleRef.current || !state || state.finished || !owner.current || claiming.current || pending.current) return
    commit({version:1,kind:'cancel',id:crypto.randomUUID(),roundId:state.start.roundId,submittedAt:new Date().toISOString()})
  }
  async function start() {
    if(!visibleRef.current || claiming.current || pending.current || (current.current && !current.current.finished)) return
    const token=++generation.current
    claiming.current=true;setAvailable(false)
    // Preserve the tap's focus activation without making a question playable
    // before its exclusive ownership and immutable start have been verified.
    flushSync(()=>setPreparing(true))
    inputs[0].current?.focus()
    const roundId=crypto.randomUUID()
    const event:DivisionStart={version:1,kind:'start',id:crypto.randomUUID(),roundId,submittedAt:new Date().toISOString(),questions:Array.from({length:DIVISION_ROUND_LENGTH},()=>divisionQuestion())}
    try {
      const release=await acquireRound(roundId)
      if(token!==generation.current) {release?.();return}
      if(!release) throw new Error('Round in use')
      owner.current=release;commit(event)
    } catch {setError('Safe round ownership is unavailable. Use a browser with Web Locks before answering. Existing data has been kept.')}
    finally {if(token===generation.current){claiming.current=false;setAvailable(true);setPreparing(false)}}
  }
  function submit() {
    const state=current.current
    if(!visibleRef.current || !state || state.finished || !owner.current || claiming.current || pending.current || !armed.current) return
    const a=valuesRef.current.map(parseAnswer)
    if(a[0]===null || a[1]===null) {
      const invalid=a.map(v=>v===null);setWrong(invalid);setFeedback('Enter two whole numbers')
      const input=inputs[invalid[0]?0:1].current;input?.focus();input?.select();return
    }
    armed.current=false
    const q=state.start.questions[state.index]
    const events=loadDivisionEvents().events.filter((e):e is DivisionAttempt=>e.kind==='attempt' && e.roundId===state.start.roundId)
    commit({version:1,kind:'attempt',id:crypto.randomUUID(),roundId:state.start.roundId,submittedAt:new Date().toISOString(),questionIndex:state.index,...q,answerQuotient:a[0],answerRemainder:a[1],correct:a[0]===q.quotient && a[1]===q.remainder,elapsedMs:clock.current.elapsed(),sequence:events.reduce((max,e)=>Math.max(max,e.sequence),-1)+1})
  }
  useEffect(()=>{
    const token=++generation.current
    async function restore() {
      const data=refresh()
      let roundId:string|null=null
      try {roundId=sessionStorage.getItem('arithmetic:division-round:v1')} catch { /* No hint: start fresh without touching source. */ }
      if(!roundId || data.warnings.length) return
      const started=data.events.find((e):e is DivisionStart=>e.kind==='start' && e.roundId===roundId)
      if(!started || data.events.some(e=>e.kind==='cancel' && e.roundId===roundId)) return
      const release=await acquireRound(roundId)
      if(token!==generation.current){release?.();return}
      if(!release)return
      owner.current=release
      // Re-read under ownership: another tab may have canceled or completed.
      const fresh=refresh()
      const events=fresh.events.filter(e=>e.roundId===roundId)
      const submissions=events.filter((e):e is DivisionAttempt=>e.kind==='attempt')
      const starts=events.filter(e=>e.kind==='start')
      const unsafe=fresh.warnings.length || starts.length!==1 || events.some(e=>e.kind==='cancel') || new Set(submissions.map(e=>e.sequence)).size!==submissions.length || submissions.some(e=>{
        const q=started.questions[e.questionIndex]
        return !q || q.divisor!==e.divisor || q.dividend!==e.dividend || q.quotient!==e.quotient || q.remainder!==e.remainder
      })
      if(unsafe){release();owner.current=null;return}
      let index=0
      while(index<started.questions.length && submissions.some(e=>e.questionIndex===index && e.correct))index++
      if(submissions.some(e=>e.questionIndex>index)){release();owner.current=null;setError('This saved division round could not be resumed safely. Its original data has been kept.');return}
      transition({start:started,index,finished:index===started.questions.length})
      clock.current=new ActiveClock(undefined,Math.max(0,...submissions.filter(e=>e.questionIndex===index).map(e=>e.elapsedMs)))
      if(index===started.questions.length){release();owner.current=null}
      syncClock()
    }
    void restore().catch(()=>setError('Safe round ownership is unavailable. Existing division data has been kept.')).finally(()=>{if(token===generation.current){claiming.current=false;setAvailable(true)}})
    const pause=()=>syncClock()
    const release=()=>{generation.current++;claiming.current=true;clock.current.setActive(false);owner.current?.();owner.current=null}
    const resume=(e:PageTransitionEvent)=>{if(e.persisted) location.reload()}
    window.addEventListener('focus',pause);window.addEventListener('blur',pause);document.addEventListener('visibilitychange',pause)
    window.addEventListener('pagehide',release);window.addEventListener('pageshow',resume);window.addEventListener('storage',refresh)
    const onKey=(event:KeyboardEvent)=>{
      if(!visibleRef.current || event.defaultPrevented || event.repeat || event.isComposing || event.keyCode===229 || event.ctrlKey || event.metaKey || event.altKey) return
      const index=inputs.findIndex(ref=>ref.current===event.target)
      if(index>=0 && event.key===' ' && !pending.current) {event.preventDefault();inputs[index===0?1:0].current?.focus();return}
      if(event.shiftKey) return
      if(event.key==='Escape' && (index>=0 || event.target===document.body)) {event.preventDefault();cancel();return}
      if(event.key!=='Enter') return
      if(current.current && !current.current.finished) {if(index>=0){event.preventDefault();submit()}}
      else if(event.target===document.body || event.target===action.current){event.preventDefault();void start()}
    }
    document.addEventListener('keydown',onKey)
    return ()=>{release();window.removeEventListener('focus',pause);window.removeEventListener('blur',pause);document.removeEventListener('visibilitychange',pause);window.removeEventListener('pagehide',release);window.removeEventListener('pageshow',resume);window.removeEventListener('storage',refresh);document.removeEventListener('keydown',onKey)}
  },[])
  useEffect(()=>{syncClock();if(!visible)return;if(current.current && !current.current.finished && !failed)inputs[0].current?.focus();else action.current?.focus()},[visible,round?.index,round?.finished,failed])
  const question=round && !round.finished ? round.start.questions[round.index] : null
  const roundAttempts=attempts.filter(e=>e.roundId===round?.start.roundId)
  const plannedLength=round?.start.questions.length ?? DIVISION_ROUND_LENGTH
  const firstTry=Array.from({length:plannedLength},(_,i)=>roundAttempts.filter(e=>e.questionIndex===i).sort((a,b)=>a.sequence-b.sequence)[0]?.correct).filter(Boolean).length
  const seconds=Array.from({length:plannedLength},(_,i)=>Math.max(0,...roundAttempts.filter(e=>e.questionIndex===i).map(e=>e.elapsedMs))).reduce((a,b)=>a+b,0)/1000
  return <main aria-label="Division" hidden={!visible}>
    {warnings.map(w=><p className="storage-warning" role="alert" key={w}>{w}</p>)}
    {error && <div className="storage-warning" role="alert">{error}{failed && <button className="retry-save" onClick={()=>{if(pending.current)commit(pending.current)}}>Retry saving</button>}</div>}
    {!round && !preparing && <section className="ready stage" aria-label="Ready"><p className="progress">{DIVISION_ROUND_LENGTH} questions</p><button ref={action} className="primary" disabled={!available || failed} onClick={()=>void start()}>Start</button><p className="shortcut"><kbd>enter</kbd> start</p></section>}
    {(question || preparing) && <section className="stage" aria-label="Division practice" aria-busy={preparing}>
      <p className="progress" aria-label="Question progress">{preparing?'Starting…':`${round!.index+1} / ${plannedLength}`}</p>
      <div className="equation division-equation" data-invalid={wrong.some(Boolean)}>
        <span className="question" data-testid={question?'division-question':undefined} aria-label={question?`${question.dividend} divided by ${question.divisor}`:undefined}>{question?<>{question.dividend} <span className="operator">÷</span> {question.divisor}</>:'…'}</span><span className="operator equals" aria-hidden="true">=</span>
        <div className="division-answers">{['Quotient','Remainder'].map((label,index)=><label className="division-field" key={label}><input ref={inputs[index]} aria-label={preparing?`Starting ${label.toLowerCase()}`:label} aria-invalid={wrong[index]} aria-describedby="division-feedback" autoComplete="off" spellCheck={false} inputMode="numeric" enterKeyHint="done" type="text" value={values[index]} aria-disabled={preparing} disabled={failed} onBeforeInput={e=>{if(claiming.current)e.preventDefault()}} onChange={e=>{if(claiming.current || !owner.current)return;const next=[...valuesRef.current];next[index]=e.target.value;valuesRef.current=next;setValues(next);setWrong([false,false]);setFeedback('');armed.current=true}}/><span>{label.toLowerCase()}</span></label>)}</div>
      </div>
      <p id="division-feedback" className="answer-feedback" role="status">{feedback || ' '}</p>
      <div className="practice-actions">
        <button className="submit-answer" type="button" disabled={preparing || failed} onPointerDown={e=>e.preventDefault()} onClick={submit}>Submit</button>
        <button className="cancel-round" type="button" disabled={preparing || failed} onPointerDown={e=>e.preventDefault()} onClick={cancel}>Cancel</button>
      </div>
      <p className="shortcut"><kbd>enter</kbd> submit <span className="key-gap"><kbd>tab</kbd> / <kbd>space</kbd> switch</span> <span className="key-gap"><kbd>esc</kbd> cancel</span></p>
    </section>}
    {round?.finished && !preparing && <section className="stage result" aria-label="Round result"><h2>Round complete</h2><div className="result-metrics"><div><strong>{seconds.toFixed(2)}<span>s</span></strong><p>Active time</p></div><div><strong>{firstTry}<span> / {plannedLength}</span></strong><p>First try</p></div></div><button ref={action} className="primary" disabled={!available} onClick={()=>void start()}>New round</button><p className="shortcut"><kbd>enter</kbd> new round</p></section>}
  </main>
}
