import { beforeEach, expect, test } from 'vitest'
import { appendAttempt, loadAttempts, loadStorageWarnings } from './storage'
const memory = new Map<string, string>()
const storage = { get length() { return memory.size }, key: (i: number) => [...memory.keys()][i] ?? null, getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value) } }
beforeEach(() => { memory.clear(); Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true }) })
const record = { version: 1 as const, id: '126a9d79-6343-457b-8b54-28aa2e85a912', roundId: 'e02e01cf-a4c4-48a1-9b34-772b559c1887', questionIndex: 0, left: 12, right: 7, answer: 83, correct: false, elapsedMs: 123.5, submittedAt: '2026-01-01T00:00:00.000Z' }
test('every immutable submission survives reads; idempotent retries do not overwrite', () => {
  appendAttempt(record); const bytes = [...memory.values()][0]
  appendAttempt(record)
  expect(loadAttempts()).toEqual([record]); expect(memory.size).toBe(1)
  expect(loadStorageWarnings()).toEqual([])
  expect(() => appendAttempt({ ...record, answer: 84, correct: true })).toThrow()
  expect([...memory.values()][0]).toBe(bytes)
})
test('corrupt attempts and unsupported preferences remain untouched and warn', () => {
  memory.set('arithmetic:attempt:v2:future','{"version":2}')
  memory.set('arithmetic:attempt:v1:broken','{')
  memory.set('arithmetic:theme','future-theme')
  const before = [...memory.entries()]
  expect(loadAttempts()).toEqual([])
  expect(loadStorageWarnings().some(w => w.includes('theme'))).toBe(true)
  expect([...memory.entries()]).toEqual(before)
})
test('silent failed write is rejected by readback', () => {
  Object.defineProperty(globalThis, 'localStorage', {value:{...storage, setItem:()=>{}}, configurable:true})
  expect(() => appendAttempt(record)).toThrow('verify')
})
