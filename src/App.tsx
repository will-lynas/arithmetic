import { useEffect, useRef, useState } from 'react'
import { ActiveClock, parseAnswer, randomQuestion, restoreRound, type Round } from './game'
import { appendAttempt, loadAttempts, loadStorageWarnings } from './storage'
import type { AttemptRecord } from './types'

function initialTheme() {
  try { return localStorage.getItem('arithmetic:theme') === 'light' ? 'light' : 'dark' }
  catch { return 'dark' }
}
export default function App() {
  const [attempts, setAttempts] = useState(loadAttempts)
  const [round, setRound] = useState<Round>(() => restoreRound(attempts))
  const roundRef = useRef(round)
  const clock = useRef(new ActiveClock(undefined, round.phase === 'playing' ? round.elapsedMs : 0))
  const [path, setPath] = useState(location.pathname)
  const practice = path === '/' || path === '/practice'
  const practiceRef = useRef(practice)
  practiceRef.current = practice
  const [theme, setTheme] = useState(initialTheme)
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
  const active = () => practiceRef.current && document.visibilityState === 'visible' && document.hasFocus() && roundRef.current.phase === 'playing' && !pending.current
  const syncClock = () => clock.current.setActive(active())
  function transition(next: Round) { roundRef.current = next; setRound(next) }
  function clearAnswer() { answerRef.current = ''; setAnswer(''); armed.current = true; setFeedback('') }
  function start() {
    if (!practiceRef.current || roundRef.current.phase === 'playing' || pending.current) return
    transition({phase: 'playing', roundId: crypto.randomUUID(), questionIndex: 0, ...randomQuestion(), elapsedMs: 0})
    clock.current = new ActiveClock(); clearAnswer(); syncClock()
  }
  function commit(record: AttemptRecord) {
    try { appendAttempt(record) }
    catch {
      pending.current = record; setSavingFailed(true); clock.current.setActive(false)
      setError('Your answer could not be saved. Allow site storage or free browser space, then retry saving. This question has not advanced.')
      return
    }
    pending.current = null; setSavingFailed(false); setError('')
    setAttempts(loadAttempts()); setWarnings(loadStorageWarnings())
    const current = roundRef.current
    if (current.phase !== 'playing') return
    if (!record.correct) {
      setFeedback('Incorrect — try again')
      input.current?.focus(); input.current?.select(); syncClock()
      return
    }
    clock.current.setActive(false)
    if (current.questionIndex === 9) transition({phase:'finished', roundId: current.roundId})
    else {
      transition({...current, questionIndex: current.questionIndex + 1, ...randomQuestion(), elapsedMs: 0})
      clock.current = new ActiveClock(); syncClock()
    }
    clearAnswer()
  }
  function submit() {
    const current = roundRef.current
    if (current.phase !== 'playing' || pending.current || !armed.current) return
    const value = parseAnswer(answerRef.current)
    if (value === null) { setFeedback('Enter a whole number'); input.current?.select(); return }
    armed.current = false
    const record: AttemptRecord = {version:1, id:crypto.randomUUID(), roundId:current.roundId, questionIndex:current.questionIndex, left:current.left, right:current.right, answer:value, correct:value === current.left * current.right, elapsedMs:clock.current.elapsed(), submittedAt:new Date().toISOString()}
    pending.current = record
    commit(record)
  }
  useEffect(() => {
    const onRoute = () => {
      practiceRef.current = location.pathname === '/' || location.pathname === '/practice'
      syncClock(); setPath(location.pathname)
    }
    const refresh = () => { setAttempts(loadAttempts()); setWarnings(loadStorageWarnings()) }
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
  }, [practice, round.phase, round.phase === 'playing' ? round.questionIndex : -1, savingFailed])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!practiceRef.current || event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.key !== 'Enter') return
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
      setTheme(next)
    } catch { setError('Theme could not be saved. Existing browser data has been kept.') }
  }
  const roundAttempts = round.phase === 'ready' ? [] : attempts.filter(a => a.roundId === round.roundId)
  const first = new Map<number, AttemptRecord>()
  const elapsed = new Map<number, number>()
  for (const record of roundAttempts) {
    if (!first.has(record.questionIndex)) first.set(record.questionIndex, record)
    elapsed.set(record.questionIndex, Math.max(elapsed.get(record.questionIndex) ?? 0, record.elapsedMs))
  }
  const seconds = [...elapsed.values()].reduce((sum, value) => sum + value, 0) / 1000
  return <div className={`app ${theme}`}>
    <div className="shell">
      <header className="page-header">
        <nav className="page-nav" aria-label="Main navigation"><a href="/" aria-current={practice ? 'page' : undefined} onClick={event => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')) }}>Practice</a></nav>
        <button className="theme-toggle" type="button" aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={toggleTheme}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">{theme === 'dark' ? <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></> : <path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z"/>}</svg>
        </button>
      </header>
      <h1 className="visually-hidden">Arithmetic</h1>
      {warnings.map(warning => <p className="storage-warning" role="alert" key={warning}>{warning}</p>)}
      {error && <div className="storage-warning" role="alert">{error}{savingFailed && <button className="retry-save" onClick={() => { if (pending.current) commit(pending.current) }}>Retry saving</button>}</div>}
      <main className="practice-page" hidden={!practice}>
        {round.phase === 'ready' && <section className="ready stage" aria-label="Ready"><p className="progress">10 questions</p><button ref={action} className="primary" onClick={start}>Start</button><p className="shortcut"><kbd>enter</kbd> start</p></section>}
        {round.phase === 'playing' && <section className="stage" aria-label="Multiplication practice">
          <p className="progress" aria-label="Question progress">{round.questionIndex + 1} / 10</p>
          <div className="equation" data-invalid={!!feedback}>
            <span className="question" data-testid="question" aria-label={`${round.left} times ${round.right}`}>{round.left} <span className="operator">×</span> {round.right}</span><span className="operator equals" aria-hidden="true">=</span>
            <input ref={input} aria-label="Answer" aria-invalid={!!feedback} aria-describedby="answer-feedback" autoComplete="off" spellCheck={false} inputMode="numeric" type="text" value={answer} disabled={savingFailed} onChange={event => { answerRef.current = event.target.value; setAnswer(event.target.value); armed.current = true; setFeedback('') }}/>
          </div>
          <p id="answer-feedback" className="answer-feedback" role="status">{feedback || ' '}</p>
          <p className="shortcut"><kbd>enter</kbd> submit</p>
        </section>}
        {round.phase === 'finished' && <section className="stage result" aria-label="Round result"><h2>Round complete</h2><div className="result-metrics"><div><strong>{seconds.toFixed(2)}<span>s</span></strong><p>Active time</p></div><div><strong>{[...first.values()].filter(a => a.correct).length}<span> / 10</span></strong><p>First try</p></div></div><button ref={action} className="primary" onClick={start}>New round</button><p className="shortcut"><kbd>enter</kbd> new round</p></section>}
      </main>
    </div>
  </div>
}
