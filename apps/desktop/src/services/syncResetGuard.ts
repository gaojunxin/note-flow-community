import {browserRestoreScope} from './browserRestoreScope'
import {readBrowserRestoreStatus} from './browserRestoreJournal'
import {readRestoreJournal} from './localRestoreJournal'
import {accountLifecycleRevision,readAccountSetting} from './accountStorage'
import {isDesktopClient} from './serverConfig'
const PAUSE_EVENT='note-flow:sync-reset-pause'
const RESUME_EVENT='note-flow:sync-reset-resume'

let paused=false
let pauseCount=0
let resetRelease:(()=>void)|undefined
const active=new Set<Promise<unknown>>()

const editionPauseKey=(profileId:string)=>`note-flow-pc-edition-pause-v1:${encodeURIComponent(profileId)}`
const activeProfile=()=>{try{return JSON.parse(readAccountSetting('note-flow-pc-local-profile-v1')||'null')?.profileId as string|undefined}catch{return undefined}}
export function editionTransferPaused(profileId:string){return Boolean(profileId&&localStorage.getItem(editionPauseKey(profileId))==='1')}
export function beginEditionTransferPause(profileId:string){
 if(!profileId)throw new Error('本地空间不可用')
 localStorage.setItem(editionPauseKey(profileId),'1')
 globalThis.window?.dispatchEvent(new Event(PAUSE_EVENT))
}
export function endEditionTransferPause(profileId:string){
 localStorage.removeItem(editionPauseKey(profileId))
 if(!pcSyncResetPaused())globalThis.window?.dispatchEvent(new Event(RESUME_EVENT))
}
export function pcSyncResetPaused(){const profileId=activeProfile();return paused||Boolean(profileId&&editionTransferPaused(profileId))}

/** Pause new sync work and wait for sync already touching the profile DB to settle. */
export async function pausePcSync(){
  pauseCount++
  if(!paused){paused=true;globalThis.window?.dispatchEvent(new Event(PAUSE_EVENT))}
  await Promise.allSettled([...active])
  let released=false
  return ()=>{
    if(released)return
    released=true;pauseCount--
    if(!pauseCount){paused=false;if(!pcSyncResetPaused())globalThis.window?.dispatchEvent(new Event(RESUME_EVENT))}
  }
}

export async function beginPcSyncReset(){resetRelease=await pausePcSync()}

export function endPcSyncReset(){
  resetRelease?.();resetRelease=undefined
}


/** Public status exposes no digest, path, content or other backup metadata. */
export async function localRestoreStatus(){
 const profileId=activeProfile(),revision=accountLifecycleRevision()
 if(!isDesktopClient()){const scope=browserRestoreScope();if(!scope)return 'none' as const;const pending=await readBrowserRestoreStatus(scope);if(scope!==browserRestoreScope()||revision!==accountLifecycleRevision())throw Error('账号或空间已切换，请重新检查恢复状态');return pending}
 if(!profileId)return 'none' as const
 const pending=await readRestoreJournal(profileId)
 if(profileId!==activeProfile()||revision!==accountLifecycleRevision())throw Error('账号或空间已切换，请重新检查恢复状态')
 return pending
}

export async function localRestorePending(){return await localRestoreStatus()!=='none'}

export async function runPcSyncGuarded<T>(action:()=>Promise<T>):Promise<T|undefined>{
  if(pcSyncResetPaused())return undefined
  const profileId=activeProfile(),revision=accountLifecycleRevision(),desktop=isDesktopClient(),webScope=desktop?undefined:browserRestoreScope()
  const operation=(async()=>{
    // The SQLite journal survives crashes and is cleared only after every store
    // has finished restoring. Never cache a negative result across sync calls.
    if(profileId&&isDesktopClient()){
      if(await readRestoreJournal(profileId)!=='none')return undefined
    }
    if(webScope&&await readBrowserRestoreStatus(webScope)!=='none')return undefined
    if(pcSyncResetPaused()||profileId!==activeProfile()||revision!==accountLifecycleRevision()||desktop!==isDesktopClient()||webScope!==(isDesktopClient()?undefined:browserRestoreScope()))return undefined
    return action()
  })()
  active.add(operation)
  try{return await operation}finally{active.delete(operation)}
}

export const pcSyncResetEvents={pause:PAUSE_EVENT,resume:RESUME_EVENT} as const
