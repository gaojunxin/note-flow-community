import type {SyncOperationStatus} from './contracts/sync'
export type SyncIssueKind='rejected'|'conflict'|'unconfirmed'|'retryable'|'unknown'
/** Persisted aliases are mapped at the boundary, without rewriting old queues. */
export function normalizeSyncOperationStatus(value:unknown):SyncOperationStatus|'unknown'{
 if(value==='failed')return 'permanent_failed'
 return typeof value==='string'&&['pending','pushing','retry_wait','conflict','permanent_failed'].includes(String(value))?value as SyncOperationStatus:'unknown'
}
/** A known rejection outranks sent=true; sent alone never proves acceptance. */
export function classifySyncIssue(value:{status?:unknown;resultStatus?:unknown;sent?:unknown}):SyncIssueKind|null{
 const status=normalizeSyncOperationStatus(value.status),result=value.resultStatus
 if(status==='permanent_failed'||result==='permanent_error')return 'rejected'
 if(status==='conflict'||result==='conflict')return 'conflict'
 if(result==='retryable_error'||result==='transient_error'||status==='retry_wait')return 'retryable'
 if(result==='applied')return null
 if(result!==undefined&&(typeof result!=='string'||!['retryable_error','transient_error'].includes(result)))return 'unknown'
 if(value.sent!==undefined&&typeof value.sent!=='boolean')return 'unknown'
 if(status==='pushing')return null
 if(status==='pending')return value.sent===true?'unconfirmed':null
 return 'unknown'
}
/** Visual feedback for one command; succeeded does not assert global convergence. */
export interface SyncActionFeedback {state:'running'|'succeeded'|'failed';message:string}

export interface SyncQueueCounts {
 waiting:number;inFlight:number;rejected:number;unconfirmed:number;retryable:number;unknown:number;conflicts:number
}
/** Count durable queue rows, independently of which domain records a page has loaded. */
export function inspectSyncQueue(operations:ReadonlyArray<Record<string,unknown>>,conflicts:ReadonlyArray<Record<string,unknown>>=[]):SyncQueueCounts{
 const counts:SyncQueueCounts={waiting:0,inFlight:0,rejected:0,unconfirmed:0,retryable:0,unknown:0,conflicts:0}
 const conflictKeys=new Set<string>()
 operations.forEach((operation,index)=>{
  const kind=classifySyncIssue(operation)
  if(kind==='conflict')conflictKeys.add(typeof operation.operationId==='string'?`op:${operation.operationId}`:`row:${index}`)
  else if(kind)counts[kind]++
  else if(normalizeSyncOperationStatus(operation.status)==='pushing'||operation.inFlight===true)counts.inFlight++
  else counts.waiting++
 })
 conflicts.forEach((conflict,index)=>conflictKeys.add(typeof conflict.operationId==='string'?`op:${conflict.operationId}`:typeof conflict.conflictId==='string'?`conflict:${conflict.conflictId}`:`orphan:${index}`))
 counts.conflicts=conflictKeys.size
 return counts
}
export interface SyncRecoveryRecord {source?:'archive'|'command'|'batch';id:string;createdAt:string;label:string;detail:string;operationId?:string;replacementOperationId?:string}
const recoveryLabels:Record<string,{label:string;detail:string}>={
 'confirm-sync-operation':{label:'已发起上传结果确认',detail:'使用原请求标识确认结果；确认完成前不会丢弃原请求。'},
 'retry-failed-task':{label:'任务已重新提交',detail:'本机已建立新的上传请求；服务器是否接受请查看当前队列。'},
 'retry-failed-operation':{label:'内容已重新提交',detail:'本机已建立新的上传请求；服务器是否接受请查看当前队列。'},
 'discard-failed-task':{label:'已丢弃任务的本机修改',detail:'本机恢复处理已提交，原记录已归档。'},
 'resolve-task-conflict-local':{label:'冲突已选择保留本机版本',detail:'已建立新的上传请求；不代表服务器已接受该版本。'},
}
/** Project only receipt metadata. Raw archives can contain complete private business records. */
export function syncRecoveryRecord(value:Record<string,unknown>):SyncRecoveryRecord|null{
 if(value.reason==='sync-command'&&value.command&&typeof value.command==='object')return syncCommandRecord(value.command as Record<string,unknown>,'')
 if(typeof value.reason!=='string'||!Object.hasOwn(recoveryLabels,value.reason)||typeof value.id!=='string'||typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt)))return null
 const label=recoveryLabels[value.reason]!
 const identifier=(key:string)=>typeof value[key]==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value[key] as string)?value[key] as string:undefined
 return {source:'archive',id:value.id,createdAt:new Date(value.createdAt).toISOString(),...label,operationId:identifier('operationId'),replacementOperationId:identifier('replacementOperationId')}
}

/** Durable command receipts are distinct from server upload acknowledgements. */
export function syncCommandRecord(value:Record<string,unknown>,runtimeId:string):SyncRecoveryRecord|null{
 const kinds:Record<string,string>={retry:'重新提交或确认上传',discard:'丢弃本机修改','use-local':'保留本机版本','use-server':'采用服务器版本','keep-both':'保留两个版本'}
 if(typeof value.kind!=='string'||!Object.hasOwn(kinds,value.kind)||typeof value.id!=='string'||typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt)))return null
 const status=value.status==='running'&&value.runtimeId!==runtimeId?'interrupted':value.status
 const results:Record<string,string>={running:'正在处理',succeeded:'本机处理已提交',failed:'处理失败，本机修改仍需检查',interrupted:'处理结果待核对，请重新检查队列',no_change:'未发现需要变更的记录'}
 if(typeof status!=='string'||!Object.hasOwn(results,status))return null
 if(value.batch&&typeof value.batch==='object'){
  const items=(value.batch as {items?:unknown}).items
  if(!Array.isArray(items)||items.some(item=>!item||typeof item!=='object'||!['waiting','running','succeeded','failed','interrupted'].includes(item.status)))return null
  const succeeded=items.filter(item=>item.status==='succeeded').length,failed=items.filter(item=>item.status==='failed').length,uncertain=items.filter(item=>item.status==='interrupted'||item.status==='running').length,waiting=items.filter(item=>item.status==='waiting').length
  return {source:'batch',id:value.id,createdAt:new Date(value.createdAt).toISOString(),label:`批量${kinds[value.kind]} · ${results[status]}`,detail:`共 ${items.length} 项：本机已处理 ${succeeded} 项，失败 ${failed} 项，结果待核对 ${uncertain} 项，未开始 ${waiting} 项。服务器是否接受请查看当前队列；不会自动重放本批次。`}
 }
 const code=typeof value.code==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(value.code)?value.code:''
 const target=typeof value.targetId==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value.targetId)?value.targetId:undefined
 return {source:'command',id:value.id,createdAt:new Date(value.createdAt).toISOString(),label:`${kinds[value.kind]} · ${results[status]}`,detail:`${status==='succeeded'?'该本机操作已完成；服务器是否接受请查看当前队列。':status==='running'?'请等待本次处理结束。':'请核对当前队列后决定下一步，不会自动丢弃或重新提交。'}${code?` 错误代码：${code}`:''}`,...(value.kind==='retry'||value.kind==='discard'?{operationId:target}:{})}
}

const bodyRecoveryCodes=new Set(['CRDT_BASE_MISMATCH','CRDT_STATE_MISMATCH','CRDT_UPDATE_INVALID'])
export function requiresBodyRecovery(operation:Record<string,unknown>){return operation.entityType==='note_body_update'&&bodyRecoveryCodes.has(String(operation.lastError||''))}

export interface SyncQueueSource {
 key:string;label:string;state:'checked'|'disabled'|'local_only'|'unavailable';counts:SyncQueueCounts;detail:string;route:string
}

/** Confirmation snapshots preserve values and array order while ignoring object key order. */
export function syncConflictStamp(value:unknown):string{
 const normalize=(input:unknown):unknown=>Array.isArray(input)?input.map(normalize):input&&typeof input==='object'?Object.fromEntries(Object.entries(input).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,child])=>[key,normalize(child)])):input
 return JSON.stringify(normalize(value))
}

/** Prefer a durable command outcome to its before-action archive, without hiding older unrelated history. */
export function mergeSyncRecoveryRecords(records:SyncRecoveryRecord[],limit=50){
 const targets=new Set(records.filter(record=>record.source==='command'&&record.operationId).map(record=>record.operationId))
 const unique=new Map<string,SyncRecoveryRecord>()
 for(const record of records){if(record.source==='archive'&&targets.has(record.operationId))continue;if(!unique.has(record.id))unique.set(record.id,record)}
 return [...unique.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,Math.max(0,Math.min(100,limit)))
}
