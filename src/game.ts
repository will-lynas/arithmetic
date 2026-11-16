import type { AttemptRecord } from './types'
import { groupQuestions } from './questions'
export class ActiveClock {
  private accumulated: number
  private since: number | null = null
  constructor(private now: () => number = () => performance.now(), initial = 0) { this.accumulated = initial }
  setActive(active: boolean) {
    if (active && this.since === null) this.since = this.now()
    if (!active && this.since !== null) { this.accumulated += Math.max(0, this.now() - this.since); this.since = null }
  }
  elapsed() { return this.accumulated + (this.since === null ? 0 : Math.max(0, this.now() - this.since)) }
}
export function randomQuestion(random = Math.random) { return { left: Math.floor(random() * 12) + 1, right: Math.floor(random() * 12) + 1 } }
export function parseAnswer(text: string): number | null {
  if (!/^-?\d+$/.test(text.trim())) return null
  const answer = Number(text)
  return Number.isSafeInteger(answer) ? answer : null
}
export type Round = {phase: 'ready'} | {phase: 'playing'; roundId: string; questionIndex: number; left: number; right: number; elapsedMs: number} | {phase: 'finished'; roundId: string}
export function restoreRound(attempts: AttemptRecord[], canceledRounds: ReadonlySet<string> = new Set()): Round {
  const last = attempts.at(-1)
  if (!last || canceledRounds.has(last.roundId)) return { phase: 'ready' }
  const round = attempts.filter(a => a.roundId === last.roundId)
  const questions = groupQuestions(round)
  // Old concurrent tabs may have assigned two pairs to one slot. Keep their
  // events for Stats, but do not invent a resumable shared round.
  if (questions.length !== new Set(questions.map(q => q[0].questionIndex)).size) return {phase:'ready'}
  const index = Math.max(...round.map(a => a.questionIndex))
  const question = round.filter(a => a.questionIndex === index)
  const latest = question.at(-1)!
  if (question.some(a => a.correct)) {
    return index === 9 ? {phase: 'finished', roundId: last.roundId}
      : {phase: 'playing', roundId: last.roundId, questionIndex: index + 1, ...randomQuestion(), elapsedMs: 0}
  }
  return {phase: 'playing', roundId: last.roundId, questionIndex: index, left: latest.left, right: latest.right, elapsedMs: Math.max(...question.map(a => a.elapsedMs))}
}
