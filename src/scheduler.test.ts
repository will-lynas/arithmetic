import { expect, test, vi } from 'vitest'
import { randomQuestion, restoreRound } from './game'
import { questionWeights } from './scheduler'
import { groupQuestions } from './questions'
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
const covered = () => Array.from({length:432},(_,i) => ({
  ...observation(10000+i,Math.floor(i/36)+1,Math.floor(i/3)%12+1),
  submittedAt:new Date(now-2*86400000).toISOString(),
}))
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

test('once coverage is saturated recent incorrect retrievals outweigh slow clean answers while all facts retain random coverage', () => {
  const history = [...covered(), ...baseline(), observation(30, 9, 6, false), observation(31, 2, 12, true, 8000), observation(32, 3, 3), observation(33, 4, 4)]
  const counts = draws(history)
  expect(counts.get('9x6')!).toBeGreaterThan(1000)
  expect(counts.get('9x6')!).toBeGreaterThan(3 * counts.get('2x12')!)
  expect(counts.get('2x12')!).toBeGreaterThan(counts.get('12x12')! * 3)
  expect(counts.get('12x12')!).toBeGreaterThan(0)
  expect(counts.size).toBeGreaterThan(135)
},30000)

test('very old or independently recovered errors and negligible timing noise cannot monopolize difficulty draws', () => {
  const tail = [observation(40,2,2),observation(41,3,3)]
  const stale = {...observation(30,9,6,false),submittedAt:new Date(now - 180 * 86400000).toISOString()}
  expect(draws([...covered(),stale,...tail]).get('9x6')!).toBeLessThan(100)
  const recovered = [observation(30,9,6,false),...Array.from({length:5},(_,i) => observation(31+i,9,6)),...tail]
  expect(draws([...covered(),...recovered]).get('9x6')!).toBeLessThan(250)
  expect(draws([...covered(),...baseline(),observation(30,9,6,true,1001),...tail]).get('9x6')!).toBeLessThan(100)
},30000)

const weight = (history: AttemptRecord[], left = 9, right = 6, at = now) =>
  questionWeights(history, at).find(q => q.left === left && q.right === right)!.difficultyWeight

test('coverage boosts decline linearly from unseen to three lifetime completed presentations, then stop', () => {
  for (const completed of [0,1,2,3,4,20]) {
    const history = Array.from({length:completed}, (_,i) => observation(i,9,6))
    const q = questionWeights(history,now).find(q => q.left === 9 && q.right === 6)!
    expect(q).toMatchObject({difficultyWeight:0,coverageBoost:16 * (3 - Math.min(completed,3)),weight:16 * (3 - Math.min(completed,3))})
  }
})

const coverageWeight = (history: AttemptRecord[], left = 9, right = 6) =>
  questionWeights(history,now).find(q => q.left === left && q.right === right)!.coverageBoost

test('coverage counts eventual completion once per ordered presentation, never retries or wrong-only attempts', () => {
  const wrong = observation(30,9,6,false)
  const correct = {...wrong,id:uuid(900),answer:54,correct:true,elapsedMs:2000}
  const repeated = {...correct,id:uuid(901),elapsedMs:3000}
  expect(coverageWeight([wrong])).toBe(48)
  expect(coverageWeight([wrong,correct,repeated,correct])).toBe(32)
  expect(coverageWeight([wrong,correct,repeated],6,9)).toBe(48)
  const next = {...correct,id:uuid(902),questionIndex:1}
  const otherRound = {...correct,id:uuid(903),roundId:uuid(5000)}
  const divergent = {...correct,id:uuid(904),left:6,right:9}
  expect(coverageWeight([wrong,correct,repeated,next,otherRound,divergent])).toBe(0)
  expect(coverageWeight([correct,divergent],6,9)).toBe(32)
})

test('coverage uses immutable full validated history even beyond the recent 256-presentation window', () => {
  const old = Array.from({length:3},(_,i) => ({...observation(i,9,6),legacy:{unknown:'preserve'}}))
  const tail = Array.from({length:260},(_,i) => observation(i+50,2,2))
  const invalid = {...observation(900,6,9),version:9} as unknown as AttemptRecord
  const history = [...old,...tail,invalid]
  const bytes = JSON.stringify(history)
  expect(coverageWeight(history)).toBe(0)
  expect(coverageWeight(history,6,9)).toBe(48)
  expect(weight(history)).toBe(0)
  expect(JSON.stringify(history)).toBe(bytes)
})

test('coverage sampling uses the linear weights with deterministic injected randomness', () => {
  const history = [...Array.from({length:3},(_,i) => observation(i,1,1)),observation(30,2,2),observation(31,3,3)]
  const weighted = vi.fn().mockReturnValueOnce(0.75).mockReturnValueOnce(0.005)
  expect(randomQuestion(weighted,history,undefined,now)).toEqual({left:1,right:2})
  expect(weighted).toHaveBeenCalledTimes(2)
  const difficult = [...history,observation(32,9,6,false),observation(33,4,4),observation(34,5,5)]
  const random = vi.fn().mockReturnValueOnce(0.25).mockReturnValueOnce(0.005)
  expect(randomQuestion(random,difficult,undefined,now)).toEqual({left:1,right:1})
  expect(random).toHaveBeenCalledTimes(2)
})

test('coverage beats even maximum error plus speed until three completions, then error beats speed', () => {
  const history = [...covered(),...baseline(),observation(30,9,6,false),observation(31,8,7,true,8000)]
  const hard = questionWeights(history,now).find(q => q.left===9 && q.right===6)!
  const slow = questionWeights(history,now).find(q => q.left===8 && q.right===7)!
  expect(hard.coverageBoost).toBe(0)
  expect(hard.weight).toBeGreaterThan(slow.weight)
  expect(hard.weight).toBeLessThanOrEqual(14)
  for (const completed of [0,1,2]) {
    const competing = [...history.filter(q => q.left!==12 || q.right!==12),...Array.from({length:completed},(_,i) => observation(50+i,12,12))]
    const undercovered = questionWeights(competing,now).find(q => q.left===12 && q.right===12)!
    expect(undercovered.weight).toBe(16*(3-completed))
    expect(undercovered.weight).toBeGreaterThan(14)
    expect(undercovered.weight).toBeGreaterThan(hard.weight)
  }
})

test('seeded coverage sampling favours less-completed cohorts without retiring practised facts (not learning efficacy)', () => {
  const history: AttemptRecord[] = []
  for (let i=0; i<144; i++) {
    for (let j=0; j<i%4; j++) history.push(observation(i*3+j,Math.floor(i/12)+1,i%12+1))
  }
  const counts = draws(history,6000)
  const cohorts = [0,0,0,0]
  for (let i=0; i<144; i++) cohorts[i%4]! += counts.get(`${Math.floor(i/12)+1}x${i%12+1}`) ?? 0
  expect(cohorts[0]!).toBeGreaterThan(cohorts[1]!)
  expect(cohorts[1]!).toBeGreaterThan(cohorts[2]!)
  expect(cohorts[2]!).toBeGreaterThan(cohorts[3]!)
  expect(cohorts[0]! / cohorts[3]!).toBeGreaterThan(2.2)
  expect(cohorts[0]! / cohorts[3]!).toBeLessThan(3.8)
  expect(cohorts[3]!).toBeGreaterThan(500)
},30000)

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
  expect(draws([...covered(),...eligible]).get('9x6')!).toBeGreaterThan(1000)
},30000)

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
    const all = [...covered(),...older,current]
    expect(restoreRound([current],new Set(),all,() => 0.75)).toMatchObject({phase:'playing',questionIndex:1,left:9,right:6})
    expect(restoreRound([current],new Set([current.roundId]),all)).toEqual({phase:'ready'})
    expect(restoreRound([error],new Set(),all,() => 0.75)).toMatchObject({phase:'playing',questionIndex:0,left:9,right:6,elapsedMs:1000})
  } finally { clock.mockRestore() }
})

test('seeded comparison improves distinct and three-completion coverage versus the previous error-first selector, not learning efficacy', () => {
  // Previous production policy, sharing the unchanged difficulty calculation.
  // These synthetic histories are appended in presentation order.
  const previous = (history: AttemptRecord[],random: () => number,roundId: string) => {
    const observed = groupQuestions(history).map(rows => rows[0]!)
    const cooling = new Set(observed.slice(-2).flatMap(q => [`${q.left}x${q.right}`,`${q.right}x${q.left}`]))
    const choices = questionWeights(history,now,roundId).filter(q => !cooling.has(`${q.left}x${q.right}`)
      && observed.filter(a => a.roundId===roundId && a.left===q.left && a.right===q.right).length<2)
    if (!choices.some(q => q.difficultyWeight>0) || random()<0.5) return choices[Math.floor(random()*choices.length)]!
    let target = random()*choices.reduce((sum,q) => sum+0.05+q.difficultyWeight,0)
    return choices.find(q => (target-=0.05+q.difficultyWeight)<0) ?? choices.at(-1)!
  }
  const results = [3,73,601,9001].map(seed => {
    const run = (current: boolean) => {
      const history: AttemptRecord[] = [], counts = new Map<string,number>(), random=seeded(seed)
      let distinct144=0
      for (let n=0; n<600; n++) {
        const roundId=uuid(30000+Math.floor(n/10))
        const q=current ? randomQuestion(random,history,roundId,now) : previous(history,random,roundId)
        const key=`${q.left}x${q.right}`
        counts.set(key,(counts.get(key) ?? 0)+1)
        const row={...observation(n+1000,q.left,q.right,true,q.left===6 ? 8000 : 1000),roundId,questionIndex:n%10}
        // Identical fact-dependent synthetic behavior, including correction.
        if (q.left>=9 && q.right>=9) history.push({...row,id:uuid(50000+n),correct:false,answer:-1,elapsedMs:500})
        history.push(row)
        if (n===143) distinct144=counts.size
      }
      return {distinct144,threeAt600:[...counts.values()].filter(n => n>=3).length}
    }
    return {seed,previous:run(false),coverageFirst:run(true)}
  })
  const total = (current: boolean,key: 'distinct144' | 'threeAt600') => results.reduce((sum,r) => sum+(current ? r.coverageFirst : r.previous)[key],0)
  expect(total(true,'distinct144')).toBeGreaterThan(total(false,'distinct144'))
  expect(total(true,'threeAt600')).toBeGreaterThan(total(false,'threeAt600'))
  console.info('Synthetic selection-policy comparison:',JSON.stringify(results))
},60000)

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
