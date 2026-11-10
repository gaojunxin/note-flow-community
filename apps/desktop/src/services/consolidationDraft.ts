import {openDB} from 'idb'
import {blobDigest} from './blobDigest'
export interface ConsolidationDraft {key:string;scope:string;sourceHash:string;title:string;content:string;folderUid:string;mode:string;instruction:string;ready:boolean;operationUid:string;request?:Record<string,unknown>;updatedAt:string}
export interface ConsolidationDraftArchive {schema:'note-flow-consolidation-drafts/1';scope:string;drafts:ConsolidationDraft[]}
const database=()=>openDB('note-flow-consolidation-drafts',1,{upgrade(db){db.createObjectStore('drafts',{keyPath:'key'}).createIndex('scope','scope')}})
export async function consolidationSourceHash(stamps:string[]){return blobDigest(new Blob([JSON.stringify([...stamps].sort())]))}
export function createConsolidationDrafts(scope:string,sourceUids:string[]){
 const key=JSON.stringify([scope,[...sourceUids].sort()])
 return {
  async read():Promise<ConsolidationDraft|undefined>{const db=await database();try{return await db.get('drafts',key)}finally{db.close()}},
  async save(value:Omit<ConsolidationDraft,'key'|'scope'|'updatedAt'>){const db=await database();try{await db.put('drafts',{...value,key,scope,updatedAt:new Date().toISOString()})}finally{db.close()}},
  async clear(){const db=await database();try{await db.delete('drafts',key)}finally{db.close()}}
 }
}
export async function clearConsolidationDrafts(scope:string){const db=await database();try{const tx=db.transaction('drafts','readwrite');for(const key of await tx.store.index('scope').getAllKeys(scope))await tx.store.delete(key);await tx.done}finally{db.close()}}

/** Clear all reset generations for an account when its local workspace is erased. */
export async function clearConsolidationDraftOwner(scope:string){const db=await database();try{const tx=db.transaction('drafts','readwrite');let cursor=await tx.store.openCursor();while(cursor){if(cursor.value.scope===scope||cursor.value.scope.startsWith(scope+':reset:'))await cursor.delete();cursor=await cursor.continue()}await tx.done}finally{db.close()}}

export async function listConsolidationDrafts(scope:string):Promise<ConsolidationDraft[]>{const db=await database();try{return (await db.getAllFromIndex('drafts','scope',scope)).filter(row=>typeof row.title==='string'&&typeof row.content==='string'&&typeof row.key==='string'&&row.scope===scope).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))}finally{db.close()}}
export function consolidationDraftSources(value:ConsolidationDraft){let key:unknown;try{key=JSON.parse(value.key)}catch{throw Error('本机整合稿标识无效')}if(!Array.isArray(key)||key[0]!==value.scope||!Array.isArray(key[1])||key[1].length<2||key[1].length>20||key[1].some(uid=>typeof uid!=='string'||!uid)||new Set(key[1]).size!==key[1].length)throw Error('本机整合稿来源标识无效');return key[1] as string[]}

export function consolidationPendingRequest(row:ConsolidationDraft):Record<string,unknown>{
 const request=row.request,expected=consolidationDraftSources(row),draft=request?.draft as {title?:string;content?:string;folderUid?:string|null}|undefined
 if(!row.operationUid||!request||request.uid!==row.operationUid||!Array.isArray(request.sources)||!draft||draft.title!==row.title.trim()||draft.content!==row.content||String(draft.folderUid||'')!==row.folderUid)throw Error('待确认请求不完整或与整合稿不一致，请保留本机稿并检查服务器整合记录')
 const actual=request.sources.map(source=>source?.uid)
 if(actual.length!==expected.length||new Set(actual).size!==actual.length||actual.some(uid=>!expected.includes(uid)))throw Error('待确认请求的来源标识不一致，已停止提交')
 return request
}

export function validateConsolidationDraftArchive(source:unknown,scope:string):asserts source is ConsolidationDraftArchive {
 const value=source as ConsolidationDraftArchive
 if(!value||value.schema!=='note-flow-consolidation-drafts/1'||value.scope!==scope||!Array.isArray(value.drafts))throw Error('整合稿备份属于其他账号或重置世代，未恢复')
 const keys=new Set<string>()
 for(const row of value.drafts){
  if(!row||row.scope!==scope||['key','sourceHash','title','content','folderUid','mode','instruction','operationUid','updatedAt'].some(key=>typeof row[key as keyof ConsolidationDraft]!=='string')||typeof row.ready!=='boolean'||!Number.isFinite(Date.parse(row.updatedAt))||keys.has(row.key))throw Error('整合稿备份格式无效')
  const sources=consolidationDraftSources(row)
  if(row.key!==JSON.stringify([scope,[...sources].sort()]))throw Error('整合稿备份标识无效')
  if(row.operationUid)consolidationPendingRequest(row)
  else if(row.request!==undefined)throw Error('整合稿备份包含无操作标识的提交请求')
  keys.add(row.key)
 }
}
export async function exportConsolidationDraftArchive(scope:string):Promise<ConsolidationDraftArchive>{
 const db=await database()
 try{const archive:ConsolidationDraftArchive={schema:'note-flow-consolidation-drafts/1',scope,drafts:await db.getAllFromIndex('drafts','scope',scope)};validateConsolidationDraftArchive(archive,scope);return archive}finally{db.close()}
}
/** Restore missing drafts only. Never overwrite a newer local review or submit. */
export async function restoreConsolidationDraftArchive(source:unknown,scope:string){
 validateConsolidationDraftArchive(source,scope)
 const db=await database()
 try{const tx=db.transaction('drafts','readwrite');for(const row of source.drafts)if(!await tx.store.get(row.key))await tx.store.add(row);await tx.done}finally{db.close()}
}
