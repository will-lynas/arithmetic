export interface AttemptRecord {
  version: 1
  id: string
  roundId: string
  questionIndex: number
  left: number
  right: number
  answer: number
  correct: boolean
  elapsedMs: number
  submittedAt: string
}
