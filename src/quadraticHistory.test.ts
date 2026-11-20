import { expect, test } from 'vitest'
import { quadraticRound, type Factors } from './quadratics'
import { quadraticStatistics, restoreQuadraticRound, type QuadraticAttempt, type QuadraticEvent, type QuadraticStart } from './quadraticHistory'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const base = (n: number, round: number) => ({version:1 as const, id:id(n), roundId:id(round), submittedAt:'2026-01-01T00:00:00.000Z'})
const start = (n: number): QuadraticStart => ({...base(n, n), kind:'start', questions:quadraticRound(() => 0)})
function attempt(round: QuadraticStart, index: number, sequence: number, correct: boolean, elapsedMs: number): QuadraticAttempt {
  const {b, c} = round.questions[index]
  const d = Math.sqrt(b ** 2 - 4 * c)
  const answer: Factors = correct ? [1, (b - d) / 2, 1, (b + d) / 2] : [0, 0, 0, 0]
  return {...base(Number(round.id.slice(-4)) + sequence + 1, Number(round.id.slice(-4))), kind:'attempt', b, c, index, sequence, answer, correct, elapsedMs}
}

test('counts presentations once and averages the first correct cumulative active time', () => {
  const round = start(100), later = start(200), after = start(300)
  const events = [round, attempt(round, 0, 1, true, 4000), attempt(round, 0, 0, false, 1000), later, attempt(later, 0, 0, true, 0), after, attempt(after, 1, 0, false, 7000)]
  const stats = quadraticStatistics(events)
  expect(stats.summary).toMatchObject({attempted:3, solved:2, firstTry:1, meanSolveMs:2000, completedRounds:0})
  expect(stats.rows[0]).toMatchObject({attempted:2, solved:2, firstTry:1, meanSolveMs:2000})
  expect(stats.rows[1]).toMatchObject({attempted:1, solved:0, firstTry:0, meanSolveMs:null})
  expect(stats.rows[2]).toMatchObject({attempted:0, solved:0, firstTry:0, meanSolveMs:null})
})

test('a completed round requires one exact plan and no cancellation or conflicting sequence', () => {
  const round = start(100)
  const events = [round, ...round.questions.map((_, index) => attempt(round, index, index, true, 1000))]
  expect(quadraticStatistics(events).summary.completedRounds).toBe(1)
  expect(quadraticStatistics(events, true).summary.completedRounds).toBe(0)
  const cancel: QuadraticEvent = {...base(106, 100), kind:'cancel'}
  expect(quadraticStatistics([...events, cancel]).summary).toMatchObject({completedRounds:0, solved:5})
  expect(restoreQuadraticRound([...events, cancel], round.id)).toBeNull()
  expect(restoreQuadraticRound([...events, {...events[1], id:id(107)}], round.id)).toBeNull()
})

test('restores the current unsolved question, sequence and elapsed time', () => {
  const round = start(100)
  const events = [round, attempt(round, 1, 2, false, 600), attempt(round, 0, 0, true, 700), attempt(round, 1, 1, false, 400)]
  expect(restoreQuadraticRound(events, round.id)).toMatchObject({index:1, sequence:3, elapsedMs:600, firstTry:1, solvedMs:700})
})
