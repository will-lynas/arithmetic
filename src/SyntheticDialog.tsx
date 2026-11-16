import { useEffect, useRef, useState } from 'react'
import App from './App'
import { generateSyntheticHistory } from './syntheticData'
import { EPOCH_KEY, JOURNAL_KEY, hasBackup, reconcileHints, recoverHistory, replaceHistory, restoreHistory, withReplacementLock } from './syntheticStore'
import './synthetic.css'
const changed='arithmetic:data-changed'
function storageState() {
  try {return {epoch:localStorage.getItem(EPOCH_KEY)??'',blocked:localStorage.getItem(JOURNAL_KEY)!==null}}
  catch {return {epoch:'',blocked:false}}
}
function lightTheme() {try{return localStorage.getItem('arithmetic:theme')==='light'}catch{return false}}
export function DataBoundary() {
  const [state,setState]=useState(storageState)
  useEffect(()=>{
    const refresh=()=>{try{reconcileHints()}catch{/* Optional hints only. */}setState(storageState())}
    refresh()
    const storage=(e:StorageEvent)=>{if([EPOCH_KEY,JOURNAL_KEY].includes(e.key??''))refresh()}
    window.addEventListener('storage',storage);window.addEventListener(changed,refresh)
    return()=>{window.removeEventListener('storage',storage);window.removeEventListener(changed,refresh)}
  },[])
  // Before the first App restoration effect reads its hints.
  try {reconcileHints()}catch{/* Storage warnings remain owned by the app. */}
  return <>{state.blocked?<div className={`app${lightTheme()?' light':''}`}><p className="storage-warning" role="alert">An interrupted data change needs recovery. Press Ctrl+Alt+Shift+S to open recovery. Practice is paused; the original backup is kept.</p></div>:<App key={state.epoch}/>}<SyntheticDialog/></>
}
type Step='menu'|'load'|'restore'|'recover'
function SyntheticDialog() {
  const [open,setOpen]=useState(false),[step,setStep]=useState<Step>('menu')
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('')
  const [backup,setBackup]=useState(false),[interrupted,setInterrupted]=useState(false),[light,setLight]=useState(false)
  const dialog=useRef<HTMLDialogElement>(null),cancel=useRef<HTMLButtonElement>(null),working=useRef(false)
  function dismiss(){if(!working.current)setOpen(false)}
  function inspect() {
    try{setBackup(hasBackup(localStorage));setInterrupted(localStorage.getItem(JOURNAL_KEY)!==null)}
    catch(e){setError(String(e))}
  }
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      if(e.defaultPrevented || e.repeat || e.isComposing || e.keyCode===229 || e.code!=='KeyS' || !e.ctrlKey || !e.altKey || !e.shiftKey || e.metaKey)return
      const target=e.target
      if(target instanceof Element && target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])') && !target.matches('.equation input'))return
      if(document.querySelector('dialog[open], [role="dialog"], [role="menu"], [role="listbox"]'))return
      e.preventDefault();setError('');setStatus('');setStep('menu');setLight(!!document.querySelector('.app.light'));inspect();setOpen(true)
    }
    const route=()=>dismiss()
    document.addEventListener('keydown',key);window.addEventListener('popstate',route)
    return()=>{document.removeEventListener('keydown',key);window.removeEventListener('popstate',route)}
  },[])
  useEffect(()=>{if(open){dialog.current?.showModal();cancel.current?.focus()}},[open])
  useEffect(()=>{cancel.current?.focus()},[step])
  async function execute() {
    if(working.current)return
    working.current=true;setBusy(true);setError('');setStatus('')
    try {
      await withReplacementLock(()=>{
        if(step==='load')replaceHistory(localStorage,generateSyntheticHistory())
        else if(step==='restore')restoreHistory(localStorage)
        else if(step==='recover')recoverHistory(localStorage)
        else throw Error('Choose a data action first.')
      })
      setStatus(step==='load'?'Synthetic data loaded.':step==='restore'?'Original backup restored.':'Interrupted change recovered.')
      setStep('menu')
    }catch(e){setError(`${e instanceof Error?e.message:String(e)} No success was recorded. Keep the backup; free site storage if needed, then recover the interrupted change.`)}
    finally {
      working.current=false;setBusy(false);inspect();window.dispatchEvent(new Event(changed))
    }
  }
  if(!open)return null
  return <dialog ref={dialog} className={`app synthetic-dialog${light?' light':''}`} aria-labelledby="synthetic-title" aria-describedby="synthetic-description" onCancel={e=>{e.preventDefault();dismiss()}}>
    <h2 id="synthetic-title">Synthetic data</h2>
    <p id="synthetic-description">{step==='menu'?'Replace practice history with invented examples, or restore the first original backup.':step==='load'?'Replace ALL multiplication and division practice history and round state in this browser on this site? The first original backup is kept.':step==='restore'?'Restore the exact original multiplication and division history and round state? ALL later practice, including synthetic practice, will be discarded.':'Finish the interrupted replacement or restore from its saved journal? Practice stays paused until every byte is verified.'}</p>
    {step!=='menu' && <p>Only this browser and site origin ({location.origin}) are affected. Other domains and devices, theme and unrelated data are unchanged.</p>}
    {step==='menu' && <p className="synthetic-note">Finish or cancel active rounds first. Close or reload older app tabs: versions predating this safeguard cannot be retroactively protected.</p>}
    {error && <p role="alert">{error}</p>}{status && <p role="status">{status}</p>}
    <div className="synthetic-actions">
      <button ref={cancel} type="button" disabled={busy} onClick={dismiss}>Cancel</button>
      {step==='menu'?<>{interrupted?<button disabled={busy} onClick={()=>setStep('recover')}>Recover interrupted change</button>:<button disabled={busy} onClick={()=>setStep('load')}>Load synthetic data</button>}{backup && <button disabled={busy} onClick={()=>setStep('restore')}>Restore backup</button>}</>:<button disabled={busy} onClick={()=>void execute()}>{busy?'Verifying…':step==='load'?'Replace all practice data':step==='restore'?'Restore original backup':'Confirm recovery'}</button>}
    </div>
  </dialog>
}
