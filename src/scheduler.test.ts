import { expect, test, vi } from 'vitest'
import { randomQuestion, restoreRound } from './game'
import { questionWeights } from './scheduler'
import type { AttemptRecord } from './types'

const now = Date.parse('2026-06-01T00:00:00.000Z')
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
function observation(n: number, left: number, right: number, correct = true, elapsedMs = 1000): AttemptRecord {
  return {version:1, id:uuid(n + 1), roundId:uuid(n + 1000), questionIndex:0, left, right,
    answer:correct ? left * right : -1, correct, elapsedMs, submittedAt:new Date(now - (1000 - n) * 1000).toISOString()}
}
function seeded(seed = 73) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 }
}
const baseline = () => Array.from({length:20}, (_,i) => observation(i, 1 + Math.floor(i / 12), i % 12 + 1))
function draws(history: AttemptRecord[], count = 4000) {
  const random = seeded()
  const counts = new Map<string, number>()
  for (let i = 0; i < count; i++) {
    const q = randomQuestion(random, history, undefined, now)
    const key = `${q.left}x${q.right}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

test('recent incorrect retrievals outweigh slow clean answers while unseen facts retain random coverage', () => {
  const history = [...baseline(), observation(30, 9, 6, false), observation(31, 8, 7, true, 8000), observation(32, 3, 3), observation(33, 4, 4)]
  const counts = draws(history)
  expect(counts.get('9x6')!).toBeGreaterThan(1000)
  expect(counts.get('9x6')!).toBeGreaterThan(3 * counts.get('8x7')!)
  expect(counts.get('8x7')!).toBeGreaterThan(counts.get('12x12')! * 3)
  expect(counts.get('12x12')!).toBeGreaterThan(0)
  expect(counts.size).toBeGreaterThan(135)
})

test('very old or independently recovered errors and negligible timing noise cannot monopolize difficulty draws', () => {
  const tail = [observation(40,2,2),observation(41,3,3)]
  const stale = {...observation(30,9,6,false),submittedAt:new Date(now - 180 * 86400000).toISOString()}
  expect(draws([stale,...tail]).get('9x6')!).toBeLessThan(100)
  const recovered = [observation(30,9,6,false),...Array.from({length:5},(_,i) => observation(31+i,9,6)),...tail]
  expect(draws(recovered).get('9x6')!).toBeLessThan(250)
  expect(draws([...baseline(),observation(30,9,6,true,1001),...tail]).get('9x6')!).toBeLessThan(100)
})

const weight = (history: AttemptRecord[], left = 9, right = 6, at = now) =>
  questionWeights(history, at).find(q => q.left === left && q.right === right)!.weight

test('a presentation with retries is one failure and correction earns no clean credit', () => {
  const failed = observation(30, 9, 6, false, 10)
  const correction = {...failed, id:uuid(900), answer:54, correct:true, elapsedMs:30000}
  const retry = {...failed, id:uuid(901), elapsedMs:2000}
  expect(weight([failed, correction, retry, retry])).toBe(weight([failed]))
  expect(weight([failed, {...correction, elapsedMs:10}])).toBe(weight([failed]))
  expect(weight([failed], 6, 9)).toBe(0)
})

test('errors decay with independent clean retrievals, elapsed age and intervening trials, then leave the bounded window', () => {
  const failed = observation(30, 9, 6, false)
  const recovered = [failed, ...Array.from({length:8}, (_,i) => observation(40+i,9,6))]
  expect(weight([failed, observation(40,9,6)])).toBeLessThan(weight([failed]) * 0.51)
  expect(weight(recovered)).toBe(0)
  expect(weight([failed],9,6,now + 180 * 86400000)).toBeLessThan(0.04)
  expect(weight([failed,...Array.from({length:256},(_,i) => observation(i+50,2,2))])).toBe(0)
})

test('speed needs 12 clean samples, shrinks sparse facts, ignores failures and bounds extreme/invalid timings', () => {
  const slow = observation(30,9,6,true,8000)
  expect(weight([...baseline().slice(0,10), slow])).toBe(0)
  expect(weight([...baseline().slice(0,11), slow])).toBeGreaterThan(0)
  expect(weight([...baseline(), slow])).toBeLessThan(weight([...baseline(),slow,observation(31,9,6,true,8000)]))
  expect(weight([...baseline(),observation(30,9,6,true,0)])).toBe(0)
  expect(weight([...baseline(),observation(30,9,6,true,1e100)])).toBe(weight([...baseline(),observation(30,9,6,true,30000)]))
  expect(weight([...baseline(),observation(30,9,6,true,NaN)])).toBe(0)
  expect(weight([...baseline(),slow])).toBeLessThanOrEqual(2)
  expect(weight([...baseline(),observation(30,9,6,false,1)])).toBeGreaterThan(6 * weight([...baseline(),slow]))
})

test('two intervening presentations cool both operand orders across round boundaries and cancellations', () => {
  const history = [observation(30,9,6,false), observation(31,3,4)]
  for (let i=0; i<300; i++) {
    const q = randomQuestion(seeded(i),history,uuid(9999),now)
    expect(['9x6','6x9','3x4','4x3']).not.toContain(`${q.left}x${q.right}`)
  }
  const eligible = [...history,observation(32,2,2)]
  expect(draws(eligible).get('9x6')!).toBeGreaterThan(1000)
})

test('the exact pair is capped at two presentations per round, not two submissions or a permanent retirement', () => {
  const roundId = uuid(5000)
  const a = {...observation(30,9,6,false),roundId,questionIndex:0}
  const b = {...observation(31,9,6,false),roundId,questionIndex:3}
  const history = [a,b,observation(32,2,2),observation(33,3,3)]
  for (let i=0; i<300; i++) expect(randomQuestion(seeded(i),history,roundId,now)).not.toEqual({left:9,right:6})
  const random = seeded()
  expect(Array.from({length:200},() => randomQuestion(random,history,uuid(9999),now)).some(q => q.left === 9 && q.right === 6)).toBe(true)
})

test('round question indices determine cooldown and recovery despite wall-clock rollback or ties', () => {
  const roundId = uuid(5000)
  const failed = {...observation(30,9,6,false),roundId,questionIndex:0}
  const clean = {...observation(31,9,6),roundId,questionIndex:1,submittedAt:new Date(now-10_000_000).toISOString()}
  expect(weight([clean,failed])).toBe(weight([failed,clean]))
  const last = {...observation(32,3,4),roundId,questionIndex:2,submittedAt:clean.submittedAt}
  for (let i=0; i<100; i++) {
    const q = randomQuestion(seeded(i),[last,clean,failed],roundId,now)
    expect(['9x6','6x9','3x4','4x3']).not.toContain(`${q.left}x${q.right}`)
  }
})

test('empty and unsupported histories are uniformly covered without mutating any records', () => {
  const counts = draws([], 4000)
  expect(counts.size).toBe(144)
  expect(Math.min(...counts.values())).toBeGreaterThan(8)
  expect(Math.max(...counts.values())).toBeLessThan(60)
  const malformed = [null, {}, {...observation(30,9,6),version:9}, {...observation(31,9,6),elapsedMs:-1}] as unknown as AttemptRecord[]
  expect(draws(malformed)).toEqual(counts)
  const history = [...baseline(), observation(30,9,6,true,8000), observation(31,2,2), observation(32,3,3)]
  const original = JSON.stringify(history)
  draws(history, 50)
  expect(JSON.stringify(history)).toBe(original)
  const outlierBaseline = history.map((a,i) => i === 0 ? {...a,elapsedMs:1e100} : a)
  expect(weight(outlierBaseline)).toBe(weight(history))
})

test('restored next-question selection uses full history and keeps failed/canceled rounds distinct', () => {
  const clock = vi.spyOn(Date,'now').mockReturnValue(now)
  try {
    const error = observation(30,9,6,false)
    const older = [error,observation(31,2,2),observation(32,3,3)]
    const current = observation(40,4,4)
    const all = [...older,current]
    expect(restoreRound([current],new Set(),all,() => 0.75)).toMatchObject({phase:'playing',questionIndex:1,left:9,right:6})
    expect(restoreRound([current],new Set([current.roundId]),all)).toEqual({phase:'ready'})
    expect(restoreRound([error],new Set(),all,() => 0.75)).toMatchObject({phase:'playing',questionIndex:0,left:9,right:6,elapsedMs:1000})
  } finally { clock.mockRestore() }
})

test('seeded multi-round policy simulation maintains spacing, hard caps and broad coverage (not learning efficacy)', () => {
  const covered = new Set<string>()
  for (const seed of [3,73,601,9001]) {
    const random = seeded(seed)
    const history: AttemptRecord[] = []
    const recent: string[] = []
    for (let round = 0; round < 30; round++) {
      const roundId = uuid(10000 + round)
      const counts = new Map<string, number>()
      for (let index=0; index<10; index++) {
        const q = randomQuestion(random,history,roundId,now)
        const key = `${q.left}x${q.right}`, reverse = `${q.right}x${q.left}`
        expect(recent.slice(-2)).not.toContain(key)
        expect(recent.slice(-2)).not.toContain(reverse)
        counts.set(key,(counts.get(key) ?? 0) + 1)
        expect(counts.get(key)).toBeLessThanOrEqual(2)
        covered.add(key); recent.push(key)
        const n = round * 10 + index
        history.push({...observation(n,q.left,q.right,n % 7 !== 0,n % 5 ? 1000 : 8000),roundId,questionIndex:index})
      }
    }
  }
  expect(covered.size).toBeGreaterThan(135)
})
