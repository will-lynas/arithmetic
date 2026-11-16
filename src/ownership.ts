import { assertNoReplacement, DATA_LOCK } from './syntheticStore'
// Hold shared origin-wide ownership for the entire active/pending-save round.
// Immutable submissions stay synchronous; no await is added at the answer edge.
export function acquireRound(roundId: string): Promise<(() => void) | null> {
  if (!navigator.locks) return Promise.reject(new Error('Round ownership is unavailable'))
  return new Promise((resolve, reject) => {
    navigator.locks.request(DATA_LOCK, {mode:'shared', ifAvailable:true}, async dataLock => {
      if(!dataLock)throw Error('Data replacement is in progress')
      assertNoReplacement()
      await navigator.locks.request(`arithmetic:round:${roundId}`, {mode:'exclusive', ifAvailable:true}, lock => {
        if (!lock) { resolve(null); return }
        assertNoReplacement()
        return new Promise<void>(release => resolve(release))
      })
    }).catch(reject)
  })
}
