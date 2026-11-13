import {reviewDraftStore,reviewDraftRows,clearReviewDraftRows} from './reviewDraftStore'
import {exportReviewRecovery,preserveReviewRecovery,validateReviewRecovery,type ReviewRecovery} from './reviewRecoveryArchive'
import {openDB} from 'idb'
import {blobDigest} from './blobDigest'
export interface ConsolidationDraft {key:string;scope:string;sourceHash:string;title:string;content:string;folderUid:string;mode:string;instruction:string;ready:boolean;operationUid:string;request?:Record<string,unknown>;updatedAt:string}
export interface ConsolidationDraftArchive {schema:'note-flow-consolidation-drafts/1';scope:string;drafts:ConsolidationDraft[];archives?:ReviewRecovery[]}
const database=()=>openDB('note-flow-consolidation-drafts',1,{upgrade(db){db.createObjectStore('drafts',{keyPath:'key'}).createIndex('scope','scope')}})
export async function consolidationSourceHash(stamps:string[]){return blobDigest(new Blob([JSON.stringify([...stamps].sort())]))}
const snapshot=async(scope:string)=>{const db=await database();try{const tx=db.transaction('drafts','readonly'),[total,indexed,rows]=await Promise.all([tx.store.count(),tx.store.index('scope').count(),tx.store.index('scope').getAll(scope)]);await tx.done;if(total!==indexed)throw Error('整合稿索引不完整，原始数据已保留');return rows as ConsolidationDraft[]}finally{db.close()}}
function validateRow(scope:string,value:ConsolidationDraft){validateConsolidationDraftArchive({schema:'note-flow-consolidation-drafts/1',scope,drafts:[value]},scope)}
/** 以排序后的来源UID绑定草稿；从列表清理时传expected，防止清除审阅后已被其他窗口更新的请求。 */
export function createConsolidationDrafts(scope:string,sourceUids:string[],expected?:ConsolidationDraft){
 const key=JSON.stringify([scope,[...sourceUids].sort()]),store=reviewDraftStore('consolidation',scope,key,database,()=>snapshot(scope),row=>validateRow(scope,row),expected?{value:expected}:undefined)
 return {read:store.read,async save(value:Omit<ConsolidationDraft,'key'|'scope'|'updatedAt'>){await store.save({...value,key,scope,updatedAt:new Date().toISOString()})},clear:store.clear}
}
async function repository(scope:string,staged=false){return reviewDraftRows('consolidation',scope,database,()=>snapshot(scope),row=>validateRow(scope,row),staged)}
export async function clearConsolidationDrafts(scope:string){await clearReviewDraftRows(await repository(scope),database,scope)}
/** 显式抹除本机空间时清理该账号全部重置世代，不触碰相似名称的账号。 */
export async function clearConsolidationDraftOwner(scope:string){await clearReviewDraftRows(await repository(scope),database,scope,true)}

export async function listConsolidationDrafts(scope:string):Promise<ConsolidationDraft[]>{return(await(await repository(scope)).rows()).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))}
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
 if(value.archives!==undefined){if(!Array.isArray(value.archives))throw Error('整合稿恢复档案格式无效');for(const archive of value.archives){validateReviewRecovery(archive);if(archive.kind!=='consolidation')throw Error('整合稿恢复档案类型无效');validateConsolidationDraftArchive({schema:value.schema,scope:archive.scope,drafts:archive.drafts},archive.scope)}}
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
 const drafts=await(await repository(scope)).rows(),archives=await exportReviewRecovery(scope,'consolidation')
 const archive:ConsolidationDraftArchive={schema:'note-flow-consolidation-drafts/1',scope,drafts,...(archives.length?{archives}:{})};validateConsolidationDraftArchive(archive,scope);return archive
}
/** 恢复补缺失可编辑稿；原待确认请求仅保留惰性档案，不向旧请求重新授予执行资格。 */
export async function restoreConsolidationDraftArchive(source:unknown,scope:string,staged=false){
 validateConsolidationDraftArchive(source,scope)
 const value:ConsolidationDraftArchive=JSON.parse(JSON.stringify(source)),port=await repository(scope,staged)
 await preserveReviewRecovery(scope,[{kind:'consolidation',scope:value.scope,drafts:value.drafts},...(value.archives||[])],staged);port.check()
 await port.restore(value.drafts.map(row=>{const {request:_request,...draft}=row;return {...draft,operationUid:'',ready:row.operationUid?false:row.ready}}))
}
