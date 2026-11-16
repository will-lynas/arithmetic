import { groupQuestions } from './questions'
import { isAttempt } from './storage'
import type { AttemptRecord } from './types'

// Evidence-informed, NOT the published ARTS selector: ARTS uses max priority.
// Our weighted random selector and every numeric tuning below are custom.
// https://files.eric.ed.gov/fulltext/ED549436.pdf (methods pp. 2533–2534).
const HISTORY = 256
const FACT_HISTORY = 8
const CLEAN_GATE = 12
const BASELINE_WINDOW = 64
const ERROR_BOOST = 12
const SPEED_BOOST = 2
const DRAW_FLOOR = 1 // Keep mature facts reachable without amplifying tiny signals.
const COVERAGE_TARGET = 3
const COVERAGE_DECAY = 64
export const COVERAGE_BOOSTS = Array.from({length:COVERAGE_TARGET + 1}, (_,completed) =>
  completed < COVERAGE_TARGET ? 12 * COVERAGE_DECAY ** (2 - completed) : 0)
const DAY = 86_400_000
const pair = (left: number, right: number) => `${left}x${right}`
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return (sorted[middle]! + sorted[Math.max(0, Math.ceil(sorted.length / 2) - 1)]!) / 2
}
const logTime = (ms: number) => Math.log(Math.min(30_000, Math.max(250, ms)))

function presentations(attempts: readonly AttemptRecord[], roundId?: string) {
  const observations = groupQuestions(attempts.filter(isAttempt)).map(submissions => ({
    ...submissions[0], failed:submissions.some(a => !a.correct), completed:submissions.some(a => a.correct),
  }))
  const roundTimes = new Map<string, number>()
  for (const a of observations) roundTimes.set(a.roundId, Math.max(roundTimes.get(a.roundId) ?? -Infinity, Date.parse(a.submittedAt)))
  // Slot order is reliable within a round even after clock rollback/ties.
  // Across legacy rounds no monotonic sequence exists: use the latest recorded
  // wall time, then UUID as a stable tie-break, with the owned round last.
  return observations.sort((a,b) => a.roundId === b.roundId ? a.questionIndex - b.questionIndex
    : Number(a.roundId === roundId) - Number(b.roundId === roundId)
      || roundTimes.get(a.roundId)! - roundTimes.get(b.roundId)! || a.roundId.localeCompare(b.roundId))
}

export function questionWeights(attempts: readonly AttemptRecord[], now = Date.now(), roundId?: string) {
  // Never repair/rewrite raw data. Reuse the ledger validator and presentation
  // grouping (including conservative wrong-before-correct elapsed-time ties).
  const all = presentations(attempts, roundId)
  // Lifetime completion is independent of the bounded recent-difficulty window.
  // Saturate derived counts; never persist counters or rewrite ledger records.
  const completed = new Map<string, number>()
  for (const q of all) if (q.completed) {
    const key = pair(q.left,q.right)
    completed.set(key, Math.min(COVERAGE_TARGET, (completed.get(key) ?? 0) + 1))
  }
  const observations = all.slice(-HISTORY)
  const clean = observations.filter(a => !a.failed).slice(-BASELINE_WINDOW)
  const baseline = clean.length >= CLEAN_GATE ? median(clean.map(a => logTime(a.elapsedMs))) : null
  return Array.from({length:144}, (_,i) => {
    const left = Math.floor(i / 12) + 1, right = i % 12 + 1
    const history = observations.filter(a => a.left === left && a.right === right).slice(-FACT_HISTORY)
    let error = 0
    for (const a of history) {
      if (a.failed) {
        const age = Math.max(0, now - Date.parse(a.submittedAt))
        const trials = observations.length - 1 - observations.indexOf(a)
        error = Math.exp(-trials / 64) * Math.exp(-age / (30 * DAY))
      } else error *= 0.5 // Later independent clean retrievals, never correction.
    }
    const times = history.filter(a => !a.failed).map(a => logTime(a.elapsedMs))
    // Shrink sparse fact evidence toward this learner's median log latency.
    // Typed-submit latency is NOT response onset, nor a failure/mastery label.
    const slow = baseline !== null && times.length
      ? Math.min(1, Math.max(0, (median(times) - baseline) / Math.log(4))) * times.length / (times.length + 2) : 0
    const coverageBoost = COVERAGE_BOOSTS[completed.get(pair(left,right)) ?? 0]!
    const difficultyWeight = ERROR_BOOST * error + SPEED_BOOST * slow
    return {left, right, weight:coverageBoost + difficultyWeight, coverageBoost, difficultyWeight}
  })
}

export function sampleQuestion(attempts: readonly AttemptRecord[], random: () => number, now: number, roundId?: string) {
  const observations = presentations(attempts, roundId)
  const cooling = new Set(observations.slice(-2).flatMap(q => [pair(q.left,q.right), pair(q.right,q.left)]))
  const counts = new Map<string, number>()
  for (const q of observations.filter(q => q.roundId === roundId)) {
    const key = pair(q.left,q.right)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  // At most ten slots and four cooled pairs: the 144-fact pool cannot exhaust.
  const choices = questionWeights(attempts, now, roundId).filter(q =>
    !cooling.has(pair(q.left,q.right)) && (counts.get(pair(q.left,q.right)) ?? 0) < 2)
  const total = choices.reduce((sum, q) => sum + DRAW_FLOOR + q.weight, 0)
  let target = random() * total
  return choices.find(q => (target -= DRAW_FLOOR + q.weight) < 0) ?? choices.at(-1)!
}
