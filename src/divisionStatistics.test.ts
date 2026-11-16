import { describe, expect, it } from 'vitest'
import { DIVISION_PREFIX, loadDivisionEvents, type DivisionAttempt, type DivisionEvent, type DivisionQuestion, type DivisionStart } from './division'
import { aggregateDivisionStatistics } from './divisionStatistics'

const q: DivisionQuestion = { dividend: 20, divisor: 3, quotient: 6, remainder: 2 }
function attempt(overrides: Partial<DivisionAttempt> = {}): DivisionAttempt {
  return { version: 1, kind: 'attempt', id: 'a', roundId: 'round', submittedAt: '2026-01-01T00:00:00.000Z', questionIndex: 0, ...q, answerQuotient: 6, answerRemainder: 2, correct: true, elapsedMs: 2000, sequence: 0, ...overrides }
}

describe('division statistics', () => {
  it('counts a correction once and averages first solves, not cumulative retry records', () => {
    const events = [attempt({ id: 'wrong', correct: false, answerQuotient: 5, elapsedMs: 1000 }), attempt({ id: 'retry', sequence: 1, elapsedMs: 7000 }), attempt({ id: 'clean', roundId: 'next', elapsedMs: 3000 })]
    const { summary, divisors } = aggregateDivisionStatistics(events)
    expect(summary).toMatchObject({ questions: 2, firstTryCorrect: 1, accuracy: 50, solved: 2, averageSolveMs: 5000, completedRounds: 0 })
    expect(divisors).toHaveLength(12)
    expect(divisors[2]).toMatchObject({ divisor: 3, questions: 2, firstTryCorrect: 1, accuracy: 50, solved: 2, averageSolveMs: 5000 })
  })

  it('weights unequal populations by questions and solved samples, retaining zero separately from missing', () => {
    const data = aggregateDivisionStatistics([
      attempt({ elapsedMs: 0 }),
      attempt({ roundId: 'second', elapsedMs: 6000 }),
      attempt({ roundId: 'wrong-only', correct: false, answerQuotient: 0, elapsedMs: 9000 }),
      attempt({ roundId: 'other-divisor', dividend: 20, divisor: 6, quotient: 3, remainder: 2, answerQuotient: 3, elapsedMs: 12000 }),
    ])
    expect(data.summary).toMatchObject({ questions: 4, firstTryCorrect: 3, accuracy: 75, solved: 3, averageSolveMs: 6000 })
    expect(data.divisors[2]).toMatchObject({ questions: 3, solved: 2, averageSolveMs: 3000 })
    expect(data.divisors[5]).toMatchObject({ questions: 1, solved: 1, averageSolveMs: 12000 })
    expect(data.divisors[0]).toMatchObject({ questions: 0, accuracy: null, averageSolveMs: null })
    expect(aggregateDivisionStatistics([attempt({ elapsedMs: 0 })]).summary.averageSolveMs).toBe(0)
    expect(aggregateDivisionStatistics([attempt({ correct: false, answerQuotient: 0 })]).summary).toMatchObject({ questions: 1, firstTryCorrect: 0, accuracy: 0, solved: 0, averageSolveMs: null })
  })

  it('uses durable sequence, not time or ID, and puts wrong evidence first for contradictory ties', () => {
    const events = [attempt({ id: 'a', sequence: 1, elapsedMs: 6000, submittedAt: '2025-01-01T00:00:00.000Z' }), attempt({ id: 'z', sequence: 0, correct: false, answerQuotient: 0, elapsedMs: 1000 })]
    expect(aggregateDivisionStatistics(events).summary).toMatchObject({ questions: 1, accuracy: 0, solved: 1, averageSolveMs: 6000 })
    for (const ordered of [events, [...events].reverse()]) {
      const tied = ordered.map(event => ({ ...event, sequence: 0, elapsedMs: 0 }))
      expect(aggregateDivisionStatistics(tied).summary).toMatchObject({ questions: 1, accuracy: 0, solved: 1, averageSolveMs: 0 })
    }
  })

  it('keeps actual calculations distinct at a conflicted index and does not mutate immutable observations', () => {
    const events = Object.freeze([Object.freeze(attempt({ correct: false, answerQuotient: 0 })), Object.freeze(attempt({ id: 'divergent', sequence: 1, dividend: 19, remainder: 1 }))])
    const before = JSON.stringify(events)
    expect(aggregateDivisionStatistics(events).summary).toMatchObject({ questions: 2, firstTryCorrect: 1, solved: 1 })
    expect(JSON.stringify(events)).toBe(before)
  })

  it('derives from the storage reader without rewriting unknown, malformed, multiplication or rich bytes', () => {
    const id = '00000000-0000-4000-8000-000000000001'
    const roundId = '00000000-0000-4000-8000-000000000002'
    const values = new Map([
      [DIVISION_PREFIX + id, JSON.stringify({ ...attempt({ id, roundId }), metadata: { richer: ['keep'] } }, null, 2)],
      ['arithmetic:division:event:v9:future', '{"version":9,"extra":"kept"}'],
      [DIVISION_PREFIX + 'broken', '{'],
      ['arithmetic:attempt:v1:legacy', '{legacy}'],
    ])
    const before = [...values]
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { get length() { return values.size }, key: (i: number) => [...values.keys()][i] ?? null, getItem: (key: string) => values.get(key) ?? null, setItem: () => { throw new Error('Stats must be read-only') } } })
    const data = loadDivisionEvents()
    expect(data.warnings).toHaveLength(1)
    expect(aggregateDivisionStatistics(data.events, { hasUnreadableData: !!data.warnings.length }).summary.questions).toBe(1)
    expect([...values]).toEqual(before)
  })

  it.each([5, 10])('credits only all %i stored planned questions solved', length => {
    const start: DivisionStart = { version: 1, kind: 'start', id: 'start', roundId: 'round', submittedAt: '2026-01-01T00:00:00.000Z', questions: Array.from({ length }, () => ({ ...q })) }
    const solves = Array.from({ length }, (_, i) => attempt({ id: `solve-${i}`, questionIndex: i, sequence: i }))
    expect(aggregateDivisionStatistics([start, ...solves]).summary.completedRounds).toBe(1)
    expect(aggregateDivisionStatistics([start, ...solves.slice(1)]).summary.completedRounds).toBe(0)
    expect(aggregateDivisionStatistics(solves).summary.completedRounds).toBe(0)
    const cancel: DivisionEvent = { version: 1, kind: 'cancel', id: 'cancel', roundId: 'round', submittedAt: start.submittedAt }
    expect(aggregateDivisionStatistics([start, ...solves, cancel]).summary.completedRounds).toBe(0)
    expect(aggregateDivisionStatistics([start, { ...start, id: 'other-start' }, ...solves]).summary.completedRounds).toBe(0)
    expect(aggregateDivisionStatistics([start, ...solves, attempt({ id: 'divergent', sequence: length, dividend: 21, remainder: 0, quotient: 7 })]).summary.completedRounds).toBe(0)
    expect(aggregateDivisionStatistics([start, ...solves, attempt({ id: 'contradiction', sequence: 0, correct: false, answerQuotient: 5 })]).summary.completedRounds).toBe(0)
    expect(aggregateDivisionStatistics([start, ...solves], { hasUnreadableData: true }).summary.completedRounds).toBe(0)
  })
})
