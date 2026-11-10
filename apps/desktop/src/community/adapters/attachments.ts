import {notifyAttachmentChange} from '../../services/attachmentChanges'
import {clientOwnerScope} from '../../services/clientContext'
import {blobDigest} from '../../services/blobDigest'
import type {AttachmentItem,AttachmentReference,LibraryAttachment,AttachmentLibraryPage,AttachmentLibrarySummary,LocalAttachment as BaseLocalAttachment} from '../../../../../packages/core/src/contracts/attachments'
import {createEntity,listEntities,getEntityRecord,updateEntity,removeEntity,attachRevision,communityUnavailable,communityProfileId} from '../runtime'
import {exportCommunityFile} from '../fileExport'
export type {AttachmentItem,AttachmentReference,LibraryAttachment,AttachmentLibraryPage,AttachmentLibrarySummary} from '../../../../../packages/core/src/contracts/attachments'
export type AttachmentUploadStatus=BaseLocalAttachment['status']|'local'
export type LocalAttachment=Omit<BaseLocalAttachment,'status'>&{status:AttachmentUploadStatus;knowledgeUid?:string}
type StoredAttachment=LocalAttachment&{blob:Blob;version?:number}
async function rows(){const values=await listEntities<StoredAttachment>('attachment');return Promise.all(values.map(async value=>({...value,name:value.name||'附件',mediaType:value.mediaType||value.blob?.type||'application/octet-stream',sizeBytes:value.sizeBytes??value.blob?.size??0,sha256:value.sha256||(value.blob instanceof Blob?await digest(value.blob):''),noteUid:value.noteUid,status:'local' as const,createdAt:value.createdAt||'',updatedAt:value.updatedAt||value.createdAt||''})))}
const digest=blobDigest
function toItem(value:StoredAttachment):LibraryAttachment{const references:AttachmentReference[]=[];if(value.noteUid)references.push({kind:'note',uid:value.noteUid,noteUid:value.noteUid});if(value.taskUid)references.push({kind:'task',uid:value.taskUid,taskUid:value.taskUid});if(value.knowledgeUid)references.push({kind:'knowledge',uid:value.knowledgeUid,knowledgeUid:value.knowledgeUid});return{uid:value.uid,noteUid:value.noteUid,taskUid:value.taskUid,knowledgeUid:value.knowledgeUid,version:Number(value.version||0),originalFilename:value.name,mediaType:value.mediaType,sizeBytes:value.sizeBytes,sha256:value.sha256,uploadState:'local',contentUrl:`attachment:${value.uid}`,role:value.mediaType.startsWith('image/')?'image':value.mediaType.startsWith('audio/')?'audio':'file',createdAt:value.createdAt,updatedAt:value.updatedAt,references,referenceCount:references.length}}
async function save(file:Blob,name:string,scope:{noteUid?:string;taskUid?:string;knowledgeUid?:string}={},operationUid?:string):Promise<StoredAttachment>{
 if(!file.size)throw Error('请选择有效附件');const owner=communityProfileId(),assertCurrent=()=>{if(owner!==communityProfileId())throw Error('本地空间已变化，附件未继续写入')},uid=operationUid||crypto.randomUUID(),sha256=await digest(file);assertCurrent()
 const verify=async(row:Awaited<ReturnType<typeof getEntityRecord<StoredAttachment>>>)=>{
  if(!row||row.deleted||row.entity.noteUid!==scope.noteUid||row.entity.taskUid!==scope.taskUid||row.entity.knowledgeUid!==scope.knowledgeUid||row.entity.name!==(name||'附件')||row.entity.sha256!==sha256||!(row.entity.blob instanceof Blob)||row.entity.blob.size!==file.size||await digest(row.entity.blob)!==sha256)throw Error('附件操作标识已用于其他内容或已删除，未覆盖原文件')
  assertCurrent();return attachRevision(row.entity,row.revision)
 }
 if(operationUid){const old=await getEntityRecord<StoredAttachment>('attachment',uid,true);assertCurrent();if(old)return verify(old)}
 const now=new Date().toISOString();try{const saved=await createEntity<StoredAttachment>('attachment',{uid,...scope,name:name||'附件',mediaType:file.type||'application/octet-stream',sizeBytes:file.size,sha256,blob:file,status:'local',attempts:0,createdAt:now,updatedAt:now});assertCurrent();return saved}
 catch(error){assertCurrent();if(!operationUid)throw error;const existing=await getEntityRecord<StoredAttachment>('attachment',uid,true);assertCurrent();if(!existing)throw error;return verify(existing)}
}
export async function queueAttachment(_ownerId:string,noteUid:string,file:File,operationUid?:string){return save(file,file.name,{noteUid},operationUid)}
export async function queueTaskAttachment(_ownerId:string,taskUid:string,file:File){return save(file,file.name,{taskUid})}
export async function uploadAttachment(noteUid:string,file:Blob,name='attachment'){return toItem(await save(file,name,{noteUid}))}
export async function uploadTaskAttachment(taskUid:string,file:Blob,name='attachment'){return toItem(await save(file,name,{taskUid}))}
export async function uploadKnowledgeAttachment(_knowledgeUid:string,_file:Blob,_name='attachment'):Promise<AttachmentItem>{throw Error('知识附件管理属于高级版本功能')}
export async function localAttachments(_ownerId:string,noteUid?:string){return(await rows()).filter(v=>noteUid===undefined||v.noteUid===noteUid)}
export async function localTaskAttachments(_ownerId:string,taskUid:string){return(await rows()).filter(v=>v.taskUid===taskUid)}
export async function listAttachments(noteUid:string){return(await rows()).filter(v=>v.noteUid===noteUid).map(toItem)}
export async function listTaskAttachments(taskUid:string){return(await rows()).filter(v=>v.taskUid===taskUid).map(toItem)}
export async function listKnowledgeAttachments(knowledgeUid:string,_options?:unknown){return(await rows()).filter(v=>v.knowledgeUid===knowledgeUid).map(toItem)}
async function unlink(field:'noteUid'|'taskUid'|'knowledgeUid',uid:string,item:AttachmentItem){const row=await getEntityRecord<StoredAttachment>('attachment',item.uid);if(!row)throw Error('本地附件不存在');if(row.entity[field]!==uid)return;await updateEntity('attachment',attachRevision(row.entity,row.revision),{[field]:undefined})}
export const unlinkAttachment=(uid:string,item:AttachmentItem)=>unlink('noteUid',uid,item)
export const unlinkTaskAttachment=(uid:string,item:AttachmentItem)=>unlink('taskUid',uid,item)
export const unlinkKnowledgeAttachment=async(_uid:string,_item:AttachmentItem):Promise<void>=>{throw Error('知识附件管理属于高级版本功能')}
export async function deleteAttachment(item:Pick<AttachmentItem,'uid'>,_ownerId?:string){const row=await getEntityRecord<StoredAttachment>('attachment',item.uid);if(!row)throw Error('本地附件不存在');await removeEntity('attachment',attachRevision({...row.entity,blob:undefined},row.revision));notifyAttachmentChange(clientOwnerScope(_ownerId||'local'))}
export const removeLocalAttachment=(_ownerId:string,uid:string)=>deleteAttachment({uid},_ownerId)
export async function retryLocalAttachment(_ownerId:string,_uid:string):Promise<never>{return communityUnavailable('附件上传')}
export async function hasPendingNoteAttachments(_ownerId:string){return false}
export async function processAttachmentQueue(_ownerId:string,_options:{noteReady:(uid:string)=>boolean;replaceReference:(noteUid:string,from:string,to:string,serverUid?:string)=>Promise<void>}):Promise<{uploaded:number;failed:number}>{return communityUnavailable('附件上传')}
export async function processTaskAttachmentQueue(_ownerId:string,_taskReady:(uid:string)=>boolean):Promise<never>{return communityUnavailable('附件上传')}
export async function cachedAttachment(_ownerId:string,item:AttachmentItem,options:{signal?:AbortSignal;onDownloadProgress?:(event:any)=>void;onState?:(value:{source:string;persistent:boolean;pinned:boolean})=>void}={}):Promise<Blob>{const row=await getEntityRecord<StoredAttachment>('attachment',item.uid);if(!row||!(row.entity.blob instanceof Blob))throw Error('本地附件内容缺失');if((row.entity.sizeBytes!==undefined&&row.entity.blob.size!==row.entity.sizeBytes)||(row.entity.sha256&&await digest(row.entity.blob)!==row.entity.sha256))throw Error('本地附件校验失败');if(options.signal?.aborted)throw new DOMException('读取已取消','AbortError');options.onState?.({source:'local',persistent:true,pinned:true});return row.entity.blob}
export async function openAttachmentContent(ownerId:string,item:AttachmentItem){if(!await exportCommunityFile(await cachedAttachment(ownerId,item),item.originalFilename||'附件'))throw Error('已取消附件导出')}
export function isOfficeAttachment(item:Pick<AttachmentItem,'originalFilename'|'mediaType'>){return /\.(docx?|docm|xlsx?|xlsm|xlsb|pptx?|pptm|odt|ods|odp)$/i.test(item.originalFilename)||/(msword|officedocument|ms-excel|ms-powerpoint|opendocument)/i.test(item.mediaType||'')}
export async function attachmentLibrary(params:{q?:string;type?:string;referenceState?:string;noteUid?:string;sort?:string;page?:number;size?:number}={}):Promise<AttachmentLibraryPage>{let values=(await rows()).map(toItem);if(params.q)values=values.filter(v=>v.originalFilename.toLocaleLowerCase().includes(params.q!.toLocaleLowerCase()));if(params.type)values=values.filter(v=>v.role===params.type);if(params.referenceState==='orphan')values=values.filter(v=>!v.referenceCount);if(params.referenceState==='referenced')values=values.filter(v=>v.referenceCount>0);if(params.noteUid)values=values.filter(v=>v.noteUid===params.noteUid);values.sort((a,b)=>params.sort==='sizeDesc'?b.sizeBytes-a.sizeBytes:params.sort==='nameAsc'?a.originalFilename.localeCompare(b.originalFilename):params.sort==='oldest'?a.createdAt.localeCompare(b.createdAt):b.createdAt.localeCompare(a.createdAt));const page=Math.max(1,Math.floor(params.page||1)),size=Math.max(1,Math.floor(params.size||30));return{items:values.slice((page-1)*size,page*size),total:values.length,page,size,hasMore:page*size<values.length}}
export async function attachmentLibrarySummary():Promise<AttachmentLibrarySummary>{const v=(await rows()).map(toItem);return{total:v.length,images:v.filter(x=>x.role==='image').length,audio:v.filter(x=>x.role==='audio').length,files:v.filter(x=>x.role==='file').length,orphan:v.filter(x=>!x.referenceCount).length,totalBytes:v.reduce((a,b)=>a+b.sizeBytes,0)}}
export async function attachmentCacheUsage(_ownerId:string){return{total:(await rows()).reduce((a,b)=>a+b.sizeBytes,0),limit:Number((await navigator.storage?.estimate?.())?.quota||0)}}
export const trimAttachmentCache=attachmentCacheUsage // Local originals are never evicted as disposable cache.
// ZIP STORE records: local bytes and metadata, with CRC32 and no remote archive endpoint.
function crc32(bytes:Uint8Array){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return(crc^0xffffffff)>>>0}
function zip(files:{name:string;bytes:Uint8Array}[]){if(files.length>65535||files.some(file=>file.bytes.length>0xffffffff))throw Error('归档超过ZIP格式限制');const parts:Uint8Array[]=[],central:Uint8Array[]=[];let offset=0,centralSize=0;for(const file of files){const name=new TextEncoder().encode(file.name),crc=crc32(file.bytes),header=new Uint8Array(30+name.length),h=new DataView(header.buffer);h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint32(14,crc,true);h.setUint32(18,file.bytes.length,true);h.setUint32(22,file.bytes.length,true);h.setUint16(26,name.length,true);header.set(name,30);parts.push(header,file.bytes);const c=new Uint8Array(46+name.length),v=new DataView(c.buffer);v.setUint32(0,0x02014b50,true);v.setUint16(4,20,true);v.setUint16(6,20,true);v.setUint16(8,0x800,true);v.setUint32(16,crc,true);v.setUint32(20,file.bytes.length,true);v.setUint32(24,file.bytes.length,true);v.setUint16(28,name.length,true);v.setUint32(42,offset,true);c.set(name,46);central.push(c);centralSize+=c.length;offset+=header.length+file.bytes.length}const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);return new Blob([...parts,...central,end] as BlobPart[],{type:'application/zip'})}
async function archive(uids:string[],name:string,note?:unknown){const selected=(await rows()).filter(v=>uids.includes(v.uid));if(selected.length!==new Set(uids).size)throw Error('部分本地附件不存在，未导出不完整归档');const entries=await Promise.all(selected.map(async v=>({name:`attachments/${v.uid}/${v.name.replace(/[\\/:*?"<>|]/g,'_')}`,bytes:new Uint8Array(await(await cachedAttachment('',toItem(v))).arrayBuffer())})));entries.push({name:'manifest.json',bytes:new TextEncoder().encode(JSON.stringify({format:'note-flow-local-attachments/1',attachments:selected.map(v=>toItem(v)),...(note?{note}:{})},null,2))});if(!await exportCommunityFile(zip(entries),name))throw Error('已取消归档导出')}
export const exportAttachmentArchive=(uids:string[])=>archive(uids,'noteflow-local-attachments.zip')
export async function exportNoteArchive(noteUid:string,title:string){const note=await getEntityRecord('note',noteUid);if(!note)throw Error('本地笔记不存在');return archive((await rows()).filter(v=>v.noteUid===noteUid).map(v=>v.uid),`${(title||'笔记').replace(/[\\/:*?"<>|]/g,'_')}.zip`,note.entity)}

export const localAiAttachmentItems=async(_ownerId:string)=>(await attachmentLibrary({size:10000})).items
export const readLocalAiAttachment=cachedAttachment

// A local-only edition has no server deletion state.
export async function reconcileDeletedAttachments(){return 0}
export async function attachmentDiagnosticSource(ownerId:string,item:AttachmentItem,source:'local'|'remote'):Promise<{blob?:Blob;canReveal:boolean;canRedownload:boolean}>{
 if(source==='remote')return{canReveal:false,canRedownload:false}
 const row=await getEntityRecord<StoredAttachment>('attachment',item.uid)
 return{blob:row?.entity.blob,canReveal:false,canRedownload:false}
}
export async function redownloadAttachment(_ownerId:string,_item:AttachmentItem):Promise<void>{throw Error('当前为仅本机版本，没有服务器副本')}
export async function revealAttachmentFolder(_ownerId:string,_item:AttachmentItem):Promise<void>{throw Error('本机附件保存在独立空间中，请使用另存为')}

export async function attachmentCacheMetadata(_ownerId:string,uid:string){const row=await getEntityRecord<StoredAttachment>('attachment',uid);return row?{blob:row.entity.blob,sha256:row.entity.sha256}:undefined}

export async function requestWebTaskAttachmentRemoval(_ownerId:string,_taskUid:string,_item:AttachmentItem):Promise<void>{throw Error('此操作仅用于 Web 附件队列')}
export async function webTaskAttachmentRemovals(_ownerId:string,_taskUid:string):Promise<Array<Pick<BaseLocalAttachment,'uid'|'serverUid'|'relationUid'|'relationVersion'|'cancelledRelationVersion'|'localCancellation'>>>{return []}

export const requestTaskAttachmentRemoval=requestWebTaskAttachmentRemoval
export const taskAttachmentRemovals=webTaskAttachmentRemovals

export const localSearchAttachmentSources=localAttachments

/** 社区附件属于本机原始数据，不参与网络缓存清理。 */
export async function pinAttachmentCache(_ownerId:string,_item:AttachmentItem,_pinned:boolean){return true}
