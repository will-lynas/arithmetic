import { expect, test } from 'vitest'
import { ActiveClock, randomQuestion, parseAnswer, restoreRound } from './game'
test('question time is monotonic active time, cumulative across retries and pauses', () => {
  let now = 100
  const clock = new ActiveClock(() => now, 20)
  now = 10000; expect(clock.elapsed()).toBe(20)
  clock.setActive(true); now += 300; expect(clock.elapsed()).toBe(320)
  clock.setActive(false); now += 5000; clock.setActive(false)
  expect(clock.elapsed()).toBe(320)
  clock.setActive(true); now += 200; expect(clock.elapsed()).toBe(520)
})
test('operands are sampled independently over the full inclusive range', () => {
  const samples = [0, 0.999999, 0.5, 0]
  expect(randomQuestion(() => samples.shift()!)).toEqual({left: 1, right: 12})
  expect(randomQuestion(() => samples.shift()!)).toEqual({left: 7, right: 1})
})
test('only explicit safe integers are submissions', () => {
  for (const text of ['', ' ', '1.0', '2e2', '1.2', 'NaN', '9007199254740993']) expect(parseAnswer(text)).toBeNull()
  expect(parseAnswer(' 144 ')).toBe(144); expect(parseAnswer('-1')).toBe(-1)
})
test('empty event history restores ready without starting a clock', () => {
  expect(restoreRound([])).toEqual({phase: 'ready'})
})
