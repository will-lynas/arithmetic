import { gradeFactors, quadraticKey, QUADRATIC_BANK, QUADRATIC_ROUND_LENGTH, type Factors, type Quadratic } from './quadratics'
import { assertNoReplacement } from './syntheticStore'

const PREFIX = 'arithmetic:quadratics:event:v1:'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const bank = new Set(QUADRATIC_BANK.map(quadraticKey))
type EventBase = { version: 1; id: string; roundId: string; submittedAt: string }
export type QuadraticStart = EventBase & { kind: 'start'; questions: Quadratic[] }
export type QuadraticAttempt = EventBase & Quadratic & { kind: 'attempt'; index: number; sequence: number; answer: Factors; correct: boolean; elapsedMs: number }
export type QuadraticEvent = QuadraticStart | QuadraticAttempt | (EventBase & { kind: 'cancel' })

function isQuestion(q: unknown): q is Quadratic {
  if (!q || typeof q !== 'object') return false
  const {b, c} = q as Quadratic
  return Number.isInteger(b) && Number.isInteger(c) && bank.has(quadraticKey({b, c}))
}

function isEvent(value: unknown): value is QuadraticEvent {
  if (!value || typeof value !== 'object') return false
  const e = value as QuadraticEvent
  if (e.version !== 1 || typeof e.id !== 'string' || !UUID.test(e.id) || typeof e.roundId !== 'string' || !UUID.test(e.roundId)) return false
  if (typeof e.submittedAt !== 'string' || !Number.isFinite(Date.parse(e.submittedAt)) || new Date(e.submittedAt).toISOString() !== e.submittedAt) return false
  if (e.kind === 'cancel') return true
  if (e.kind === 'start') return Array.isArray(e.questions) && e.questions.length === QUADRATIC_ROUND_LENGTH && e.questions.every(isQuestion) && new Set(e.questions.map(quadraticKey)).size === QUADRATIC_ROUND_LENGTH
  return e.kind === 'attempt' && isQuestion(e) && Number.isInteger(e.index) && e.index >= 0 && e.index < QUADRATIC_ROUND_LENGTH
    && Number.isSafeInteger(e.sequence) && e.sequence >= 0 && Number.isFinite(e.elapsedMs) && e.elapsedMs >= 0
    && Array.isArray(e.answer) && e.answer.length === 4 && e.answer.every(Number.isSafeInteger) && e.correct === gradeFactors(e, e.answer)
}

export function appendQuadraticEvent(event: QuadraticEvent) {
  assertNoReplacement()
  if (!isEvent(event)) throw new Error('Invalid quadratics event')
  const key = PREFIX + event.id, bytes = JSON.stringify(event)
  const existing = localStorage.getItem(key)
  if (existing !== null && existing !== bytes) throw new Error('Event already exists; its bytes were kept')
  if (existing === null) localStorage.setItem(key, bytes)
  if (localStorage.getItem(key) !== bytes) throw new Error('Saved event could not be verified')
}

export function loadQuadraticEvents() {
  const events: QuadraticEvent[] = [], warnings = new Set<string>()
  try {
    const keys = Array.from({length: localStorage.length}, (_, i) => localStorage.key(i))
    for (const key of keys) {
      if (!key?.startsWith('arithmetic:quadratics:')) continue
      try {
        const event: unknown = JSON.parse(localStorage.getItem(key) ?? '')
        if (!isEvent(event) || key !== PREFIX + event.id) throw new Error('Unsupported event')
        events.push(event)
      } catch { warnings.add('Some saved quadratics data could not be read. Its original data has been kept.') }
    }
  } catch { warnings.add('Browser storage is unavailable. Existing quadratics data has been kept.') }
  return {events, warnings: [...warnings]}
}

export type QuadraticRound = { start: QuadraticStart; index: number; sequence: number; elapsedMs: number; firstTry: number; solvedMs: number; hadWrong: boolean }
export function restoreQuadraticRound(events: readonly QuadraticEvent[], roundId: string): QuadraticRound | null {
  return replayRound(events.filter(e => e.roundId === roundId))
}

function replayRound(events: readonly QuadraticEvent[]): QuadraticRound | null {
  const starts = events.filter(e => e.kind === 'start')
  if (starts.length !== 1 || events.some(e => e.kind === 'cancel')) return null
  const [start] = starts
  let index = 0, sequence = 0, elapsedMs = 0, firstTry = 0, solvedMs = 0, wrong = false
  for (const attempt of events.filter(e => e.kind === 'attempt').sort(bySubmission)) {
    const expected = start.questions[index]
    if (!expected || attempt.index !== index || attempt.sequence !== sequence || attempt.elapsedMs < elapsedMs || quadraticKey(attempt) !== quadraticKey(expected)) return null
    sequence++
    elapsedMs = attempt.elapsedMs
    if (attempt.correct) {
      if (!wrong) firstTry++
      solvedMs += elapsedMs
      index++
      elapsedMs = 0
      wrong = false
    } else wrong = true
  }
  return {start, index, sequence, elapsedMs, firstTry, solvedMs, hadWrong:wrong}
}

const bySubmission = (a: QuadraticAttempt, b: QuadraticAttempt) => a.sequence - b.sequence || Number(a.correct) - Number(b.correct) || a.elapsedMs - b.elapsedMs
const tally = () => ({attempted:0, solved:0, firstTry:0, solveMs:0})
const metrics = ({attempted, solved, firstTry, solveMs}: ReturnType<typeof tally>) => ({attempted, solved, firstTry, meanSolveMs:solved ? solveMs / solved : null})
export function quadraticStatistics(events: readonly QuadraticEvent[], unreadable = false) {
  const rounds = new Map<string, QuadraticEvent[]>()
  const presentations = new Map<string, QuadraticAttempt[]>()
  for (const event of events) {
    if (!rounds.has(event.roundId)) rounds.set(event.roundId, [])
    rounds.get(event.roundId)!.push(event)
    if (event.kind !== 'attempt') continue
    const key = `${event.roundId}:${event.index}:${quadraticKey(event)}`
    if (!presentations.has(key)) presentations.set(key, [])
    presentations.get(key)!.push(event)
  }
  const summary = tally()
  const byQuestion = new Map(QUADRATIC_BANK.map(q => [quadraticKey(q), tally()]))
  for (const attempts of presentations.values()) {
    attempts.sort(bySubmission)
    const first = attempts[0], correct = attempts.find(a => a.correct)
    for (const target of [summary, byQuestion.get(quadraticKey(first))!]) {
      target.attempted++
      if (first.correct) target.firstTry++
      if (correct) { target.solved++; target.solveMs += correct.elapsedMs }
    }
  }
  const completedRounds = unreadable ? 0 : [...rounds.values()].filter(round => replayRound(round)?.index === QUADRATIC_ROUND_LENGTH).length
  return {
    summary: {...metrics(summary), completedRounds},
    rows: QUADRATIC_BANK.map(question => ({question, ...metrics(byQuestion.get(quadraticKey(question))!)})),
  }
}
