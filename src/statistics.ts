import type { AttemptRecord } from './types'
import { groupQuestions } from './questions'

export interface PairStatistics {
  left: number
  right: number
  questions: number
  firstTryCorrect: number
  accuracy: number | null
  errors: number
  solved: number
  averageFirstAnswerMs: number | null
  averageSolveMs: number | null
}

export interface Statistics {
  pairs: PairStatistics[]
  summary: {
    questions: number
    firstTryCorrect: number
    accuracy: number | null
    errors: number
    completedRounds: number
  }
}

export function aggregateStatistics(attempts: readonly AttemptRecord[]): Statistics {
  const stats: Statistics = {
    pairs: Array.from({ length: 144 }, (_, index) => ({
      left: Math.floor(index / 12) + 1, right: index % 12 + 1,
      questions: 0, firstTryCorrect: 0, accuracy: null, errors: 0, solved: 0,
      averageFirstAnswerMs: null, averageSolveMs: null,
    })),
    summary: { questions: 0, firstTryCorrect: 0, accuracy: null, errors: 0, completedRounds: 0 },
  }
  const questions = groupQuestions(attempts)
  const solvedRounds = new Map<string, Set<number>>()
  const slots = new Set<string>()
  const ambiguousRounds = new Set<string>()
  for (const [first] of questions) {
    const slot = JSON.stringify([first.roundId, first.questionIndex])
    if (slots.has(slot)) ambiguousRounds.add(first.roundId)
    slots.add(slot)
  }
  const firstTimes = new Map<PairStatistics, number>()
  const solveTimes = new Map<PairStatistics, number>()
  for (const submissions of questions) {
    const first = submissions[0]
    const pair = stats.pairs[(first.left - 1) * 12 + first.right - 1]
    pair.questions++
    pair.firstTryCorrect += Number(first.correct)
    pair.errors += submissions.filter(attempt => !attempt.correct).length
    firstTimes.set(pair, (firstTimes.get(pair) ?? 0) + first.elapsedMs)
    const solved = submissions.find(attempt => attempt.correct)
    if (solved) {
      const indices = solvedRounds.get(first.roundId) ?? new Set<number>()
      indices.add(first.questionIndex)
      solvedRounds.set(first.roundId, indices)
      pair.solved++
      solveTimes.set(pair, (solveTimes.get(pair) ?? 0) + solved.elapsedMs)
    }
  }
  for (const pair of stats.pairs) {
    pair.accuracy = pair.questions ? 100 * pair.firstTryCorrect / pair.questions : null
    pair.averageFirstAnswerMs = pair.questions ? (firstTimes.get(pair) ?? 0) / pair.questions : null
    pair.averageSolveMs = pair.solved ? (solveTimes.get(pair) ?? 0) / pair.solved : null
    stats.summary.questions += pair.questions
    stats.summary.firstTryCorrect += pair.firstTryCorrect
    stats.summary.errors += pair.errors
  }
  stats.summary.completedRounds = [...solvedRounds.entries()].filter(([roundId, indices]) =>
    !ambiguousRounds.has(roundId) && Array.from({ length: 10 }, (_, index) => index).every(index => indices.has(index)),
  ).length
  stats.summary.accuracy = stats.summary.questions
    ? 100 * stats.summary.firstTryCorrect / stats.summary.questions : null
  return stats
}
