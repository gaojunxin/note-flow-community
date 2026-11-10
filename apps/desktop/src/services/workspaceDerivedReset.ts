import {notifyAttachmentChange} from './attachmentChanges'
import {createAttachmentTextIndex} from '@note-flow/core/attachment-text-index'
import {accountLifecycleRevision} from './accountStorage'
import {appLock} from './appLock'
import {clearWorkspaceUnlockSession} from './workspaceUnlockSession'
/** Derived data only. Wrapped workspace keys remain available for recovery. */
export async function clearWorkspaceDerivedIndexes(ownerScope:string){
 clearWorkspaceUnlockSession()
 const store=createAttachmentTextIndex({scope:()=>ownerScope,generation:accountLifecycleRevision,locked:()=>appLock.locked.value})
 try{const result=await store.clearScope();notifyAttachmentChange(ownerScope);return result}finally{await store.close()}
}
