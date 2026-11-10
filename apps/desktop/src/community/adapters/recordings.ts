import {createEntity,listEntities,getEntityRecord,removeEntity,attachRevision} from '../runtime'
export interface RecordingEntity {id?:number;uid:string;noteUid?:string|null;attachmentUid?:string|null;name?:string;durationMs?:number;fileSize?:number;createdAt?:string;localPath?:string;sha256?:string;syncStatus?:string}
type StoredRecording=RecordingEntity&{blob:Blob;mediaType:string;sha256:string;fileSize:number}
async function digest(blob:Blob){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('')}
export const recordingsService={
 async list():Promise<RecordingEntity[]>{return(await listEntities<StoredRecording>('recording')).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)))},
 async content(record:RecordingEntity):Promise<Blob>{const row=await getEntityRecord<StoredRecording>('recording',record.uid);if(!row||!(row.entity.blob instanceof Blob))throw Error('本地录音内容缺失');if(row.entity.blob.size!==row.entity.fileSize||await digest(row.entity.blob)!==row.entity.sha256)throw Error('本地录音校验失败');return row.entity.blob},
 async upload(file:File,noteUid?:string,durationMs=0):Promise<RecordingEntity>{if(!file.size)throw Error('录音文件为空');if(!Number.isFinite(durationMs)||durationMs<0)throw Error('录音时长无效');return createEntity<StoredRecording>('recording',{uid:crypto.randomUUID(),name:file.name||'录音',noteUid:noteUid||null,durationMs,fileSize:file.size,mediaType:file.type||'audio/webm',blob:file,sha256:await digest(file),syncStatus:'local'})},
 async remove(record:RecordingEntity){const row=await getEntityRecord<StoredRecording>('recording',record.uid);if(!row)throw Error('本地录音不存在');await removeEntity('recording',attachRevision({...row.entity,blob:undefined},row.revision))}
}
