import {createWorkspaceKeyStore} from '@note-flow/core/workspace-key-store'
import {notifyWorkspaceKeyChange} from './workspaceKeyChanges'
import {createWorkspaceKeyEnvelope,changeWorkspacePassword} from '@note-flow/core/workspace-encryption'
import {createAttachmentTextIndex} from '@note-flow/core/attachment-text-index'
import {workspaceUnlockSession} from './workspaceUnlockSession'
import {clientOwnerScope} from './clientContext'
import {accountLifecycleRevision} from './accountStorage'
import {appLock} from './appLock'
import type {LocalAttachment} from './attachments'
export const ATTACHMENT_INDEX_WORKSPACE='attachment-search-index-v1'
function binding(ownerId:string,signal?:AbortSignal){const scope=clientOwnerScope(ownerId),revision=accountLifecycleRevision();return{scope,assert(){if(signal?.aborted)throw new DOMException('已取消索引操作','AbortError');if(scope!==clientOwnerScope(ownerId)||revision!==accountLifecycleRevision()||appLock.locked.value)throw Error('账号、空间或锁定状态已变化')}}}
function repository(ownerId:string){return createWorkspaceKeyStore({scope:()=>clientOwnerScope(ownerId),generation:accountLifecycleRevision})}
export async function attachmentIndexProtectionState(ownerId:string){const captured=binding(ownerId),keys=repository(ownerId);try{const record=await keys.read(ATTACHMENT_INDEX_WORKSPACE);captured.assert();return{configured:Boolean(record),unlocked:Boolean(record&&workspaceUnlockSession(ownerId).isUnlocked(ATTACHMENT_INDEX_WORKSPACE))}}finally{await keys.close()}}
export async function prepareAttachmentIndexProtection(ownerId:string,password:string,signal?:AbortSignal){
 const captured=binding(ownerId,signal);captured.assert()
 const keys=repository(ownerId)
 try{if(await keys.read(ATTACHMENT_INDEX_WORKSPACE))throw Error('索引保护已建立，请直接解锁');captured.assert()}finally{await keys.close()}
 const operationUid=crypto.randomUUID(),prepared=await createWorkspaceKeyEnvelope(ATTACHMENT_INDEX_WORKSPACE,password);captured.assert()
 return{recoveryCode:prepared.recoveryCode,async commit(signal?:AbortSignal){
  const committing=binding(ownerId,signal);captured.assert();committing.assert();const keys=repository(ownerId)
  try{await keys.initialize(prepared.envelope,password,prepared.recoveryCode,operationUid);captured.assert();committing.assert();await unlockAttachmentIndexProtection(ownerId,password,'password',signal);captured.assert();committing.assert()}finally{await keys.close()}
 }}
}
export async function unlockAttachmentIndexProtection(ownerId:string,secret:string,kind:'password'|'recovery',signal?:AbortSignal){
 const captured=binding(ownerId,signal);captured.assert()
 const session=workspaceUnlockSession(ownerId),expectedGeneration=session.generation()+1
 const abort=()=>{if(session.generation()===expectedGeneration)session.lock()}
 signal?.addEventListener('abort',abort,{once:true})
 try{await session.unlock(ATTACHMENT_INDEX_WORKSPACE,secret,kind);captured.assert()}finally{signal?.removeEventListener('abort',abort)}
}
export function lockAttachmentIndexProtection(ownerId:string){workspaceUnlockSession(ownerId).lock()}
export async function protectedAttachmentSearch(ownerId:string,signal?:AbortSignal){
 const captured=binding(ownerId,signal),session=workspaceUnlockSession(ownerId),lease=await session.acquire(ATTACHMENT_INDEX_WORKSPACE);captured.assert()
 const index=createAttachmentTextIndex({scope:()=>captured.scope,generation:()=>session.generation(),locked:()=>appLock.locked.value||!session.isUnlocked(ATTACHMENT_INDEX_WORKSPACE)})
 let epoch:number
 try{epoch=await index.epoch()}catch(error){await index.close();throw error}
 const assertEpoch=async()=>{if(await index.epoch()!==epoch)throw Error('附件索引已重置，请重新搜索')}
 const source=(row:LocalAttachment,extractorVersion:number)=>({workspaceUid:ATTACHMENT_INDEX_WORKSPACE,attachmentUid:row.uid,version:0,keyGeneration:lease.keyGeneration,sha256:row.sha256,extractorVersion})
 const assert=()=>{captured.assert();lease.assertCurrent()}
 return{
  async read(row:LocalAttachment,version:number){assert();await assertEpoch();try{const value=await index.read(source(row,version),lease.key);assert();await assertEpoch();return value}catch{assert();await assertEpoch();await lease.verifyCurrent();assert();return{revision:await index.revision(source(row,version)),text:undefined,searchText:undefined}}},
  async put(row:LocalAttachment,version:number,text:string,revision:number){assert();const value=await index.put(source(row,version),lease.key,text,revision,epoch);assert();return value},
  async finish(){assert();await assertEpoch();await lease.verifyCurrent();assert();await assertEpoch()},
  close:()=>index.close()
 }
}
export async function exportAttachmentIndexKey(ownerId:string){
 const captured=binding(ownerId),keys=repository(ownerId)
 try{const archive=await keys.exportArchive();captured.assert();archive.records=archive.records.filter(row=>row.workspaceUid===ATTACHMENT_INDEX_WORKSPACE);if(archive.records.length!==1)throw Error('附件索引密钥不存在');return archive}finally{await keys.close()}
}
export async function restoreAttachmentIndexKey(ownerId:string,json:string,secret:string,kind:'password'|'recovery',signal?:AbortSignal){
 const captured=binding(ownerId,signal);captured.assert()
 if(json.length>2*1024*1024)throw Error('索引密钥备份过大')
 let archive:import('@note-flow/core/workspace-key-store').WorkspaceKeyArchive
 try{archive=JSON.parse(json)}catch{throw Error('索引密钥备份格式无效')}
 if(archive?.records?.length!==1||archive.records[0]?.workspaceUid!==ATTACHMENT_INDEX_WORKSPACE)throw Error('请选择附件索引密钥备份')
 const keys=repository(ownerId)
 try{await keys.restoreArchive(archive,async()=>{captured.assert();return{secret,kind}});captured.assert();await unlockAttachmentIndexProtection(ownerId,secret,kind,signal);captured.assert()}finally{await keys.close()}
}

export async function changeAttachmentIndexPassword(ownerId:string,secret:string,newPassword:string,kind:'password'|'recovery',signal?:AbortSignal){
 const captured=binding(ownerId,signal);captured.assert();const keys=repository(ownerId),operationUid=crypto.randomUUID()
 try{
  const record=await keys.read(ATTACHMENT_INDEX_WORKSPACE);captured.assert();if(!record)throw Error('索引密钥不存在')
  const envelope=await changeWorkspacePassword(record.envelope,ATTACHMENT_INDEX_WORKSPACE,secret,newPassword,kind);captured.assert()
  await keys.replace(envelope,newPassword,record.revision,operationUid);captured.assert()
  notifyWorkspaceKeyChange(captured.scope)
  await unlockAttachmentIndexProtection(ownerId,newPassword,'password',signal);captured.assert()
 }finally{await keys.close()}
}
