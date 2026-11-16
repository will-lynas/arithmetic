export interface SpeedScale { min: number | null; max: number | null }

export function speedScale(values: readonly (number | null)[]): SpeedScale {
  const observed = values.filter((value): value is number => value !== null && Number.isFinite(value))
  return observed.length ? { min: Math.min(...observed), max: Math.max(...observed) } : { min: null, max: null }
}

export function speedPosition(value: number | null, scale: SpeedScale): number | null {
  if (value === null || !Number.isFinite(value) || scale.min === null || scale.max === null) return null
  if (scale.min === scale.max) return 0.5
  return Math.max(0, Math.min(1, (value - scale.min) / (scale.max - scale.min)))
}

export function speedDuration(value: number | null): string {
  if (value === null) return '—'
  const seconds = value / 1000
  return `${seconds !== 0 && (seconds < 0.01 || seconds >= 10000) ? seconds.toExponential(1).replace('e+', 'e') : seconds.toFixed(2)} s`
}
