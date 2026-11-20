export type Quadratic = Readonly<{ b: number; c: number }>
export type Factors = readonly [number, number, number, number]
export const QUADRATIC_ROUND_LENGTH = 5

// Each pair gives the constants in (x + m)(x + n).
export const QUADRATIC_BANK: readonly Quadratic[] = [
  [-2, 3], [1, 2], [-2, -3], [2, 4], [-3, -5], [1, -5], [-4, 5],
  [3, -3], [4, -4], [3, 3], [-4, -4], [0, -1], [0, 4], [0, 0],
  [2, 6], [-2, -7], [5, -7], [-6, 8], [1, 9], [-3, -8],
].map(([m, n]) => ({b: m + n, c: m * n}))

export const quadraticKey = ({b, c}: Quadratic) => `${b},${c}`

export function quadraticRound(random = Math.random): Quadratic[] {
  const pool = [...QUADRATIC_BANK]
  return Array.from({length: QUADRATIC_ROUND_LENGTH}, () => pool.splice(Math.floor(random() * pool.length), 1)[0])
}

export function formatQuadratic({b, c}: Quadratic) {
  const term = (coefficient: number, symbol = '') => coefficient === 0 ? '' :
    ` ${coefficient < 0 ? '−' : '+'} ${symbol && Math.abs(coefficient) === 1 ? '' : Math.abs(coefficient)}${symbol}`
  return `x²${term(b, 'x')}${term(c)}`
}

// For a monic product the integer leading coefficients must both be +1 or
// both be -1. Compare the middle and constant terms exactly, even for large inputs.
export function gradeFactors({b, c}: Quadratic, [a, m, d, n]: Factors) {
  if ((a !== 1 && a !== -1) || d !== a || !Number.isSafeInteger(m) || !Number.isSafeInteger(n)) return false
  return BigInt(a) * (BigInt(m) + BigInt(n)) === BigInt(b) && BigInt(m) * BigInt(n) === BigInt(c)
}
