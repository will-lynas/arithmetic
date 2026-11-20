import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { ActiveClock, parseAnswer } from './game'
import { acquireRound } from './ownership'
import { appendQuadraticEvent, loadQuadraticEvents, restoreQuadraticRound, type QuadraticEvent, type QuadraticRound } from './quadraticHistory'
import { formatQuadratic, gradeFactors, quadraticRound, QUADRATIC_ROUND_LENGTH, type Factors } from './quadratics'
import './quadratics.css'

const hintKey = 'arithmetic:quadratics-round:v1'
const labels = ['First constant', 'Second constant']
const eventBase = (roundId: string) => ({version:1 as const, id:crypto.randomUUID(), roundId, submittedAt:new Date().toISOString()})
type Feedback = { kind: 'malformed'; fields: boolean[]; pulse: number } | { kind: 'wrong' } | null

export function QuadraticsPage({visible}: {visible: boolean}) {
  const [round, setRound] = useState<QuadraticRound | null>(null)
  const [values, setValues] = useState(() => labels.map(() => ''))
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [error, setError] = useState('')
  const [failed, setFailed] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [available, setAvailable] = useState(false)
  const state = useRef({round, values, visible, claiming:true, token:0, armed:true, pulse:0, release:null as (() => void) | null, pending:null as QuadraticEvent | null})
  const current = state.current
  current.visible = visible
  const clock = useRef(new ActiveClock())
  const inputs = useRef<(HTMLInputElement | null)[]>([])
  const action = useRef<HTMLButtonElement>(null)
  const retry = useRef<HTMLButtonElement>(null)

  function transition(next: QuadraticRound | null) { current.round = next; setRound(next) }
  function activeRound() { return current.round && current.round.index < current.round.start.questions.length ? current.round : null }
  function syncClock() {
    clock.current.setActive(current.visible && document.visibilityState === 'visible' && document.hasFocus() && !!activeRound() && !!current.release && !current.pending)
  }
  function releaseRound() { current.release?.(); current.release = null }
  function clearInput() {
    current.values = labels.map(() => '')
    setValues(current.values); setFeedback(null); current.armed = true
  }
  function refresh() { const data = loadQuadraticEvents(); setWarnings(data.warnings); return data }

  function commit(event: QuadraticEvent) {
    if (!current.release) return
    current.pending = event
    try { appendQuadraticEvent(event) } catch {
      setFailed(true)
      setError('Quadratics data could not be saved. Allow site storage or free browser space, then retry saving.')
      syncClock()
      return
    }
    current.pending = null; setFailed(false); setError('')
    if (event.kind === 'start') {
      try { sessionStorage.setItem(hintKey, event.roundId) } catch { /* The immutable ledger does not depend on a tab hint. */ }
      transition({start:event, index:0, sequence:0, elapsedMs:0, firstTry:0, solvedMs:0, hadWrong:false})
      clearInput(); clock.current = new ActiveClock()
    } else if (event.kind === 'cancel') {
      releaseRound(); transition(null); clearInput()
    } else if (current.round) {
      const saved = current.round
      if (event.correct) {
        const index = saved.index + 1
        transition({...saved, index, sequence:saved.sequence + 1, elapsedMs:0, firstTry:saved.firstTry + Number(!saved.hadWrong), solvedMs:saved.solvedMs + event.elapsedMs, hadWrong:false})
        clearInput(); clock.current = new ActiveClock()
        if (index === saved.start.questions.length) releaseRound()
      } else {
        transition({...saved, sequence:saved.sequence + 1, elapsedMs:event.elapsedMs, hadWrong:true})
        setFeedback({kind:'wrong'})
        if (current.visible) { inputs.current[0]?.focus(); inputs.current[0]?.select() }
      }
    }
    syncClock()
  }

  async function start() {
    if (!current.visible || current.claiming || current.pending || activeRound()) return
    current.claiming = true; setAvailable(false); setError('')
    const token = ++current.token
    flushSync(() => setPreparing(true))
    inputs.current[0]?.focus()
    try {
      const roundId = crypto.randomUUID()
      const release = await acquireRound(roundId)
      if (token !== current.token) { release?.(); return }
      if (!release) throw new Error('Round in use')
      current.release = release
      commit({...eventBase(roundId), kind:'start', questions:quadraticRound()})
    } catch {
      setError('Could not start a quadratics round safely. Check site storage and Web Locks support.')
    } finally {
      if (token === current.token) { current.claiming = false; setAvailable(true); setPreparing(false) }
    }
  }

  function submit() {
    const active = activeRound()
    if (!current.visible || !active || !current.release || current.claiming || current.pending || !current.armed) return
    const parsed = current.values.map(value => {
      const text = value.trim().replace(/^−/, '-')
      return parseAnswer(/^\+\d+$/.test(text) ? text.slice(1) : text)
    })
    const [m, n] = parsed
    if (m === null || n === null) {
      const fields = parsed.map(value => value === null)
      setFeedback({kind:'malformed', fields, pulse:++current.pulse})
      const input = inputs.current[fields.indexOf(true)]
      input?.focus(); input?.select()
      return
    }
    current.armed = false
    // Keep the existing attempt format so saved rounds and Stats remain compatible.
    const answer: Factors = [1, m, 1, n]
    const question = active.start.questions[active.index]
    commit({...eventBase(active.start.roundId), ...question, kind:'attempt', index:active.index, sequence:active.sequence, elapsedMs:clock.current.elapsed(), answer, correct:gradeFactors(question, answer)})
  }

  function cancel() {
    const active = activeRound()
    if (!current.visible || !active || current.claiming || current.pending) return
    commit({...eventBase(active.start.roundId), kind:'cancel'})
  }

  useEffect(() => {
    const token = ++current.token
    async function restore() {
      refresh()
      const id = sessionStorage.getItem(hintKey)
      if (!id) return
      const release = await acquireRound(id)
      if (!release) return
      if (token !== current.token) { release(); return }
      const data = refresh()
      const restored = data.warnings.length ? null : restoreQuadraticRound(data.events, id)
      if (!restored || restored.index === restored.start.questions.length) release()
      else current.release = release
      if (restored) {
        transition(restored); clock.current = new ActiveClock(undefined, restored.elapsedMs); syncClock()
      }
    }
    void restore().catch(() => {
      if (token === current.token) setError('Could not resume a quadratics round safely. Existing data has been kept.')
    }).finally(() => {
      if (token === current.token) { current.claiming = false; setAvailable(true) }
    })
    const release = () => { current.token++; current.claiming = true; clock.current.setActive(false); releaseRound() }
    const resume = (e: PageTransitionEvent) => { if (e.persisted) location.reload() }
    const onStorage = (e: StorageEvent) => { if (!e.key || e.key.startsWith('arithmetic:quadratics:')) refresh() }
    const onKey = (e: KeyboardEvent) => {
      if (!current.visible || current.claiming || e.defaultPrevented || e.repeat || e.isComposing || e.keyCode === 229 || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      const input = inputs.current.some(el => el === e.target)
      if (e.key === 'Enter' && input) { e.preventDefault(); submit() }
      if (e.key === 'Enter' && e.target === document.body && !activeRound() && !document.querySelector('dialog[open]')) { e.preventDefault(); void start() }
      if (e.key === 'Escape' && activeRound() && (input || e.target === document.body) && !document.querySelector('dialog[open]')) { e.preventDefault(); cancel() }
    }
    const windowEvents = {focus:syncClock, blur:syncClock, pagehide:release, pageshow:resume, storage:onStorage}
    for (const type of ['focus', 'blur', 'pagehide', 'pageshow', 'storage'] as const) window.addEventListener(type, windowEvents[type] as EventListener)
    document.addEventListener('visibilitychange', syncClock)
    document.addEventListener('keydown', onKey)
    return () => {
      release()
      for (const type of ['focus', 'blur', 'pagehide', 'pageshow', 'storage'] as const) window.removeEventListener(type, windowEvents[type] as EventListener)
      document.removeEventListener('visibilitychange', syncClock)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    syncClock()
    if (!visible || preparing) return
    if (failed) retry.current?.focus()
    else if (activeRound()) {
      inputs.current[0]?.focus()
      if (activeRound()?.hadWrong) inputs.current[0]?.select()
    } else action.current?.focus()
  }, [visible, round?.index, preparing, failed, available])

  const question = round?.start.questions[round.index]
  const completed = round !== null && !question
  return <main aria-label="Factorising quadratics" hidden={!visible}>
    {warnings.map(warning => <p className="storage-warning" role="alert" key={warning}>{warning}</p>)}
    {error && <div className="storage-warning" role="alert">{error}{failed && <button ref={retry} className="retry-save" onClick={() => { if (current.pending) commit(current.pending) }}>Retry saving</button>}</div>}
    {!round && !preparing && <section className="stage ready" aria-label="Ready">
      <p className="progress">{QUADRATIC_ROUND_LENGTH} questions</p>
      <button ref={action} className="primary" disabled={!available || failed} onClick={() => void start()}>Start</button>
      <p className="shortcut"><kbd>enter</kbd> start</p>
    </section>}
    {(question || preparing) && <section className="stage" aria-label="Quadratics practice" aria-busy={preparing}>
      <p className="progress" aria-label="Question progress">{preparing ? 'Starting…' : `${round!.index + 1} / ${QUADRATIC_ROUND_LENGTH}`}</p>
      <div className="equation quadratic-equation" data-invalid={feedback?.kind === 'wrong'} data-refusal={feedback?.kind === 'malformed' ? feedback.pulse % 2 ? 'a' : 'b' : undefined}>
        <span className="question" data-testid={question && !preparing ? 'quadratic-question' : undefined} data-b={question?.b} data-c={question?.c}>{question && !preparing ? formatQuadratic(question) : '…'}</span>
        <span className="operator" aria-hidden="true">=</span>
        <div className="quadratic-factors">
          {labels.map((label, index) => <div className="quadratic-factor" key={label}>
            <span className="operator" aria-hidden="true">(</span>
            <span aria-hidden="true">x</span>
            <span className="operator quadratic-plus" aria-hidden="true">+</span>
            <input ref={node => { inputs.current[index] = node }} type="text" aria-label={preparing ? `Starting: ${label}` : label} aria-describedby="quadratic-feedback" aria-invalid={feedback?.kind === 'wrong' || (feedback?.kind === 'malformed' && feedback.fields[index])} data-wrong={feedback?.kind === 'wrong'} data-malformed={feedback?.kind === 'malformed' && feedback.fields[index]} autoComplete="off" spellCheck={false} enterKeyHint="done" value={values[index]} aria-disabled={preparing} disabled={failed} onBeforeInput={e => { if (current.claiming) e.preventDefault() }} onChange={e => {
              if (current.claiming || !current.release || current.pending) return
              current.values = current.values.map((value, i) => i === index ? e.target.value : value)
              setValues(current.values); setFeedback(null); current.armed = true
            }}/>
            <span className="operator" aria-hidden="true">)</span>
          </div>)}
        </div>
      </div>
      <p id="quadratic-feedback" className="answer-feedback" data-validation={feedback?.kind === 'malformed'} role="status">{feedback?.kind === 'malformed' ? 'Enter two whole numbers' : feedback?.kind === 'wrong' ? 'Incorrect — try again' : '\u00a0'}</p>
      <div className="practice-actions">
        <button type="button" className="submit-answer" disabled={preparing || failed} onPointerDown={e => e.preventDefault()} onClick={submit}>Submit</button>
        <button type="button" className="cancel-round" disabled={preparing || failed} onPointerDown={e => e.preventDefault()} onClick={cancel}>Cancel</button>
      </div>
      <p className="shortcut"><kbd>enter</kbd> submit <span className="key-gap"><kbd>tab</kbd> switch</span> <span className="key-gap"><kbd>esc</kbd> cancel</span></p>
    </section>}
    {completed && !preparing && <section className="stage result" aria-label="Round result">
      <h2>Round complete</h2><div className="result-metrics"><div><strong>{(round.solvedMs / 1000).toFixed(2)}<span>s</span></strong><p>Active time</p></div><div><strong>{round.firstTry}<span> / {QUADRATIC_ROUND_LENGTH}</span></strong><p>First try</p></div></div>
      <button ref={action} className="primary" disabled={!available || failed} onClick={() => void start()}>New round</button><p className="shortcut"><kbd>enter</kbd> new round</p>
    </section>}
  </main>
}
