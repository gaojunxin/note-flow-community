import limits from './contracts/syncExecutionLimits.json' with {type:'json'}
export const MAX_SYNC_PUSH_OPERATIONS=limits.maxPushOperations
/** Configuration is numeric, never coerced from text or null. */
export function syncPushBatchLimit(value:number=MAX_SYNC_PUSH_OPERATIONS):number{
 return typeof value==='number'&&Number.isFinite(value)?Math.max(1,Math.min(MAX_SYNC_PUSH_OPERATIONS,Math.floor(value))):MAX_SYNC_PUSH_OPERATIONS
}
