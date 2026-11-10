import type {SyncQueueCounts,SyncRecoveryRecord,SyncQueueSource} from '@note-flow/core/sync-presentation'
export interface SyncQueueInspection {counts:SyncQueueCounts;records:SyncRecoveryRecord[];checkedAt:string;coverage:string;sources?:SyncQueueSource[]}
/** Community local-only edition has no official network upload queue. */
export async function readSyncQueueInspection(_ownerId:string):Promise<SyncQueueInspection|null>{return null}
async function resolveBatch<T extends {conflictId:string}>(_ownerId:string,_items:T[],_strategy:'local'|'server',_resolve:(item:T)=>Promise<void>,_progress:(done:number,total:number)=>void,_check:()=>void):Promise<{succeeded:string[];failed:Array<{conflictId:string;reason:string}>}>{throw Error('当前本地版没有云端冲突批次')}
export const syncQueueInspectionService={read:readSyncQueueInspection,resolveBatch}
