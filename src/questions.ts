import type { AttemptRecord } from './types'

// Cumulative active time, never wall time, orders submissions within a question.
// Legacy equal-time events have no recoverable submission order: conservatively
// retain wrong-before-solve evidence rather than inventing first-try success.
export function compareSubmissions(a: AttemptRecord, b: AttemptRecord) {
  return a.elapsedMs - b.elapsedMs || Number(a.correct) - Number(b.correct) || a.id.localeCompare(b.id)
}

export function groupQuestions(attempts: readonly AttemptRecord[]) {
  const questions = new Map<string, AttemptRecord[]>()
  const seen = new Set<string>()
  for (const attempt of attempts) {
    if (seen.has(attempt.id)) continue
    seen.add(attempt.id)
    const key = JSON.stringify([attempt.roundId, attempt.questionIndex, attempt.left, attempt.right])
    const submissions = questions.get(key) ?? []
    submissions.push(attempt)
    questions.set(key, submissions)
  }
  return [...questions.values()].map(submissions => submissions.sort(compareSubmissions))
}
