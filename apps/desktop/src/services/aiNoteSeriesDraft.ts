import {openDB} from 'idb'
import {reviewDraftStore,reviewDraftRows,clearReviewDraftRows} from './reviewDraftStore'
import {exportReviewRecovery,preserveReviewRecovery,validateReviewRecovery,type ReviewRecovery} from './reviewRecoveryArchive'
import type {NoteSeries,SeriesProgress,SeriesScope} from './aiNoteSeries'
import type {FolderEntity} from './folders'
export interface SeriesDraft {key:string;scope:string;sessionUid:string;plan:NoteSeries;target:SeriesScope;base?:FolderEntity;progress:SeriesProgress;allowSameTitle:boolean;instruction:string;updatedAt:string}
export interface SeriesDraftArchive {schema:'note-flow-series-drafts/1';scope:string;drafts:SeriesDraft[];archives?:ReviewRecovery[]}
const database=()=>openDB('note-flow-ai-series',1,{upgrade(db){db.createObjectStore('drafts',{keyPath:'key'})}})
const snapshot=async(scope:string)=>{const db=await database();try{const prefix=JSON.stringify([scope]).slice(0,-1)+',';return await db.getAll('drafts',IDBKeyRange.bound(prefix,prefix+'\uffff')) as SeriesDraft[]}finally{db.close()}}
/** 持久化校验保留用户尚未完成的标题/正文编辑，不调用会生成新UID的模型输出解析器。 */
export function validateSeriesDraft(value:unknown,scope:string):asserts value is SeriesDraft{
 const row=value as SeriesDraft
 if(!row||row.scope!==scope||typeof row.sessionUid!=='string'||!row.sessionUid||row.key!==JSON.stringify([scope,row.sessionUid])||typeof row.instruction!=='string'||typeof row.allowSameTitle!=='boolean'||!Number.isFinite(Date.parse(row.updatedAt))||!row.target||![row.target.areaUid,row.target.projectUid].every(value=>value===null||typeof value==='string')||!row.plan||typeof row.plan.assessment!=='string'||!Array.isArray(row.plan.folders)||row.plan.folders.length>40||!Array.isArray(row.plan.notes)||!row.plan.notes.length||row.plan.notes.length>30||!row.progress||typeof row.progress.started!=='boolean'||!row.progress.folders||Array.isArray(row.progress.folders)||!Array.isArray(row.progress.notes))throw Error('系列草稿格式无效，原始数据已保留')
 const keys=new Set<string>(),notes=new Set<string>(),uids=new Set<string>()
 for(const folder of row.plan.folders){if(!folder||typeof folder.key!=='string'||!folder.key||keys.has(folder.key)||typeof folder.name!=='string'||folder.parentKey!==null&&typeof folder.parentKey!=='string')throw Error('系列目录标识无效');keys.add(folder.key)}
 for(const folder of row.plan.folders){const visited=new Set<string>();let next:typeof folder|undefined=folder;while(next){if(visited.has(next.key)||visited.size>=8)throw Error('系列目录层级无效');visited.add(next.key);if(next.parentKey===null)break;next=row.plan.folders.find(value=>value.key===next!.parentKey);if(!next)throw Error('系列父目录缺失')}}
 for(const note of row.plan.notes){if(!note||typeof note.key!=='string'||!note.key||notes.has(note.key)||typeof note.uid!=='string'||!note.uid||uids.has(note.uid)||typeof note.title!=='string'||typeof note.content!=='string'||typeof note.selected!=='boolean'||note.folderKey!==null&&!keys.has(note.folderKey))throw Error('系列笔记身份或内容无效');notes.add(note.key);uids.add(note.uid)}
 if(Object.entries(row.progress.folders).some(([key,uid])=>!keys.has(key)||typeof uid!=='string'||!uid)||row.progress.notes.some(uid=>typeof uid!=='string'||!uids.has(uid))||new Set(row.progress.notes).size!==row.progress.notes.length||!row.progress.started&&(row.progress.notes.length||Object.keys(row.progress.folders).length))throw Error('系列创建进度无效，不能重新生成结果身份')
 if(row.base&&(!row.base.uid||typeof row.base.uid!=='string'||typeof row.base.name!=='string'))throw Error('系列保存起点无效')
}
function repository(scope:string,staged=false){return reviewDraftRows('series',scope,database,()=>snapshot(scope),row=>validateSeriesDraft(row,scope),staged)}
/** 可编辑草稿和固定创建进度共用一个比较基线；调用方须等待save完成再执行笔记副作用。 */
export function seriesDraftStore(scope:string,sessionUid:string){
 const key=JSON.stringify([scope,sessionUid]),store=reviewDraftStore('series',scope,key,database,()=>snapshot(scope),row=>validateSeriesDraft(row,scope))
 return{read:store.read,save:(value:Omit<SeriesDraft,'key'|'scope'|'sessionUid'|'updatedAt'>)=>store.save({...value,key,scope,sessionUid,updatedAt:new Date().toISOString()}),clear:store.clear}
}
export function validateSeriesDraftArchive(source:unknown,scope:string):asserts source is SeriesDraftArchive{
 const value=source as SeriesDraftArchive
 if(!value||value.schema!=='note-flow-series-drafts/1'||value.scope!==scope||!Array.isArray(value.drafts)||value.drafts.length>20000)throw Error('系列草稿备份空间或格式无效')
 const keys=new Set<string>();for(const row of value.drafts){validateSeriesDraft(row,scope);if(keys.has(row.key))throw Error('系列草稿标识重复');keys.add(row.key)}
 if(value.archives!==undefined){if(!Array.isArray(value.archives))throw Error('系列恢复档案格式无效');for(const archive of value.archives){validateReviewRecovery(archive);if(archive.kind!=='series')throw Error('系列恢复档案类型无效');validateSeriesDraftArchive({schema:value.schema,scope:archive.scope,drafts:archive.drafts},archive.scope)}}
}
export async function exportSeriesDraftArchive(scope:string):Promise<SeriesDraftArchive>{const drafts=await(await repository(scope)).rows(),archives=await exportReviewRecovery(scope,'series');return{schema:'note-flow-series-drafts/1',scope,drafts,...(archives.length?{archives}:{})}}
/** 只补未开始执行的可编辑稿；部分创建的计划仅归档，不能重新创建已完成或已删除结果。 */
export async function restoreSeriesDraftArchive(source:unknown,scope:string,staged=false){
 validateSeriesDraftArchive(source,scope);const value:SeriesDraftArchive=JSON.parse(JSON.stringify(source)),port=await repository(scope,staged)
 await preserveReviewRecovery(scope,[{kind:'series',scope:value.scope,drafts:value.drafts},...(value.archives||[])],staged);port.check()
 await port.restore(value.drafts.filter(row=>!row.progress.started))
}

/** 显式抹除账号空间时删除全部系列草稿世代，不能影响名称相似的其他账号。 */
export async function clearSeriesDraftOwner(scope:string){await clearReviewDraftRows(await repository(scope),database,scope,true)}
