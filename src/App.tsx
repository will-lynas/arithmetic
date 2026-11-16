import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { ActiveClock, parseAnswer, randomQuestion, restoreRound, type Round } from './game'
import { appendAttempt, cancelRound, loadAttempts, loadCanceledRounds, loadStorageWarnings } from './storage'
import type { AttemptRecord } from './types'
import { StatsPage } from './StatsPage'
import { groupQuestions } from './questions'
import { acquireRound } from './ownership'
import { DivisionPage } from './DivisionPage'
import './debug.css'
const DebugPage = lazy(() => import('./DebugPage'))

function resolvePath() {
  const aliases:Record<string,string> = {'/':'/multiplication','/practice':'/multiplication','/stats':'/multiplication/stats','/division/stats':'/division'}
  const path=aliases[location.pathname] ?? location.pathname
  if(path!==location.pathname) history.replaceState({},'',path+location.search+location.hash)
  return path
}
function navigate(event:React.MouseEvent<HTMLAnchorElement>,href:string) {
  if(event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault();history.pushState({},'',href);window.dispatchEvent(new PopStateEvent('popstate'))
}

function initialTheme() {
  try { return localStorage.getItem('arithmetic:theme') === 'light' ? 'light' : 'dark' }
  catch { return 'dark' }
}
export default function App() {
  const [attempts, setAttempts] = useState(loadAttempts)
  const [round, setRound] = useState<Round>({phase:'ready'})
  const owner = useRef<(() => void) | null>(null)
  const claiming = useRef(true)
  const generation = useRef(0)
  const [available, setAvailable] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const roundRef = useRef(round)
  const clock = useRef(new ActiveClock(undefined, round.phase === 'playing' ? round.elapsedMs : 0))
  const [path, setPath] = useState(resolvePath)
  const [snapshotTime,setSnapshotTime] = useState(Date.now)
  const practice = path === '/multiplication'
  const debug = path === '/multiplication/debug'
  const multiplication = path !== '/division'
  const practiceRef = useRef(practice)
  practiceRef.current = practice
  const [theme, setTheme] = useState(initialTheme)
  const [themeError,setThemeError] = useState('')
  const [warnings, setWarnings] = useState(loadStorageWarnings)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [answer, setAnswer] = useState('')
  const answerRef = useRef('')
  const input = useRef<HTMLInputElement>(null)
  const action = useRef<HTMLButtonElement>(null)
  const pending = useRef<AttemptRecord | null>(null)
  const [savingFailed, setSavingFailed] = useState(false)
  const armed = useRef(true)
  const active = () => practiceRef.current && document.visibilityState === 'visible' && document.hasFocus() && roundRef.current.phase === 'playing' && !pending.current && !!owner.current
  const syncClock = () => clock.current.setActive(active())
  function transition(next: Round) { roundRef.current = next; setRound(next) }
  function clearAnswer() { answerRef.current = ''; setAnswer(''); armed.current = true; setFeedback('') }
  async function claim(candidate: Round, restoring = false) {
    const token = ++generation.current
    claiming.current = true; setAvailable(false)
    try {
      const release = candidate.phase === 'playing' ? await acquireRound(candidate.roundId) : null
      if (token !== generation.current) { release?.(); return }
      if (candidate.phase === 'playing' && !release) {
        transition({phase:'ready'})
        return
      }
      owner.current = release
      // Refresh inside ownership: another owner may have finished before release.
      const saved = restoring ? loadAttempts() : []
      const next = restoring && candidate.phase !== 'ready'
        ? restoreRound(saved.filter(a => a.roundId === candidate.roundId), loadCanceledRounds(), saved) : candidate
      transition(next)
      if (next.phase !== 'ready') {
        // Per-tab reload hint only; attempts remain the immutable authority.
        try {
          const previous = sessionStorage.getItem('arithmetic:round:v1')
          if (previous === null || /^[0-9a-f-]{36}$/i.test(previous)) sessionStorage.setItem('arithmetic:round:v1', next.roundId)
        } catch { /* Optional hint; ownership and event durability do not depend on it. */ }
      }
      if (next.phase !== 'playing') { owner.current?.(); owner.current = null }
      clock.current = new ActiveClock(undefined, next.phase === 'playing' ? next.elapsedMs : 0)
      clearAnswer(); syncClock()
    } catch {
      setError('Safe round ownership is unavailable. Use a browser with Web Locks before answering. Existing data has been kept.')
    } finally {
      if (token === generation.current) { claiming.current = false; setAvailable(true); setPreparing(false) }
    }
  }
  function start() {
    if (!practiceRef.current || claiming.current || roundRef.current.phase === 'playing' || pending.current) return
    const roundId = crypto.randomUUID()
    // Mount and focus in the tap's activation, before awaiting Web Locks. The
    // input rejects edits and no question is playable until ownership.
    flushSync(() => setPreparing(true))
    input.current?.focus()
    void claim({phase:'playing', roundId, questionIndex:0, ...randomQuestion(undefined, loadAttempts(), roundId), elapsedMs:0})
  }
  useEffect(() => {
    const saved = loadAttempts()
    let preferred = saved
    try {
      const roundId = sessionStorage.getItem('arithmetic:round:v1')
      const matching = saved.filter(a => a.roundId === roundId)
      if (loadCanceledRounds().has(roundId ?? '')) preferred = []
      else if (matching.length) preferred = matching
    } catch { /* Fall back to the existing ledger, never overwrite it. */ }
    void claim(restoreRound(preferred, loadCanceledRounds(), saved), true)
    const release = () => {
      generation.current++; claiming.current = true
      clock.current.setActive(false); owner.current?.(); owner.current = null
    }
    const resume = (event: PageTransitionEvent) => { if (event.persisted) location.reload() }
    window.addEventListener('pagehide', release)
    window.addEventListener('pageshow', resume)
    return () => {
      release(); window.removeEventListener('pagehide', release); window.removeEventListener('pageshow', resume)
    }
  }, [])
  function commit(record: AttemptRecord) {
    if (!owner.current) return
    try { appendAttempt(record) }
    catch {
      pending.current = record; setSavingFailed(true); clock.current.setActive(false)
      setError('Your answer could not be saved. Allow site storage or free browser space, then retry saving. This question has not advanced.')
      return
    }
    pending.current = null; setSavingFailed(false); setError('')
    const saved = loadAttempts()
    setAttempts(saved); setWarnings(loadStorageWarnings())
    const current = roundRef.current
    if (current.phase !== 'playing') return
    if (!record.correct) {
      setFeedback('Incorrect — try again')
      input.current?.focus(); input.current?.select(); syncClock()
      return
    }
    clock.current.setActive(false)
    if (current.questionIndex === 9) {
      transition({phase:'finished', roundId:current.roundId}); owner.current?.(); owner.current = null
    }
    else {
      transition({...current, questionIndex: current.questionIndex + 1, ...randomQuestion(undefined, saved, current.roundId), elapsedMs: 0})
      clock.current = new ActiveClock(); syncClock()
    }
    clearAnswer()
  }
  function cancel() {
    const current = roundRef.current
    if (current.phase !== 'playing' || !owner.current || claiming.current) return
    // A failed save is still the same pending answer. Keep its retry UI and
    // ownership; never abandon it or pretend cancellation saved the answer.
    if (pending.current) return
    try { cancelRound(current.roundId) }
    catch { setError('This round could not be canceled safely. Allow site storage, then try canceling again. Existing data has been kept.'); return }
    clock.current.setActive(false); owner.current(); owner.current = null
    transition({phase:'ready'}); clearAnswer(); setError(''); setWarnings(loadStorageWarnings())
  }
  function submit() {
    const current = roundRef.current
    if (current.phase !== 'playing' || !owner.current || claiming.current || pending.current || !armed.current) return
    const value = parseAnswer(answerRef.current)
    if (value === null) { setFeedback('Enter a whole number'); input.current?.select(); return }
    armed.current = false
    const record: AttemptRecord = {version:1, id:crypto.randomUUID(), roundId:current.roundId, questionIndex:current.questionIndex, left:current.left, right:current.right, answer:value, correct:value === current.left * current.right, elapsedMs:clock.current.elapsed(), submittedAt:new Date().toISOString()}
    pending.current = record
    commit(record)
  }
  useEffect(() => {
    const onRoute = () => {
      const next=resolvePath()
      practiceRef.current = next === '/multiplication'
      syncClock(); setPath(next); refresh()
    }
    const refresh = () => { setAttempts(loadAttempts()); setWarnings(loadStorageWarnings()); setSnapshotTime(Date.now()) }
    window.addEventListener('popstate', onRoute)
    window.addEventListener('storage', refresh)
    window.addEventListener('focus', syncClock)
    window.addEventListener('blur', syncClock)
    document.addEventListener('visibilitychange', syncClock)
    syncClock()
    return () => {
      clock.current.setActive(false)
      window.removeEventListener('popstate', onRoute); window.removeEventListener('storage', refresh)
      window.removeEventListener('focus', syncClock); window.removeEventListener('blur', syncClock)
      document.removeEventListener('visibilitychange', syncClock)
    }
  }, [])
  useEffect(() => {
    if (!practice) return
    if (round.phase === 'playing' && !savingFailed) input.current?.focus()
    else action.current?.focus()
  }, [practice, preparing, round.phase, round.phase === 'playing' ? round.questionIndex : -1, savingFailed])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!practiceRef.current || event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      if (event.key === 'Escape') {
        if (roundRef.current.phase !== 'playing' || (event.target !== input.current && event.target !== document.body)) return
        const popup = [...document.querySelectorAll('dialog[open], [role="dialog"], [role="menu"], [role="listbox"], [popover]:popover-open')]
          .some(element => element.getClientRects().length > 0)
        if (popup) return
        event.preventDefault(); cancel(); return
      }
      if (event.key !== 'Enter') return
      if (roundRef.current.phase === 'playing') {
        if (event.target !== input.current) return
        event.preventDefault(); submit()
      } else if (event.target === document.body || event.target === action.current) {
        event.preventDefault(); start()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    try {
      const old = localStorage.getItem('arithmetic:theme')
      if (old !== null && old !== 'light' && old !== 'dark') throw new Error('Unknown theme')
      localStorage.setItem('arithmetic:theme', next)
      if (localStorage.getItem('arithmetic:theme') !== next) throw new Error('Theme not saved')
      setTheme(next);setThemeError('')
    } catch { setThemeError('Theme could not be saved. Existing browser data has been kept.') }
  }
  const roundAttempts = round.phase === 'ready' ? [] : attempts.filter(a => a.roundId === round.roundId)
  const questions = groupQuestions(roundAttempts)
  const firstTry = questions.filter(submissions => submissions[0].correct).length
  const seconds = questions.reduce((sum, submissions) => sum + Math.max(...submissions.map(a => a.elapsedMs)), 0) / 1000
  return <div className={`app ${theme}`}>
    <div className="mode-layout">
      <nav className="mode-nav" aria-label="Arithmetic modes">{[{href:'/multiplication',label:'Multiplication'},{href:'/division',label:'Division'}].map(({href,label})=><a key={href} href={href} aria-current={(href==='/division'?!multiplication:multiplication)?'page':undefined} onClick={event=>navigate(event,href)}>{label}</a>)}</nav>
    <div className="shell">
      <header className="page-header">
        {multiplication ? <nav className="page-nav" aria-label="Main navigation">{[{href:'/multiplication',label:'Practice'}, {href:'/multiplication/stats',label:'Stats'}].map(({href,label}) => <a key={href} href={href} aria-current={(href === '/multiplication' ? practice : !practice && !debug) ? 'page' : undefined} onClick={event => navigate(event,href)}>{label}</a>)}</nav> : <span/>}
        <button className="theme-toggle" type="button" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={toggleTheme}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">{theme === 'dark' ? <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></> : <path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z"/>}</svg>
        </button>
      </header>
      <h1 className="visually-hidden">Arithmetic</h1>
      {themeError && <p className="storage-warning" role="alert">{themeError}</p>}
      <div hidden={!multiplication}>
      {warnings.map(warning => <p className="storage-warning" role="alert" key={warning}>{warning}</p>)}
      {error && <div className="storage-warning" role="alert">{error}{savingFailed && <button className="retry-save" onClick={() => { if (pending.current) commit(pending.current) }}>Retry saving</button>}</div>}
      </div>
      <main className="practice-page" hidden={!practice}>
        {round.phase === 'ready' && !preparing && <section className="ready stage" aria-label="Ready"><p className="progress">10 questions</p><button ref={action} className="primary" disabled={!available} onClick={start}>Start</button><p className="shortcut"><kbd>enter</kbd> start</p></section>}
        {(round.phase === 'playing' || preparing) && <section className="stage" aria-label="Multiplication practice" aria-busy={preparing}>
          <p className="progress" aria-label="Question progress">{round.phase === 'playing' ? `${round.questionIndex + 1} / 10` : 'Starting…'}</p>
          <div className="equation" data-invalid={!!feedback}>
            <span className="question" data-testid={round.phase === 'playing' ? 'question' : undefined} aria-label={round.phase === 'playing' ? `${round.left} times ${round.right}` : undefined}>{round.phase === 'playing' ? <>{round.left} <span className="operator">×</span> {round.right}</> : '…'}</span><span className="operator equals" aria-hidden="true">=</span>
            <input ref={input} aria-label={preparing ? 'Starting round' : 'Answer'} aria-invalid={!!feedback} aria-describedby="answer-feedback" autoComplete="off" spellCheck={false} inputMode="numeric" enterKeyHint="done" type="text" value={answer} aria-disabled={preparing} disabled={savingFailed} onBeforeInput={event => { if (claiming.current) event.preventDefault() }} onChange={event => { if (claiming.current || !owner.current) return; answerRef.current = event.target.value; setAnswer(event.target.value); armed.current = true; setFeedback('') }}/>
          </div>
          <p id="answer-feedback" className="answer-feedback" role="status">{feedback || ' '}</p>
          <div className="practice-actions">
            <button className="submit-answer" type="button" disabled={!available || savingFailed} onPointerDown={event => { event.preventDefault(); input.current?.focus() }} onClick={submit}>Submit</button>
            <button className="cancel-round" type="button" disabled={!available || savingFailed} onClick={cancel}>Cancel</button>
          </div>
          <p className="shortcut"><kbd>enter</kbd> submit</p>
        </section>}
        {round.phase === 'finished' && !preparing && <section className="stage result" aria-label="Round result"><h2>Round complete</h2><div className="result-metrics"><div><strong>{seconds.toFixed(2)}<span>s</span></strong><p>Active time</p></div><div><strong>{firstTry}<span> / 10</span></strong><p>First try</p></div></div><button ref={action} className="primary" disabled={!available} onClick={start}>New round</button><p className="shortcut"><kbd>enter</kbd> new round</p></section>}
      </main>
      {multiplication && !practice && !debug && <main><StatsPage attempts={attempts}/><footer className="debug-footer"><a href="/multiplication/debug" onClick={event=>navigate(event,'/multiplication/debug')}>Debug</a></footer></main>}
      {debug && <Suspense fallback={<p>Loading…</p>}><DebugPage attempts={attempts} now={snapshotTime} roundId={round.phase==='playing'?round.roundId:undefined} current={round.phase==='playing'?round:undefined} onRefresh={()=>{setAttempts(loadAttempts());setWarnings(loadStorageWarnings());setSnapshotTime(Date.now())}}/></Suspense>}
      <DivisionPage visible={!multiplication}/>
    </div>
    </div>
  </div>
}
