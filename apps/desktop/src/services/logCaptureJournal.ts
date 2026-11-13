import {logCaptureStorage} from './logCaptureStorage'
import {localDateKey} from '../reviews/reviewWorkbench'
import {blobDigest} from './blobDigest'
import {quickLogPeriodKey,quickLogPeriodDay,type NoteEntity} from '@note-flow/core'
export type LogCaptureInput=Partial<NoteEntity>&{uid:string;title:string;content:string}
export interface LogCaptureJournal {schema:1;scope:string;operationUid:string;input:LogCaptureInput;text:string;files:{uid:string;name:string;type:string;lastModified:number;blob:Blob}[];createdAt:string;committed?:boolean}
const storage=(scope:string,staged=false,noMigration=false)=>logCaptureStorage(scope,assertLogCaptureJournal,staged,noMigration)
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
export async function readLogCapture(scope:string):Promise<LogCaptureJournal|undefined>{const row=await(await storage(scope)).read();if(row!==undefined)assertLogCaptureJournal(row,scope);return row}
/** 笔记副作用前先提交全部附件及元数据，不能覆盖另一条未完成操作。 */
export async function saveLogCapture(row:LogCaptureJournal){assertLogCaptureJournal(row,row.scope);return(await storage(row.scope)).save(row)}
export async function clearLogCapture(scope:string,operationUid:string){return(await storage(scope)).clear(operationUid)}
/** 显式抹除涵盖旧重置世代；先保留原生退役标记，旧IDB不能再次成为活跃来源。 */
export async function clearLogCaptureOwner(scope:string){const port=await storage(scope,false,true);for(const item of [...new Set([scope,...await port.scopes()])]){port.check();await(await storage(item,false,true)).erase()}}
export function recoveredLogFiles(row:LogCaptureJournal){assertLogCaptureJournal(row,row.scope);return row.files.map(file=>new File([file.blob],file.name,{type:file.type,lastModified:file.lastModified}))}
/** 恢复只接受仍代表原采集内容的笔记；已确认提交后缺失不能自动重建。 */
export async function recoverLogNote(row:LogCaptureJournal,service:{get(uid:string):Promise<NoteEntity|undefined>;create(input:LogCaptureInput,options?:{ifAbsent?:boolean}):Promise<NoteEntity>},assertCurrent:()=>void){
 assertLogCaptureJournal(row,row.scope)
 const verify=(note:NoteEntity)=>{if(note.uid!==row.input.uid||note.deleted||(['periodKey'] as const).some(key=>row.input[key]!=null&&quickLogPeriodDay(note[key])!==quickLogPeriodDay(row.input[key]))||(['title','content','captureSource','projectUid','areaUid','type'] as const).some(key=>(note[key]??null)!==(row.input[key]??null)))throw Error('已保存日志已被修改或删除，请检查原记录后处理附件');return note}
 assertCurrent();const existing=await service.get(row.input.uid);assertCurrent();if(existing)return verify(existing)
 if(row.committed)throw Error('原日志已不存在，已停止恢复以避免重新创建已删除记录')
 try{const note=await service.create(row.input,{ifAbsent:true});assertCurrent();return verify(note)}catch(error){assertCurrent();const committed=await service.get(row.input.uid);assertCurrent();if(committed)return verify(committed);throw error}
}

export async function markLogCaptureCommitted(scope:string,operationUid:string){return(await storage(scope)).mark(operationUid)}
type ArchivedCapture=Omit<LogCaptureJournal,'files'>&{files:{uid:string;name:string;type:string;lastModified:number;base64:string;sha256:string;sizeBytes:number}[]}
export interface LogCaptureArchive {schema:'note-flow-log-capture/1';scope:string;captures:ArchivedCapture[];archives?:ArchivedCapture[]}
const encodeBytes=(bytes:Uint8Array)=>{let result='';for(let index=0;index<bytes.length;index+=0x8000)result+=String.fromCharCode(...bytes.subarray(index,index+0x8000));return btoa(result)}
/** 导出同时保全活跃恢复点和旧惰性档案，附件摘要验证失败则整体失败。 */
export async function exportLogCaptureArchive(scope:string):Promise<LogCaptureArchive>{
 const port=await storage(scope),row=await port.read(),archived=await port.archives()
 const encode=async(row:LogCaptureJournal):Promise<ArchivedCapture>=>{assertLogCaptureJournal(row,scope);const files=[];for(const file of row.files){port.check();const bytes=new Uint8Array(await file.blob.arrayBuffer());files.push({uid:file.uid,name:file.name,type:file.type,lastModified:file.lastModified,base64:encodeBytes(bytes),sha256:await blobDigest(file.blob),sizeBytes:bytes.length})}port.check();return{...row,files}}
 const captures=row?[await encode(row)]:[],archives=await Promise.all(archived.map(encode));port.check();return {schema:'note-flow-log-capture/1',scope,captures,...(archives.length?{archives}:{})}
}
export async function validateLogCaptureArchive(source:unknown,scope:string):Promise<LogCaptureJournal[]>{
 const archive=source as LogCaptureArchive
 if(!archive||archive.schema!=='note-flow-log-capture/1'||archive.scope!==scope||!Array.isArray(archive.captures)||archive.captures.length>1||archive.archives!==undefined&&(!Array.isArray(archive.archives)||archive.archives.length>20000))throw Error('日志恢复备份属于其他空间或格式无效')
 const rows:LogCaptureJournal[]=[]
 for(const row of [...archive.captures,...(archive.archives??[])]){
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
/** 恢复只保全原始操作与字节，不激活旧采集身份、不重新创建笔记或附件队列。 */
export async function restoreLogCaptureArchive(source:unknown,scope:string,staged=false){const rows=await validateLogCaptureArchive(source,scope);if(!rows.length)return;return(await storage(scope,staged)).archive(rows)}

export async function clearLogCaptureScope(scope:string){return(await storage(scope,false,true)).erase()}

/** 仅显式修复格式坏行；事务中重新校验，不能删除另一窗口刚保存的有效记录。 */
export async function clearInvalidLogCapture(scope:string){return(await storage(scope,false,true)).repairInvalid()}
