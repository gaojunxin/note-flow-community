import {clientIntentRepository,validateIntentRow,type IntentDomain,type IntentRow} from './clientIntentRepository'
import {businessOwner} from './businessRecord'
import {backupValueFingerprint} from './backupSnapshotConsistency'
interface IntentRecovery {version:1;scope:string;domain:IntentDomain;rows:IntentRow[]}
export interface ClientIntentArchive {version:1;scope:string;domains:Array<{domain:IntentDomain;rows:IntentRow[];archives:IntentRecovery[]}>}
function validateRecovery(source:unknown):asserts source is IntentRecovery{const v=source as IntentRecovery;if(!v||v.version!==1||typeof v.scope!=='string'||!v.scope||!['task-notes','reading'].includes(v.domain)||!Array.isArray(v.rows)||v.rows.some(row=>row.kind==='archive')||v.rows.length>20000||'archives' in v)throw Error('关联或阅读恢复档案格式无效');const ids=new Set<string>();for(const row of v.rows){validateIntentRow(v.domain,row);const id=JSON.stringify([row.kind,row.uid]);if(ids.has(id))throw Error('意图档案身份重复');ids.add(id)}}
export function validateClientIntentArchive(source:unknown):asserts source is ClientIntentArchive{
 const v=source as ClientIntentArchive;if(!v||v.version!==1||typeof v.scope!=='string'||!v.scope||!Array.isArray(v.domains)||v.domains.length!==2||new Set(v.domains.map(row=>row.domain)).size!==2)throw Error('关联/阅读备份格式无效')
 for(const part of v.domains){validateRecovery({version:1,scope:v.scope,domain:part.domain,rows:part.rows});if(!Array.isArray(part.archives))throw Error('意图恢复档案格式无效');for(const archive of part.archives){validateRecovery(archive);if(archive.domain!==part.domain)throw Error('意图恢复档案类型不符')}}
 if(new TextEncoder().encode(JSON.stringify(v)).length>64*1024*1024)throw Error('关联/阅读备份超过本机恢复上限')
}
/** 完整备份保全原关系UID、待确认请求、dirty和已观察基线，不调用远端服务。 */
export async function captureClientIntentArchive(owner=businessOwner(),stagedProfile?:string):Promise<ClientIntentArchive>{
 const domains:ClientIntentArchive['domains']=[],guards:Array<()=>void>=[];let scope=''
 for(const domain of ['task-notes','reading'] as const){guards.forEach(check=>check());const port=await clientIntentRepository(domain,owner,{stagedProfile});guards.push(port.check);if(scope&&scope!==port.profile)throw Error('备份空间已变化');scope=port.profile;const all=await port.rows();domains.push({domain,rows:all.filter(row=>row.kind!=='archive'),archives:all.filter(row=>row.kind==='archive').map(row=>row.value)})}
 guards.forEach(check=>check());const archive:ClientIntentArchive={version:1,scope,domains};validateClientIntentArchive(archive);return archive
}
/** 恢复只写平铺惰性档案，不能激活旧关联队列或将历史页码重新上传。 */
export async function restoreClientIntentArchive(source:unknown,owner=businessOwner(),stagedProfile?:string){
 validateClientIntentArchive(source);const archive:ClientIntentArchive=JSON.parse(JSON.stringify(source));let guard:()=>void=()=>{}
 for(const part of archive.domains){guard();const port=await clientIntentRepository(part.domain,owner,{stagedProfile});guard();guard=port.check;for(const recovery of [...(part.rows.length?[{version:1 as const,scope:archive.scope,domain:part.domain,rows:part.rows}]:[]),...part.archives]){validateRecovery(recovery);await port.invoke('archive',{uid:backupValueFingerprint(recovery),value:recovery})}}
}
