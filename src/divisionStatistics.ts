import type { DivisionAttempt, DivisionEvent } from './division'

export interface DivisionMetrics {
  questions: number
  firstTryCorrect: number
  accuracy: number | null
  solved: number
  averageSolveMs: number | null
}
export interface DivisorStatistics extends DivisionMetrics { divisor: number }
export interface DivisionStatistics {
  summary: DivisionMetrics & { completedRounds: number }
  divisors: DivisorStatistics[]
}
const empty = (): DivisionMetrics => ({ questions: 0, firstTryCorrect: 0, accuracy: null, solved: 0, averageSolveMs: null })

// A correction is still the same presentation. Keep the actual ordered calculation
// in its identity, even when old/concurrent writers disagree at the same index.
export function groupDivisionQuestions(events: readonly DivisionEvent[]): DivisionAttempt[][] {
  const groups = new Map<string, DivisionAttempt[]>()
  for (const event of events) {
    if (event.kind !== 'attempt') continue
    const key = JSON.stringify([event.roundId, event.questionIndex, event.dividend, event.divisor, event.quotient, event.remainder])
    const group = groups.get(key) ?? []
    group.push(event)
    groups.set(key, group)
  }
  return [...groups.values()].map(group => group.sort((a, b) =>
    a.sequence - b.sequence || Number(a.correct) - Number(b.correct) || a.elapsedMs - b.elapsedMs))
}

export function aggregateDivisionStatistics(
  events: readonly DivisionEvent[],
  { hasUnreadableData = false }: { hasUnreadableData?: boolean } = {},
): DivisionStatistics {
  const divisors = Array.from({ length: 12 }, (_, i) => ({ divisor: i + 1, ...empty() }))
  const questions = groupDivisionQuestions(events)
  const solveTotals = Array<number>(12).fill(0)
  for (const submissions of questions) {
    const first = submissions[0]
    const row = divisors[first.divisor - 1]
    row.questions++
    row.firstTryCorrect += Number(first.correct)
    const solved = submissions.find(event => event.correct)
    if (solved) { row.solved++; solveTotals[first.divisor - 1] += solved.elapsedMs }
  }
  const summary = { ...empty(), completedRounds: 0 }
  let totalSolveMs = 0
  for (const [i, row] of divisors.entries()) {
    row.accuracy = row.questions ? 100 * row.firstTryCorrect / row.questions : null
    row.averageSolveMs = row.solved ? solveTotals[i] / row.solved : null
    summary.questions += row.questions
    summary.firstTryCorrect += row.firstTryCorrect
    summary.solved += row.solved
    totalSolveMs += solveTotals[i]
  }
  summary.accuracy = summary.questions ? 100 * summary.firstTryCorrect / summary.questions : null
  summary.averageSolveMs = summary.solved ? totalSolveMs / summary.solved : null
  if (!hasUnreadableData) {
    const rounds = new Map<string, DivisionEvent[]>()
    for (const event of events) {
      const round = rounds.get(event.roundId) ?? []
      round.push(event)
      rounds.set(event.roundId, round)
    }
    for (const round of rounds.values()) {
      const starts = round.filter(event => event.kind === 'start')
      if (starts.length !== 1 || round.some(event => event.kind === 'cancel')) continue
      const planned = starts[0].questions
      if (planned.length !== 5 && planned.length !== 10) continue
      const attempts = round.filter(event => event.kind === 'attempt')
      // Repeated sequence numbers or conflicting planned calculations leave the
      // lifecycle ambiguous, even though their observations remain in metrics.
      if (new Set(attempts.map(event => event.sequence)).size !== attempts.length) continue
      if (attempts.some(event => {
        const question = planned[event.questionIndex]
        return !question || question.dividend !== event.dividend || question.divisor !== event.divisor
          || question.quotient !== event.quotient || question.remainder !== event.remainder
      })) continue
      if (planned.every((_, index) => attempts.some(event => event.questionIndex === index && event.correct))) summary.completedRounds++
    }
  }
  return { summary, divisors }
}
