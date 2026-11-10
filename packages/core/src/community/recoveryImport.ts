import type {CoreContext,LocalBackupHost,LocalWorkspaceSnapshot} from '../contracts/provider'
import {validateCoreContext,CoreProviderError} from './compatibility'
import {decodeSyncRecoveryArchive,RecoveryArchiveError} from './recoveryArchive'

const entityStores:Readonly<Record<string,string>>={
 notes:'note',tasks:'task',folders:'folder',tags:'tag',note_tags:'note_tag',note_links:'note_link',
 local_folders:'folder',local_tags:'tag',local_note_tags:'note_tag',
 local_attachments:'attachment',attachments:'attachment',recordings:'recording',
 task_lists:'task_list',task_tags:'task_tag',task_notes:'task_note',areas:'area',projects:'project',
 journal_series:'journal_series',project_logs:'project_log',focus_sessions:'focus_session',journal_sources:'journal_source',canvases:'canvas',
}
const object=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value)
const invalid=(message:string):never=>{throw new RecoveryArchiveError('ARCHIVE_INVALID',message)}
export interface RecoveryImportPreview {
 snapshot:LocalWorkspaceSnapshot
 summary:{entities:number;deleted:number;preservedStores:string[];warnings:string[]}
}
/** Materialize local entities only. Original operations/cursors remain inert in the exact source archive. */
export function prepareRecoveryArchiveImport(serialized:string,context:CoreContext):RecoveryImportPreview {
 validateCoreContext(context)
 const decoded=decodeSyncRecoveryArchive(serialized),archive=decoded.archive
 const tables=archive.tables,stores=archive.stores
 if(tables&&stores)invalid('恢复档案同时包含两种存储，无法确定实体来源')
 const source=tables||stores
 if(!source)throw new CoreProviderError('RECOVERY_REQUIRED','此操作档案没有完整实体快照，请保留档案并使用官方恢复工具')
 const now=new Date().toISOString()
 const snapshot:LocalWorkspaceSnapshot={schema:'note-flow-community-workspace',version:1,exportedAt:now,profileId:context.profileId,entities:[],changes:[]}
 const seen=new Set<string>(),preservedStores:string[]=[],warnings:string[]=[]
 for(const [store,rows] of Object.entries(source)){
  const entityType=Object.hasOwn(entityStores,store)?entityStores[store]:undefined
  if(!entityType){preservedStores.push(store);continue}
  for(const row of rows){
   if(!object(row))invalid(`恢复档案 ${store} 包含无效记录`)
   let value:unknown=row
   if(tables){
    if(typeof row.entity_json!=='string')invalid(`恢复档案 ${store} 缺少完整实体 JSON`)
    try{value=JSON.parse(row.entity_json)}catch{invalid(`恢复档案 ${store} 实体 JSON 损坏`)}
   }
   if(!object(value))return invalid(`恢复档案 ${store} 实体格式无效`)
   const uid=value.uid??row.uid
   if(typeof uid!=='string'||!uid.trim())return invalid(`恢复档案 ${store} 缺少稳定 UID`)
   if(value.uid!==undefined&&row.uid!==undefined&&value.uid!==row.uid)invalid(`恢复档案 ${store} 实体 UID 不一致`)
   const key=JSON.stringify([entityType,uid])
   if(seen.has(key))invalid(`恢复档案 ${store} 实体重复`)
   seen.add(key)
   const entity={...value,uid},deleted=value.deleted===true||value.deleted===1||row.deleted===1||entityType==='attachment'&&(value.status==='deleted'||row.sync_status==='deleted')
   const revision=crypto.randomUUID()
   snapshot.entities.push({entityType,entityUid:uid,revision,deleted,value:entity})
   snapshot.changes.push({entityType,entityUid:uid,changeId:crypto.randomUUID(),profileId:context.profileId,action:deleted?'delete':'create',afterRevision:revision,createdAt:now,entity:structuredClone(entity),sequence:snapshot.changes.length+1})
  }
 }
 const archiveValue={uid:archive.id,kind:decoded.kind,serialized,importedAt:now}
 const revision=crypto.randomUUID()
 snapshot.entities.push({entityType:'recovery_archive',entityUid:archive.id,revision,deleted:false,value:archiveValue})
 snapshot.changes.push({entityType:'recovery_archive',entityUid:archive.id,changeId:crypto.randomUUID(),profileId:context.profileId,action:'create',afterRevision:revision,createdAt:now,entity:archiveValue,sequence:snapshot.changes.length+1})
 if(preservedStores.length)warnings.push('部分记录仅保存在原始档案中。旧同步操作不会自动上传。')
 warnings.push('此档案可能不包含附件文件。请另行备份和迁移附件，以免导入后无法打开。')
 return {snapshot,summary:{entities:seen.size,deleted:snapshot.entities.filter(row=>row.deleted).length,preservedStores,warnings}}
}
/** Uses the host's atomic empty-profile restore; concurrent writes fail instead of being overwritten. */
export async function importRecoveryArchive(host:LocalBackupHost,context:CoreContext,serialized:string){
 const prepared=prepareRecoveryArchiveImport(serialized,context)
 await host.restoreWorkspace(context,prepared.snapshot)
 return prepared.summary
}

export interface RecoveryMediaFile {
 entityType:'attachment'|'recording'
 entityUid:string
 blob:Blob
}
/** Match explicit entity identities and archive hashes; never read paths or fetch URLs from an archive. */
export async function prepareRecoveryArchiveImportWithMedia(serialized:string,context:CoreContext,files:readonly RecoveryMediaFile[]){
 const prepared=prepareRecoveryArchiveImport(serialized,context),seen=new Set<string>()
 for(const file of files){
  if(!['attachment','recording'].includes(file.entityType)||typeof file.entityUid!=='string'||!(file.blob instanceof Blob))throw new CoreProviderError('INVALID_CHANGE','附件文件无效')
  const key=JSON.stringify([file.entityType,file.entityUid])
  if(seen.has(key))throw new CoreProviderError('INVALID_CHANGE','同一附件被重复提供')
  seen.add(key)
  const row=prepared.snapshot.entities.find(row=>row.entityType===file.entityType&&row.entityUid===file.entityUid)
  if(!row)throw new CoreProviderError('INVALID_CHANGE','附件不属于此恢复档案')
  const expected=row.value.sha256
  if(typeof expected!=='string'||! /^[a-f0-9]{64}$/i.test(expected))throw new CoreProviderError('RECOVERY_REQUIRED','档案缺少有效的附件校验信息，请将文件另行导入')
  const digest=await crypto.subtle.digest('SHA-256',await file.blob.arrayBuffer())
  const actual=[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('')
  if(actual!==expected.toLowerCase())throw new CoreProviderError('INVALID_CHANGE','附件内容与恢复档案不一致')
  const size=row.value.sizeBytes??row.value.fileSize??row.value.size
  if(size!==undefined&&(!Number.isSafeInteger(size)||Number(size)!==file.blob.size))throw new CoreProviderError('INVALID_CHANGE','附件大小与恢复档案不一致')
  row.value={...row.value,blob:file.blob}
  const change=prepared.snapshot.changes.find(change=>change.entityType===row.entityType&&change.entityUid===row.entityUid)
  if(change)change.entity=structuredClone(row.value)
 }
 const mediaRows=prepared.snapshot.entities.filter(row=>['attachment','recording'].includes(row.entityType))
 return {...prepared,media:{attached:files.length,missing:mediaRows.filter(row=>!row.deleted&&!(row.value.blob instanceof Blob)).map(row=>({entityType:row.entityType,entityUid:row.entityUid}))}}
}
export async function importRecoveryArchiveWithMedia(host:LocalBackupHost,context:CoreContext,serialized:string,files:readonly RecoveryMediaFile[]){
 const prepared=await prepareRecoveryArchiveImportWithMedia(serialized,context,files)
 await host.restoreWorkspace(context,prepared.snapshot)
 return {...prepared.summary,media:prepared.media}
}
