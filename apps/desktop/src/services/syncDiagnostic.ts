import type {SyncQueueCounts,SyncQueueSource} from '@note-flow/core/sync-presentation'
import type {SyncTransportDay} from './syncTransportHealth'
interface QueueItem {syncStatus?:string;status?:string;updatedAt?:string;createdAt?:string}
/** Explicit allowlist: never spread a domain record or an exception into an export. */
export function buildSyncDiagnostic(input:{version:string;platform:'desktop'|'web';notes:QueueItem[];attachments:QueueItem[];failedTasks:number;failedChanges?:number;conflicts:number;transport:SyncTransportDay[];mainQueue?:SyncQueueCounts;queueSources?:SyncQueueSource[]},now=new Date()){
 const count=(values:QueueItem[],states:string[])=>values.filter(value=>states.includes(String(value.syncStatus||value.status))).length
 const safeCount=(value:number)=>Number.isSafeInteger(value)&&value>=0?value:0
 return {schema:'note-flow-sync-diagnostic/1',checkedAt:now.toISOString(),app:{version:input.version,platform:input.platform},loadedScopeOnly:true,
  ...(input.mainQueue?{mainQueue:{coverage:input.platform==='web'?'indexeddb-notes':'sqlite-main',waiting:safeCount(input.mainQueue.waiting),inFlight:safeCount(input.mainQueue.inFlight),rejected:safeCount(input.mainQueue.rejected),unconfirmed:safeCount(input.mainQueue.unconfirmed),retryable:safeCount(input.mainQueue.retryable),unknown:safeCount(input.mainQueue.unknown),conflicts:safeCount(input.mainQueue.conflicts)}}:{}),
  ...(input.queueSources?{independentQueues:input.queueSources.map(source=>({source:['task-note','knowledge','folder-transfer','vault','web-tasks','web-canvases','focus','recordings'].includes(source.key)?source.key:'other',state:['checked','disabled','local_only','unavailable'].includes(source.state)?source.state:'unavailable',waiting:safeCount(source.counts.waiting),inFlight:safeCount(source.counts.inFlight),rejected:safeCount(source.counts.rejected),unconfirmed:safeCount(source.counts.unconfirmed),retryable:safeCount(source.counts.retryable),unknown:safeCount(source.counts.unknown),conflicts:safeCount(source.counts.conflicts)}))}:{}),
  notes:{loaded:input.notes.length,pending:count(input.notes,['pending']),failed:count(input.notes,['failed']),conflicts:count(input.notes,['conflict'])},
  attachments:{known:input.attachments.length,pending:count(input.attachments,['pending','uploading','uploaded_needs_link']),failed:count(input.attachments,['failed'])},
  failedTasks:safeCount(input.failedTasks),failedChanges:safeCount(input.failedChanges||0),conflicts:safeCount(input.conflicts),
  transport:input.transport.map(row=>({day:row.day,stage:row.stage,requests:row.requests,failed:row.failed,partial:row.partial,conflicts:row.conflicts,totalMs:row.totalMs,maxMs:row.maxMs}))}
}
