export interface LocalDraftGuard {flush():Promise<void>;dirty?():boolean;dismiss?():boolean}
const guards=new Map<object,LocalDraftGuard>()
let flushing:Promise<void>|undefined
export function registerLocalDraftGuard(owner:object,guard:LocalDraftGuard){guards.set(owner,guard);return()=>{if(guards.get(owner)===guard)guards.delete(owner)}}
/** A rejected flush keeps every guard registered so the same draft can be retried. */
export function flushLocalDrafts(){if(flushing)return flushing;flushing=(async()=>{for(const guard of [...guards.values()])await guard.flush()})().finally(()=>{flushing=undefined});return flushing}
export function hasUnsavedLocalDrafts(){return[...guards.values()].some(guard=>guard.dirty?.())}
export function dismissLocalDraftDialog(){for(const guard of [...guards.values()].reverse())if(guard.dismiss?.())return true;return false}
