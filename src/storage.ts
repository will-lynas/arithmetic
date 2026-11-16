import type { AttemptRecord } from './types'
export const ATTEMPT_PREFIX = 'arithmetic:attempt:v1:'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function isAttempt(value: unknown): value is AttemptRecord {
  if (!value || typeof value !== 'object') return false
  const r = value as AttemptRecord
  return r.version === 1 && typeof r.id === 'string' && UUID.test(r.id)
    && typeof r.roundId === 'string' && UUID.test(r.roundId)
    && Number.isInteger(r.questionIndex) && r.questionIndex >= 0 && r.questionIndex < 10
    && Number.isInteger(r.left) && r.left >= 1 && r.left <= 12
    && Number.isInteger(r.right) && r.right >= 1 && r.right <= 12
    && Number.isSafeInteger(r.answer) && r.correct === (r.answer === r.left * r.right)
    && Number.isFinite(r.elapsedMs) && r.elapsedMs >= 0
    && typeof r.submittedAt === 'string' && Number.isFinite(Date.parse(r.submittedAt))
    && new Date(r.submittedAt).toISOString() === r.submittedAt
}
function read() {
  const attempts: AttemptRecord[] = []
  const warnings: string[] = []
  try {
    const theme = localStorage.getItem('arithmetic:theme')
    if (theme !== null && theme !== 'light' && theme !== 'dark') warnings.push('Saved theme could not be read. Its original data has been kept.')
    // Immutable per-event keys avoid cross-tab read/modify/write array races.
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
    for (const key of keys) {
      if (!key?.startsWith('arithmetic:attempt:')) continue
      try {
        const value: unknown = JSON.parse(localStorage.getItem(key) ?? '')
        if (!isAttempt(value) || key !== ATTEMPT_PREFIX + value.id) throw new Error('Unsupported event')
        attempts.push(value)
      } catch { warnings.push('Some saved attempts could not be read. Their original data has been kept.') }
    }
  } catch { warnings.push('Browser storage is unavailable. Allow site storage before answering.') }
  attempts.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt) || a.questionIndex - b.questionIndex || a.elapsedMs - b.elapsedMs || a.id.localeCompare(b.id))
  return { attempts, warnings: [...new Set(warnings)] }
}
export function loadAttempts(): AttemptRecord[] { return read().attempts }
export function loadStorageWarnings(): string[] { return read().warnings }
export function appendAttempt(record: AttemptRecord): void {
  if (!isAttempt(record)) throw new Error('Invalid attempt; nothing was saved.')
  const key = ATTEMPT_PREFIX + record.id
  const bytes = JSON.stringify(record)
  const previous = localStorage.getItem(key)
  if (previous !== null && previous !== bytes) throw new Error('Attempt ID already exists; original data was kept.')
  if (previous === null) localStorage.setItem(key, bytes)
  if (localStorage.getItem(key) !== bytes) throw new Error('Could not verify the saved attempt.')
}
