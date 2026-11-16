// Raw browser strings are the backup authority, including unreadable/future data.
export const BACKUP_KEY = 'arithmetic:synthetic:backup:v1'
export const JOURNAL_KEY = 'arithmetic:synthetic:journal:v1'
export const EPOCH_KEY = 'arithmetic:synthetic:epoch:v1'
export const DATA_LOCK = 'arithmetic:data-replacement:v1'
export type HistoryBytes = Record<string,string>
export function isHistoryKey(key:string) {
  return ['arithmetic:attempt:','arithmetic:round-cancel:','arithmetic:division:','arithmetic:round:','arithmetic:division-round:'].some(prefix=>key.startsWith(prefix))
}
export function captureHistory(storage:Storage):HistoryBytes {
  const result:HistoryBytes = {}
  const keys=Array.from({length:storage.length},(_,i)=>storage.key(i)).filter((k):k is string=>!!k && isHistoryKey(k)).sort()
  for(const key of keys) {const value=storage.getItem(key);if(value===null) throw Error('History changed during snapshot');result[key]=value}
  return result
}
function validHistory(value:unknown):value is HistoryBytes {
  return !!value && typeof value==='object' && !Array.isArray(value) && Object.entries(value).every(([k,v])=>isHistoryKey(k) && typeof v==='string')
}
function readEnvelope(storage:Storage,key:string) {
  const raw=storage.getItem(key)
  if(raw===null)return null
  const value=JSON.parse(raw)
  if(!value || value.version!==1 || !validHistory(value.history))throw Error('Unsupported recovery data. Original backup has been kept.')
  return value as {version:1;history:HistoryBytes;epoch?:string;operation?:string}
}
function write(storage:Storage,key:string,value:string|null) {
  if(value===null) storage.removeItem(key);else storage.setItem(key,value)
  if(storage.getItem(key)!==value)throw Error('Storage readback failed; recovery data has been kept.')
}
function equal(a:HistoryBytes,b:HistoryBytes) {return Object.keys(a).length===Object.keys(b).length && Object.entries(a).every(([k,v])=>b[k]===v)}
export function hasBackup(storage:Storage) {return readEnvelope(storage,BACKUP_KEY)!==null}
export function assertNoReplacement() {
  if(localStorage.getItem(JOURNAL_KEY)!==null)throw Error('An interrupted data change needs recovery. Open data tools to recover before practicing.')
}
function finish(storage:Storage) {
  const journal=readEnvelope(storage,JOURNAL_KEY)
  if(!journal || typeof journal.epoch!=='string' || !['load','restore'].includes(journal.operation??''))throw Error('Unsupported replacement journal; backup has been kept.')
  // Re-verify the original recovery source before any removal, even on retry.
  if(!readEnvelope(storage,BACKUP_KEY))throw Error('Original backup is missing. No further changes were made.')
  const target=journal.history
  for(const key of Object.keys(captureHistory(storage))) if(!(key in target))write(storage,key,null)
  for(const [key,bytes] of Object.entries(target))if(storage.getItem(key)!==bytes)write(storage,key,bytes)
  if(!equal(captureHistory(storage),target))throw Error('History verification failed; recovery journal has been kept.')
  write(storage,EPOCH_KEY,journal.epoch)
  write(storage,JOURNAL_KEY,null)
}
export function recoverHistory(storage:Storage) {finish(storage)}
function begin(storage:Storage,history:HistoryBytes,operation:'load'|'restore') {
  if(storage.getItem(JOURNAL_KEY)!==null) {
    if(operation!=='restore')throw Error('Recover the interrupted change first.')
    readEnvelope(storage,JOURNAL_KEY) // Never overwrite unsupported recovery metadata.
  }
  if(!validHistory(history))throw Error('Invalid replacement history')
  write(storage,JOURNAL_KEY,JSON.stringify({version:1,operation,epoch:crypto.randomUUID(),history}))
  finish(storage)
}
export function replaceHistory(storage:Storage,history:HistoryBytes) {
  if(storage.getItem(JOURNAL_KEY)!==null)throw Error('Recover the interrupted change first.')
  const existing=readEnvelope(storage,BACKUP_KEY)
  if(!existing)write(storage,BACKUP_KEY,JSON.stringify({version:1,history:captureHistory(storage)}))
  begin(storage,history,'load')
}
export function restoreHistory(storage:Storage) {
  const backup=readEnvelope(storage,BACKUP_KEY)
  if(!backup)throw Error('No original backup is available.')
  begin(storage,backup.history,'restore')
}
export async function withReplacementLock(action:()=>void) {
  if(!navigator.locks)throw Error('Web Locks are required. Close or reload other tabs, then use a supported browser.')
  await navigator.locks.request(DATA_LOCK,{mode:'exclusive',ifAvailable:true},async lock=>{
    if(!lock)throw Error('A practice round is active, starting or waiting to save in this or another tab. Finish or cancel it first.')
    const locks=await navigator.locks.query()
    if(locks.held?.some(lock=>lock.name?.startsWith('arithmetic:round:')))throw Error('Another app version has an active round. Close or reload other tabs before changing data.')
    action()
  })
}
// Optional hints are never authority. Epoch fencing prevents closed/background
// tabs from restoring a hint from the history that was replaced.
export function reconcileHints() {
  const epoch=localStorage.getItem(EPOCH_KEY)
  if(sessionStorage.getItem(EPOCH_KEY)!==epoch) {
    sessionStorage.removeItem('arithmetic:round:v1');sessionStorage.removeItem('arithmetic:division-round:v1')
    if(epoch===null)sessionStorage.removeItem(EPOCH_KEY);else sessionStorage.setItem(EPOCH_KEY,epoch)
  }
}
