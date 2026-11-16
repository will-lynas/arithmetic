import { describe, expect, it } from 'vitest'
import { speedScale, speedPosition, speedDuration } from './speedPresentation'

describe('speed presentation', () => {
  it('keeps empty, singleton and all-equal scales honest without false contrast', () => {
    expect(speedScale([null, null])).toEqual({ min: null, max: null })
    expect(speedPosition(null, speedScale([]))).toBeNull()
    for (const values of [[0], [3000], [3000, 3000]]) {
      const scale = speedScale(values)
      expect(scale).toEqual({ min: values[0], max: values[0] })
      expect(speedPosition(values[0], scale)).toBe(0.5)
    }
  })
  it('maps observed pair means linearly from fastest green to slowest red, retaining outliers', () => {
    const scale = speedScale([null, 0, 4000, 1000000])
    expect(scale).toEqual({ min: 0, max: 1000000 })
    expect(speedPosition(0, scale)).toBe(0)
    expect(speedPosition(4000, scale)).toBe(0.004)
    expect(speedPosition(1000000, scale)).toBe(1)
    expect(speedPosition(null, scale)).toBeNull()
  })
  it('formats zero and extremes compactly and can distinguish nearby legend endpoints', () => {
    expect(speedDuration(null)).toBe('—')
    expect(speedDuration(0)).toBe('0.00 s')
    expect(speedDuration(4000)).toBe('4.00 s')
    expect(speedDuration(Number.MAX_VALUE)).toMatch(/^1\.8e305 s$/)
    expect(speedDuration(0.001)).not.toBe(speedDuration(0))
  })
})
