import {openDB} from 'idb'
import {localDateKey} from '../reviews/reviewWorkbench'
import {blobDigest} from './blobDigest'
import {quickLogPeriodKey,quickLogPeriodDay,type NoteEntity} from '@note-flow/core'
export type LogCaptureInput=Partial<NoteEntity>&{uid:string;title:string;content:string}
export interface LogCaptureJournal {schema:1;scope:string;operationUid:string;input:LogCaptureInput;text:string;files:{uid:string;name:string;type:string;lastModified:number;blob:Blob}[];createdAt:string;committed?:boolean}
const database=()=>openDB('note-flow-log-capture-recovery',1,{upgrade(db){db.createObjectStore('captures',{keyPath:'scope'})}})
export class LogCaptureValidationError extends Error{}
const validUid=(value:unknown)=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value)
function assertLogCaptureHeader(value:unknown,scope:string):asserts value is LogCaptureJournal{
 const row=value as LogCaptureJournal,input=row?.input
 const validDay=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&localDateKey(new Date(`${value}T12:00:00`))===value
 const fields=new Set(['uid','title','content','type','status','organizationStatus','captureSource','projectUid','areaUid','periodKey'])
 if(!row||row.schema!==1||row.scope!==scope||typeof scope!=='string'||!scope||!validUid(row.operationUid)||!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!fields.has(key))||!validUid(input.uid)||typeof input.title!=='string'||!input.title.trim()||typeof input.content!=='string'||input.type!=='work_log'||!['quick_log_work','quick_log_diary'].includes(String(input.captureSource))||input.status!==undefined&&input.status!=='active'||input.organizationStatus!==undefined&&input.organizationStatus!=='pending'||['projectUid','areaUid'].some(key=>input[key as 'projectUid'|'areaUid']!=null&&typeof input[key as 'projectUid'|'areaUid']!=='string')||['periodKey'].some(key=>input[key as 'periodKey']!=null&&(!validDay(quickLogPeriodDay(input[key as 'periodKey']))||(input.periodKey!==quickLogPeriodDay(input.periodKey)&&input.periodKey!==quickLogPeriodKey(quickLogPeriodDay(input.periodKey),input.uid))))||typeof row.text!=='string'||row.text.trim()!==input.content||!Array.isArray(row.files)||typeof row.createdAt!=='string'||!Number.isFinite(Date.parse(row.createdAt))||row.committed!==undefined&&typeof row.committed!=='boolean')throw new LogCaptureValidationError('日志恢复记录格式无效，未执行提交')
}
export function assertLogCaptureJournal(value:unknown,scope:string):asserts value is LogCaptureJournal{
 assertLogCaptureHeader(value,scope)
 const uids=new Set<string>()
 for(const file of value.files){if(!file||!validUid(file.uid)||uids.has(file.uid)||typeof file.name!=='string'||typeof file.type!=='string'||!Number.isFinite(file.lastModified)||!(file.blob instanceof Blob)||!file.blob.size)throw new LogCaptureValidationError('日志恢复附件格式无效，未执行提交');uids.add(file.uid)}
}

export function prepareLogCapture(scope:string,input:LogCaptureInput,text:string,files:File[]):LogCaptureJournal{
 const now=new Date(),day=localDateKey(now)
 return {schema:1,scope,operationUid:crypto.randomUUID(),input:JSON.parse(JSON.stringify({periodKey:quickLogPeriodKey(day,input.uid),...input})),text,files:files.map(file=>({uid:crypto.randomUUID(),name:file.name,type:file.type,lastModified:file.lastModified,blob:file.slice()})),createdAt:now.toISOString()}
}
export async function readLogCapture(scope:string):Promise<LogCaptureJournal|undefined>{const db=await database();try{const row=await db.get('captures',scope);if(row!==undefined)assertLogCaptureJournal(row,scope);return row}finally{db.close()}}
/** Persist all selected bytes before creating any note. Never replace an older unfinished operation. */
export async function saveLogCapture(row:LogCaptureJournal){assertLogCaptureJournal(row,row.scope);const db=await database();try{const tx=db.transaction('captures','readwrite');if(await tx.store.get(row.scope)){await tx.done;throw Error('已有未完成日志，请先恢复或放弃')}await tx.store.add(row);await tx.done}finally{db.close()}}
export async function clearLogCapture(scope:string,operationUid:string){const db=await database();try{const tx=db.transaction('captures','readwrite'),row=await tx.store.get(scope) as LogCaptureJournal|undefined;if(row?.operationUid===operationUid)await tx.store.delete(scope);await tx.done}finally{db.close()}}
export async function clearLogCaptureOwner(scope:string){const db=await database();try{const tx=db.transaction('captures','readwrite');let cursor=await tx.store.openCursor();while(cursor){if(cursor.value.scope===scope||cursor.value.scope.startsWith(scope+':reset:'))await cursor.delete();cursor=await cursor.continue()}await tx.done}finally{db.close()}}
export function recoveredLogFiles(row:LogCaptureJournal){assertLogCaptureJournal(row,row.scope);return row.files.map(file=>new File([file.blob],file.name,{type:file.type,lastModified:file.lastModified}))}
/** A recovered commit is accepted only if it still represents the original capture. */
export async function recoverLogNote(row:LogCaptureJournal,service:{get(uid:string):Promise<NoteEntity|undefined>;create(input:LogCaptureInput,options?:{ifAbsent?:boolean}):Promise<NoteEntity>},assertCurrent:()=>void){
 assertLogCaptureJournal(row,row.scope)
 const verify=(note:NoteEntity)=>{if(note.uid!==row.input.uid||note.deleted||(['periodKey'] as const).some(key=>row.input[key]!=null&&quickLogPeriodDay(note[key])!==quickLogPeriodDay(row.input[key]))||(['title','content','captureSource','projectUid','areaUid','type'] as const).some(key=>(note[key]??null)!==(row.input[key]??null)))throw Error('已保存日志已被修改或删除，请检查原记录后处理附件');return note}
 assertCurrent();const existing=await service.get(row.input.uid);assertCurrent();if(existing)return verify(existing)
 if(row.committed)throw Error('原日志已不存在，已停止恢复以避免重新创建已删除记录')
 try{const note=await service.create(row.input,{ifAbsent:true});assertCurrent();return verify(note)}catch(error){assertCurrent();const committed=await service.get(row.input.uid);assertCurrent();if(committed)return verify(committed);throw error}
}

export async function markLogCaptureCommitted(scope:string,operationUid:string){const db=await database();try{const tx=db.transaction('captures','readwrite'),row=await tx.store.get(scope) as LogCaptureJournal|undefined;if(!row||row.operationUid!==operationUid){await tx.done;throw Error('日志恢复记录已改变，已停止写入')}await tx.store.put({...row,committed:true});await tx.done}finally{db.close()}}
export interface LogCaptureArchive {schema:'note-flow-log-capture/1';scope:string;captures:(Omit<LogCaptureJournal,'files'>&{files:{uid:string;name:string;type:string;lastModified:number;base64:string;sha256:string;sizeBytes:number}[]})[]}
const encodeBytes=(bytes:Uint8Array)=>{let result='';for(let index=0;index<bytes.length;index+=0x8000)result+=String.fromCharCode(...bytes.subarray(index,index+0x8000));return btoa(result)}
export async function exportLogCaptureArchive(scope:string):Promise<LogCaptureArchive>{
 const row=await readLogCapture(scope);if(!row)return {schema:'note-flow-log-capture/1',scope,captures:[]}
 const files=[]
 for(const file of row.files){const bytes=new Uint8Array(await file.blob.arrayBuffer());files.push({uid:file.uid,name:file.name,type:file.type,lastModified:file.lastModified,base64:encodeBytes(bytes),sha256:await blobDigest(file.blob),sizeBytes:bytes.length})}
 return {schema:'note-flow-log-capture/1',scope,captures:[{...row,files}]}
}
export async function validateLogCaptureArchive(source:unknown,scope:string):Promise<LogCaptureJournal[]>{
 const archive=source as LogCaptureArchive
 if(!archive||archive.schema!=='note-flow-log-capture/1'||archive.scope!==scope||!Array.isArray(archive.captures)||archive.captures.length>1)throw Error('日志恢复备份属于其他空间或格式无效')
 const rows:LogCaptureJournal[]=[]
 for(const row of archive.captures){
  assertLogCaptureHeader(row,scope)
  const files:LogCaptureJournal['files']=[],uids=new Set<string>()
  for(const file of row.files){
   if(!file||typeof file.uid!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(file.uid)||uids.has(file.uid)||typeof file.name!=='string'||typeof file.type!=='string'||!Number.isFinite(file.lastModified)||!Number.isSafeInteger(file.sizeBytes)||file.sizeBytes<=0||typeof file.base64!=='string'||typeof file.sha256!=='string'||!file.sha256.match(/^[a-f0-9]{64}$/)||!file.base64.match(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/))throw Error('日志恢复附件格式无效')
   uids.add(file.uid)
   const blob=new Blob([Uint8Array.from(atob(file.base64),value=>value.charCodeAt(0))],{type:file.type})
   if(blob.size!==file.sizeBytes||await blobDigest(blob)!==file.sha256)throw Error('日志恢复附件校验失败')
   files.push({uid:file.uid,name:file.name,type:file.type,lastModified:file.lastModified,blob})
  }
  rows.push({...row,files})
 }
 return rows
}
export async function restoreLogCaptureArchive(source:unknown,scope:string){const rows=await validateLogCaptureArchive(source,scope);if(!rows.length)return;const db=await database();try{const tx=db.transaction('captures','readwrite');if(!await tx.store.get(scope))await tx.store.add(rows[0]);await tx.done}finally{db.close()}}

export async function clearLogCaptureScope(scope:string){const db=await database();try{await db.delete('captures',scope)}finally{db.close()}}

/** Explicit repair only: never erase a valid record created by another tab. */
export async function clearInvalidLogCapture(scope:string){
 const db=await database()
 try{const tx=db.transaction('captures','readwrite'),row=await tx.store.get(scope);if(row===undefined){await tx.done;return true}let invalid=false
  try{assertLogCaptureJournal(row,scope)}catch(error){if(!(error instanceof LogCaptureValidationError))throw error;invalid=true}
  if(!invalid){await tx.done;return false}
  await tx.store.delete(scope);await tx.done;return true
 }finally{db.close()}
}
