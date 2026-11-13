import {openDB} from 'idb'
import {blobDigest} from './blobDigest'
import {reviewDraftRows,clearReviewDraftRows} from './reviewDraftStore'
export interface ReviewRecovery {kind:'series'|'consolidation';scope:string;drafts:unknown[]}
interface ArchiveRow {key:string;scope:string;updatedAt:string;source:ReviewRecovery}
const database=()=>openDB('note-flow-review-recovery',1,{upgrade(db){db.createObjectStore('drafts',{keyPath:'key'}).createIndex('scope','scope')}})
function repository(scope:string,staged=false){const snapshot=async()=>{const db=await database();try{return await db.getAllFromIndex('drafts','scope',scope) as ArchiveRow[]}finally{db.close()}};return reviewDraftRows<ArchiveRow>('archives',scope,database,snapshot,row=>{if(!row||row.scope!==scope||typeof row.key!=='string'||!Number.isFinite(Date.parse(row.updatedAt)))throw Error('草稿恢复档案损坏');validateReviewRecovery(row.source)},staged)}
/** 惰性原始记录保留旧身份和执行证据，不能从这里直接取得活跃草稿。 */
export function validateReviewRecovery(value:unknown):asserts value is ReviewRecovery{const source=value as ReviewRecovery;if(!source||!['series','consolidation'].includes(source.kind)||typeof source.scope!=='string'||!source.scope||!Array.isArray(source.drafts)||source.drafts.length>20000||'archives' in source)throw Error('草稿恢复档案格式无效')}
export async function exportReviewRecovery(scope:string,kind:ReviewRecovery['kind']){return(await(await repository(scope)).rows()).map(row=>row.source).filter(row=>row.kind===kind)}
/** 内容摘要构成稳定档案身份；多次恢复同一备份不嵌套、不增长副本。 */
export async function preserveReviewRecovery(scope:string,sources:ReviewRecovery[],staged=false){
 const port=await repository(scope,staged),rows:ArchiveRow[]=[]
 for(const source of sources){validateReviewRecovery(source);const frozen=JSON.parse(JSON.stringify(source)),digest=await blobDigest(new Blob([JSON.stringify(frozen)]));port.check();rows.push({key:JSON.stringify([scope,digest]),scope,updatedAt:'1970-01-01T00:00:00.000Z',source:frozen})}
 await port.restore(rows)
}
/** 显式抹除本机账号空间同时清理惰性草稿档案；正常切换世代不调用此入口。 */
export async function clearReviewRecoveryOwner(scope:string){await clearReviewDraftRows(await repository(scope),database,scope,true)}
