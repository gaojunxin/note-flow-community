import type {CoreContext,LocalWorkspaceSnapshot} from '../contracts/provider'
import {CoreProviderError} from './compatibility'
import {prepareRecoveryArchiveImport} from './recoveryImport'
import {encodePortableValue,type PortableValue} from './portableValue'

export interface EditionTransfer {
 schema:'note-flow-edition-transfer'
 version:1
 transferId:string
 sourceProfileId:string
 sourceEpoch:string|null
 archive:string
 baseline:LocalWorkspaceSnapshot
 /** Exact transport-neutral media/extra backup. Queues remain inert in archive. */
 preserved:PortableValue
}
/** Called only after the official host has paused sync and captured its original transaction. */
export async function prepareEditionTransfer(input:{profileId:string;epoch:string|null;archive:string;preserved?:unknown},destination:CoreContext):Promise<EditionTransfer>{
 if(!input.profileId||input.profileId===destination.profileId)throw new CoreProviderError('INVALID_CONTEXT','请选择独立的社区空间')
 const baseline=prepareRecoveryArchiveImport(input.archive,destination).snapshot
 return{schema:'note-flow-edition-transfer',version:1,transferId:crypto.randomUUID(),sourceProfileId:input.profileId,sourceEpoch:input.epoch,archive:input.archive,baseline,preserved:await encodePortableValue(input.preserved??null)}
}
export function validateEditionTransfer(value:EditionTransfer,snapshot:LocalWorkspaceSnapshot){
 if(value?.schema!=='note-flow-edition-transfer'||value.version!==1||!value.transferId||!value.sourceProfileId||!value.baseline||snapshot?.schema!=='note-flow-community-workspace'||snapshot.version!==1||snapshot.profileId!==value.baseline.profileId)throw new CoreProviderError('INVALID_CHANGE','版本切换档案或空间不匹配')
 const original=prepareRecoveryArchiveImport(value.archive,{profileId:value.baseline.profileId,storageSchemaVersion:1}).snapshot
 const project=(rows:LocalWorkspaceSnapshot['entities'])=>rows.filter(row=>row.entityType!=='recovery_archive').map(row=>({entityType:row.entityType,entityUid:row.entityUid,deleted:row.deleted,value:row.value})).sort((a,b)=>JSON.stringify([a.entityType,a.entityUid]).localeCompare(JSON.stringify([b.entityType,b.entityUid])))
 if(JSON.stringify(project(original.entities))!==JSON.stringify(project(value.baseline.entities)))throw new CoreProviderError('INVALID_CHANGE','版本切换基线与原始档案不一致')
 const seen=new Set<string>()
 for(const row of snapshot.entities){const key=JSON.stringify([row.entityType,row.entityUid]);if(seen.has(key)||!row.entityType||!row.entityUid||row.value.uid!==row.entityUid)throw new CoreProviderError('INVALID_CHANGE','版本切换实体无效或重复');seen.add(key)}
 if(snapshot.changes.some(change=>change.profileId!==snapshot.profileId))throw new CoreProviderError('INVALID_CONTEXT','本地变更属于其他空间')
}

export interface EditionReturn {schema:'note-flow-edition-return';version:1;transfer:EditionTransfer;community:LocalWorkspaceSnapshot}
/** Restore once into an empty profile, including immutable transfer provenance and validated local media. */
export async function importEditionTransfer(host:import('../contracts/provider').LocalBackupHost,context:CoreContext,source:EditionTransfer){
 const {decodePortableValue}=await import('./portableValue')
 const {prepareRecoveryArchiveImportWithMedia}=await import('./recoveryImport')
 validateEditionTransfer(source,source.baseline)
 const transfer=structuredClone(source);transfer.baseline.profileId=context.profileId;for(const change of transfer.baseline.changes)change.profileId=context.profileId
 const contents=decodePortableValue(transfer.preserved),preserved=Array.isArray(contents)?contents:(contents as {media?:unknown})?.media,files:import('./recoveryImport').RecoveryMediaFile[]=[]
 if(Array.isArray(preserved))for(const item of preserved){if(!item||typeof item!=='object')throw new CoreProviderError('INVALID_CHANGE','媒体备份无效');const file=item as Record<string,unknown>;if(!['attachment','recording'].includes(String(file.entityType))||typeof file.entityUid!=='string'||!Array.isArray(file.bytes)||file.bytes.some(value=>!Number.isInteger(value)||Number(value)<0||Number(value)>255))throw new CoreProviderError('INVALID_CHANGE','媒体备份字节无效');files.push({entityType:file.entityType as 'attachment'|'recording',entityUid:file.entityUid,blob:new Blob([new Uint8Array(file.bytes as number[])])})}
 const prepared=await prepareRecoveryArchiveImportWithMedia(transfer.archive,context,files),snapshot=prepared.snapshot
 const uid=transfer.transferId,value={uid,transfer},revision=crypto.randomUUID()
 snapshot.entities.push({entityType:'edition_transfer',entityUid:uid,revision,deleted:false,value})
 snapshot.changes.push({entityType:'edition_transfer',entityUid:uid,profileId:context.profileId,changeId:crypto.randomUUID(),afterRevision:revision,action:'create',createdAt:new Date().toISOString(),entity:value,sequence:snapshot.changes.length+1})
 await host.restoreWorkspace(context,snapshot)
 return{transfer,summary:prepared.summary,media:prepared.media}
}
export function createEditionReturn(snapshot:LocalWorkspaceSnapshot):EditionReturn{
 const entries=snapshot.entities.filter(row=>row.entityType==='edition_transfer'&&!row.deleted)
 if(entries.length!==1)throw new CoreProviderError('RECOVERY_REQUIRED','此空间没有唯一官方版本切换来源，请保留普通备份')
 const transfer=entries[0].value.transfer as EditionTransfer
 validateEditionTransfer(transfer,snapshot)
 return{schema:'note-flow-edition-return',version:1,transfer:structuredClone(transfer),community:structuredClone(snapshot)}
}
export async function serializeEditionTransfer(value:EditionTransfer|EditionReturn){return JSON.stringify(await encodePortableValue(value))}
export async function decodeEditionTransferFile(serialized:string):Promise<EditionTransfer|EditionReturn>{
 const {decodePortableValue}=await import('./portableValue');let value:unknown
 try{value=decodePortableValue(JSON.parse(serialized))}catch{throw new CoreProviderError('INVALID_CHANGE','版本切换文件损坏')}
 const candidate=value as EditionTransfer|EditionReturn
 if(candidate?.schema==='note-flow-edition-transfer'){validateEditionTransfer(candidate,candidate.baseline);return candidate}
 if(candidate?.schema==='note-flow-edition-return'&&candidate.version===1){validateEditionTransfer(candidate.transfer,candidate.community);return candidate}
 throw new CoreProviderError('INVALID_CHANGE','不是版本切换文件')
}
