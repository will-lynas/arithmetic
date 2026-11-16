import { describe, expect, it } from 'vitest'
import { aggregateStatistics } from './statistics'
import type { AttemptRecord } from './types'

function attempt(overrides: Partial<AttemptRecord> = {}): AttemptRecord {
  return {
    version: 1, id: 'first', roundId: 'round-a', questionIndex: 0,
    left: 9, right: 6, answer: 50, correct: false, elapsedMs: 1000,
    submittedAt: '2026-01-01T12:00:00.000Z', ...overrides,
  }
}

describe('aggregateStatistics', () => {
  it('counts only rounds with ten solved question indices, and keeps unfinished timing separate', () => {
    const complete = Array.from({ length: 10 }, (_, questionIndex) => attempt({
      id: `complete-${questionIndex}`, questionIndex, correct: true, elapsedMs: 0,
    }))
    const partial = Array.from({ length: 10 }, (_, questionIndex) => attempt({
      id: `partial-${questionIndex}`, roundId: 'round-b', questionIndex,
      correct: questionIndex < 9, elapsedMs: 1000,
    }))
    const stats = aggregateStatistics([...complete, ...partial, attempt({ id: 'complete-repeat', correct: true, elapsedMs: 9999 })])
    expect(stats.summary).toEqual({ questions: 20, firstTryCorrect: 19, accuracy: 95, errors: 1, completedRounds: 1 })
    expect(stats.pairs.find(pair => pair.left === 9 && pair.right === 6)).toMatchObject({
      questions: 20, solved: 19, averageFirstAnswerMs: 500, averageSolveMs: 9000 / 19,
    })
  })
  it('deduplicates immutable IDs and orders cumulative active timestamps without mutating input', () => {
    const first = Object.freeze(attempt())
    const records = Object.freeze([
      Object.freeze(attempt({ id: 'correct', correct: true, elapsedMs: 4000 })),
      first, first,
      Object.freeze(attempt({ id: 'retry', elapsedMs: 2000 })),
    ])
    const stats = aggregateStatistics(records)
    expect(stats.pairs.find(pair => pair.left === 9 && pair.right === 6)).toMatchObject({
      questions: 1, firstTryCorrect: 0, accuracy: 0, errors: 2,
      averageFirstAnswerMs: 1000, averageSolveMs: 4000,
    })
    expect(records[0].id).toBe('correct')
  })
  it('uses first submissions, not corrected final answers, and preserves ordered pairs', () => {
    const attempts = [
      attempt(),
      attempt({ id: 'retry-wrong', elapsedMs: 2000 }),
      attempt({ id: 'solved', answer: 54, correct: true, elapsedMs: 3500 }),
      attempt({ id: 'reverse', questionIndex: 1, left: 6, right: 9, answer: 54, correct: true, elapsedMs: 500 }),
      attempt({ id: 'second-question', questionIndex: 2, answer: 54, correct: true, elapsedMs: 400 }),
    ]
    const stats = aggregateStatistics(attempts)
    expect(stats.pairs.find(pair => pair.left === 9 && pair.right === 6)).toEqual({
      left: 9, right: 6, questions: 2, firstTryCorrect: 1, accuracy: 50,
      errors: 2, solved: 2, averageFirstAnswerMs: 700, averageSolveMs: 1950,
    })
    expect(stats.pairs.find(pair => pair.left === 6 && pair.right === 9)).toMatchObject({ questions: 1, accuracy: 100, errors: 0 })
    expect(stats.summary).toEqual({ questions: 3, firstTryCorrect: 2, accuracy: 200 / 3, errors: 2, completedRounds: 0 })
  })
  it('keeps legacy divergent pairs at the same round index separate', () => {
    const stats = aggregateStatistics([attempt({left:2,right:3,answer:0}), attempt({id:'other-tab',left:4,right:5,answer:20,correct:true,elapsedMs:2000})])
    expect(stats.summary.questions).toBe(2)
    const remaining = Array.from({length:9}, (_,i) => attempt({id:`rest-${i}`,questionIndex:i+1,correct:true}))
    expect(aggregateStatistics([...remaining,attempt({left:2,right:3}),attempt({id:'conflict',left:4,right:5,correct:true})]).summary.completedRounds).toBe(0)
    expect(stats.pairs.find(p => p.left === 2 && p.right === 3)).toMatchObject({questions:1, solved:0, errors:1})
    expect(stats.pairs.find(p => p.left === 4 && p.right === 5)).toMatchObject({questions:1, solved:1, errors:0})
  })
  it('includes every ordered pair with null accuracy for unattempted questions', () => {
    const stats = aggregateStatistics([])
    expect(stats.pairs).toHaveLength(144)
    expect(new Set(stats.pairs.map(pair => `${pair.left}:${pair.right}`)).size).toBe(144)
    expect(stats.pairs[0]).toMatchObject({ left: 1, right: 1, questions: 0, accuracy: null })
    expect(stats.pairs[143]).toMatchObject({ left: 12, right: 12, questions: 0, accuracy: null })
    expect(stats.summary).toEqual({ questions: 0, firstTryCorrect: 0, accuracy: null, errors: 0, completedRounds: 0 })
  })
})
