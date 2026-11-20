import { expect, test } from 'vitest'
import { formatQuadratic, gradeFactors, quadraticRound, QUADRATIC_BANK } from './quadratics'

test('accepts reversed and equivalent signed factors of a monic quadratic', () => {
  const q = { b: 1, c: -6 }
  for (const answer of [[1, -2, 1, 3], [1, 3, 1, -2], [-1, 2, -1, -3]] as const) {
    expect(gradeFactors(q, answer)).toBe(true)
  }
  expect(gradeFactors(q, [1, -3, 1, 2])).toBe(false)
  expect(gradeFactors(q, [2, -4, 1, 3])).toBe(false)
})

test('formats signed quadratics without zero terms or unit coefficients', () => {
  expect(formatQuadratic({b: 1, c: -6})).toBe('x² + x − 6')
  expect(formatQuadratic({b: -1, c: 0})).toBe('x² − x')
  expect(formatQuadratic({b: 0, c: -9})).toBe('x² − 9')
  expect(formatQuadratic({b: 0, c: 0})).toBe('x²')
})

test('samples five distinct problems from a varied, integer-factorable bank', () => {
  expect(new Set(QUADRATIC_BANK.map(formatQuadratic)).size).toBe(QUADRATIC_BANK.length)
  expect(QUADRATIC_BANK.some(q => q.c === 0)).toBe(true)
  expect(QUADRATIC_BANK.some(q => q.b === 0 && q.c < 0)).toBe(true)
  expect(QUADRATIC_BANK.some(q => q.c > 0 && q.b < 0)).toBe(true)
  expect(QUADRATIC_BANK.some(q => q.c > 0 && q.b > 0)).toBe(true)
  expect(QUADRATIC_BANK.some(q => q.b !== 0 && q.b ** 2 === 4 * q.c)).toBe(true)
  for (const q of QUADRATIC_BANK) {
    const d = Math.sqrt(q.b ** 2 - 4 * q.c)
    expect(Number.isInteger((q.b + d) / 2)).toBe(true)
  }
  for (const random of [() => 0, () => 0.999999]) {
    const round = quadraticRound(random)
    expect(new Set(round.map(formatQuadratic)).size).toBe(5)
    expect(round.every(q => QUADRATIC_BANK.includes(q))).toBe(true)
  }
})
