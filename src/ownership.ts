// One live writer per round. Immutable attempt writes remain synchronous: locks
// are acquired before showing a playable question, never after submission.
export function acquireRound(roundId: string): Promise<(() => void) | null> {
  if (!navigator.locks) return Promise.reject(new Error('Round ownership is unavailable'))
  return new Promise((resolve, reject) => {
    navigator.locks.request(`arithmetic:round:${roundId}`, {mode:'exclusive', ifAvailable:true}, lock => {
      if (!lock) { resolve(null); return }
      return new Promise<void>(release => resolve(release))
    }).catch(reject)
  })
}
