import './workspaceKeyChanges'
import {createWorkspaceUnlockSession} from '@note-flow/core/workspace-unlock-session'
import {createWorkspaceKeyStore} from '@note-flow/core/workspace-key-store'
import {clientOwnerScope} from './clientContext'
import {accountLifecycleRevision} from './accountStorage'
import {appLock} from './appLock'
let active:{ownerId:string;session:ReturnType<typeof createWorkspaceUnlockSession>;keys:ReturnType<typeof createWorkspaceKeyStore>}|undefined
/** Called only by explicit encrypted-workspace operations; import opens no database. */
export function workspaceUnlockSession(ownerId:string){
 if(!ownerId)throw Error('加密空间账号不可用')
 if(active?.ownerId!==ownerId)clearWorkspaceUnlockSession()
 if(!active){
  const options={scope:()=>clientOwnerScope(ownerId),generation:accountLifecycleRevision},keys=createWorkspaceKeyStore(options)
  active={ownerId,keys,session:createWorkspaceUnlockSession({...options,locked:()=>appLock.locked.value,keys})}
 }
 return active.session
}
export function clearWorkspaceUnlockSession(){const previous=active;active=undefined;previous?.session.lock();void previous?.keys.close().catch(()=>{})}
if(typeof window!=='undefined'&&typeof window.addEventListener==='function'){
 window.addEventListener('note-flow:workspace-key-change',event=>{if(active&&(event as CustomEvent).detail?.scope===clientOwnerScope(active.ownerId))clearWorkspaceUnlockSession()})
 for(const event of ['note-flow:app-locked','note-flow:account-lifecycle-change','note-flow:profile-change','note-flow:account-data-reset','pagehide'])window.addEventListener(event,clearWorkspaceUnlockSession)
}
