import {digest as sha256} from 'lib0/hash/sha256'
import {protectedAttachmentSearch} from './attachmentIndexProtection'
import {extractLocalAttachmentText,ATTACHMENT_TEXT_MAX_BYTES} from '@note-flow/core/attachment-text'
import {extractLocalDocxText,DOCX_TEXT_MAX_BYTES} from './docxAttachmentText'
import {extractLocalPdfText,PDF_TEXT_MAX_BYTES} from './pdfAttachmentText'
import {normalizeSearchQuery} from '@note-flow/core/search'
import {localSearchAttachmentSources,readLocalAiAttachment,type AttachmentItem,type LocalAttachment} from './attachments'
import {clientOwnerScope} from './clientContext'
import {accountLifecycleRevision} from './accountStorage'
import {appLock} from './appLock'

export interface AttachmentContentHit {item:AttachmentItem;summary:string}
let lockRevision=0
interface Continuation {owner:string;query:string;lifecycle:number;lock:number;encrypted:boolean;offset:number;fingerprint:string;expires:number}
const continuations=new Map<string,Continuation>()
if(typeof window!=='undefined'&&typeof window.addEventListener==='function'){
 window.addEventListener('note-flow:app-locked',()=>{lockRevision++;continuations.clear()})
 window.addEventListener('note-flow:attachment-cache-change',event=>{const scope=(event as CustomEvent).detail?.scope;for(const [token,value] of continuations)if(value.owner===scope)continuations.delete(token)})
 for(const event of ['note-flow:account-lifecycle-change','note-flow:account-data-reset','pagehide'])window.addEventListener(event,()=>continuations.clear())
}
const snapshot=(rows:LocalAttachment[])=>Array.from(sha256(new TextEncoder().encode(JSON.stringify(rows.map(identity)))),value=>value.toString(16).padStart(2,'0')).join('')
const identity=(row:LocalAttachment)=>JSON.stringify([row.uid,row.sha256,row.sizeBytes,row.updatedAt,row.localPath,row.status,row.noteUid,row.taskUid,row.name,row.mediaType,row.serverUid])
/** Explicit local scan; no downloads, models or persistent plaintext copies. */
export async function searchLocalAttachmentContent(ownerId:string,rawQuery:string,signal?:AbortSignal,options:{useEncryptedIndex?:boolean;cursor?:string}={}){
 const owner=clientOwnerScope(ownerId),lifecycle=accountLifecycleRevision(),lock=lockRevision,query=normalizeSearchQuery(rawQuery)
 const assertCurrent=()=>{if(signal?.aborted)throw new DOMException('已取消附件搜索','AbortError');if(appLock.locked.value||lock!==lockRevision||owner!==clientOwnerScope(ownerId)||lifecycle!==accountLifecycleRevision())throw Error('账号、空间或锁定状态已变化，请重新搜索')}
 assertCurrent()
 const hits:AttachmentContentHit[]=[],observed=new Map<string,string>()
 let skipped=0,total=0,bytes=0,scanned=0,indexed=0,indexWriteFailures=0
 if(!query)return{hits,total,scanned,skipped,indexed,indexWriteFailures,limited:false,nextCursor:undefined as string|undefined,checkedThrough:0,sourceCount:0}
 const continuation=options.cursor?continuations.get(options.cursor):undefined
 if(options.cursor&&(!continuation||continuation.expires<Date.now()||continuation.owner!==owner||continuation.query!==query||continuation.lifecycle!==lifecycle||continuation.lock!==lock||continuation.encrypted!==Boolean(options.useEncryptedIndex)))throw Error('续查已过期或查询状态变化，请重新搜索')
 const protectedIndex=options.useEncryptedIndex?await protectedAttachmentSearch(ownerId,signal):undefined
 try{
 const source=(await localSearchAttachmentSources(ownerId)).sort((a,b)=>a.uid.localeCompare(b.uid));assertCurrent()
 const fingerprint=snapshot(source)
 if(continuation&&continuation.fingerprint!==fingerprint)throw Error('附件已变化，请重新搜索')
 const deadline=performance.now()+30000
 const start=continuation?.offset||0
 let position=start
 for(;position<source.length&&position<start+2000;position++){
  const row=source[position]
  assertCurrent()
  if(performance.now()>=deadline)break
  const pdf=/\.pdf$/i.test(row.name)&&(!row.mediaType||['application/pdf','application/octet-stream'].includes(row.mediaType.split(';')[0].trim().toLowerCase()))
  const docx=/\.docx$/i.test(row.name)&&(!row.mediaType||['application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/octet-stream'].includes(row.mediaType.split(';')[0].trim().toLowerCase()))
  if(!/\.(txt|md|markdown|csv|json|pdf|docx)$/i.test(row.name)||row.sizeBytes>(pdf?PDF_TEXT_MAX_BYTES:docx?DOCX_TEXT_MAX_BYTES:ATTACHMENT_TEXT_MAX_BYTES)||!Number.isSafeInteger(row.sizeBytes)||row.sizeBytes<0||!/^[a-f0-9]{64}$/i.test(row.sha256)){skipped++;continue}
  if(bytes+row.sizeBytes>32*1024*1024)break
  bytes+=row.sizeBytes
  const item:AttachmentItem={uid:row.uid,noteUid:row.noteUid,taskUid:row.taskUid,version:0,originalFilename:row.name,mediaType:row.mediaType,sizeBytes:row.sizeBytes,sha256:row.sha256,contentUrl:row.contentUrl||`local-media:${row.uid}`}
  try{
   const extractorVersion=docx?301:pdf?201:101,cached=await protectedIndex?.read(row,extractorVersion)
   let result
   if(cached?.text!==undefined){indexed++;result={state:'ready' as const,text:cached.text,searchText:cached.searchText!}}
   else{
   const blob=await readLocalAiAttachment(ownerId,item);assertCurrent()
   result=docx?await extractLocalDocxText(blob,signal):pdf?await extractLocalPdfText(blob,signal):await extractLocalAttachmentText(blob,{name:row.name,mediaType:row.mediaType},signal);assertCurrent()
   if(result.state!=='ready'){skipped++;continue}
   if(protectedIndex){try{await protectedIndex.put(row,extractorVersion,result.text,cached?.revision||0)}catch{assertCurrent();await protectedIndex.finish();let winner;try{winner=await protectedIndex.read(row,extractorVersion)}catch{await protectedIndex.finish()}if(winner?.text!==result.text)indexWriteFailures++}}
   }
   assertCurrent()
   scanned++;observed.set(row.uid,identity(row))
   if(result.searchText.includes(query)){
    total++
    hits.push({item,summary:result.text.slice(0,240)})
    if(hits.length>=50){position++;break}
   }
  }catch{assertCurrent();await protectedIndex?.finish();skipped++}
 }
 const current=await localSearchAttachmentSources(ownerId);assertCurrent()
 const identities=new Map(current.map(row=>[row.uid,identity(row)]))
 if(snapshot([...current].sort((a,b)=>a.uid.localeCompare(b.uid)))!==fingerprint)throw Error('附件已变化，请重新搜索')
 if([...observed].some(([uid,value])=>identities.get(uid)!==value))throw Error('附件已变化，请重新搜索')
 await protectedIndex?.finish()
 const limited=position<source.length
 let nextCursor:string|undefined
 if(limited){
  nextCursor=crypto.randomUUID()
  continuations.set(nextCursor,{owner,query,lifecycle,lock,encrypted:Boolean(options.useEncryptedIndex),offset:position,fingerprint,expires:Date.now()+10*60*1000})
  for(const [token,value] of continuations)if(value.expires<Date.now())continuations.delete(token)
  while(continuations.size>16)continuations.delete(continuations.keys().next().value!)
 }
 return{hits,total,scanned,skipped,indexed,indexWriteFailures,limited,nextCursor,checkedThrough:position,sourceCount:source.length}
 }finally{await protectedIndex?.close()}
}
