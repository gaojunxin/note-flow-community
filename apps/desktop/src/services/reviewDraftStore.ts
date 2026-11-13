import type {IDBPDatabase} from 'idb'
import {reviewRepository,reviewBinding,type ReviewKind,type ReviewRow} from './reviewRepository'
export type DraftRow={key:string;scope:string;updatedAt:string}
/** 文本草稿句柄保留打开时的完整基线；保存/清理串行，冲突不重新读取基线后覆盖。 */
export function reviewDraftStore<T extends DraftRow>(kind:Exclude<ReviewKind,'history'>,scope:string,key:string,database:()=>Promise<IDBPDatabase>,snapshot:()=>Promise<T[]>,validate:(value:T)=>void,initial?:{value:T|undefined}){
 const binding=reviewBinding(scope)
 let ready:ReturnType<typeof reviewRepository>|undefined,observed=initial!==undefined,raw:string|null=initial?.value===undefined?null:JSON.stringify(initial.value),tail=Promise.resolve()
 const port=()=>ready??=(reviewRepository(kind,scope,async()=>(await snapshot()).map(row=>({uid:row.key,value:JSON.stringify(row)})),rows=>rows.forEach(row=>validate(JSON.parse(row.value))),binding).catch(error=>{ready=undefined;throw error}))
 async function load(){const repo=await port();let value:T|undefined
  if(repo.native){const serialized=await repo.invoke<string|null>('read',{uid:key});value=serialized===null?undefined:JSON.parse(serialized)}
  else{const db=await database();try{value=await db.get('drafts',key);binding.check()}finally{db.close()}}
  if(value!==undefined){validate(value);if(value.key!==key||value.scope!==scope)throw Error('草稿身份不匹配')}raw=value===undefined?null:JSON.stringify(value);observed=true;return value
 }
 function enqueue<R>(work:()=>Promise<R>){const next=tail.catch(()=>{}).then(work);tail=next.then(()=>{},()=>{});return next}
 async function commit(value:T|null){binding.check();if(!observed)await load();binding.check();const serialized=value===null?null:JSON.stringify(value),repo=await port()
  if(repo.native)await repo.invoke('compare',{uid:key,expected:raw,value:serialized})
  else{const db=await database();try{const tx=db.transaction('drafts','readwrite');try{const current=await tx.store.get(key);binding.check();if((current===undefined?null:JSON.stringify(current))!==raw)throw Error('草稿已由另一窗口修改，请重新打开');if(value===null)await tx.store.delete(key);else await tx.store.put(JSON.parse(serialized!));await tx.done;binding.check()}catch(error){try{tx.abort()}catch{}await tx.done.catch(()=>{});throw error}}finally{db.close()}}
  binding.check();raw=serialized
 }
 return{check:binding.check,read:()=>enqueue(async()=>{binding.check();return load()}),save(value:T){const frozen=JSON.parse(JSON.stringify(value));validate(frozen);return enqueue(()=>commit(frozen))},clear:()=>enqueue(()=>commit(null))}
}
/** 列表/备份读新权威仓储；旧源迁移必须全量校验，不丢弃未知坏行。 */
export async function reviewDraftRows<T extends DraftRow>(kind:Exclude<ReviewKind,'history'>,scope:string,database:()=>Promise<IDBPDatabase>,snapshot:()=>Promise<T[]>,validate:(value:T)=>void,staged=false){
 const binding=reviewBinding(scope,staged),port=await reviewRepository(kind,scope,async()=>(await snapshot()).map(row=>({uid:row.key,value:JSON.stringify(row)})),rows=>rows.forEach(row=>validate(JSON.parse(row.value))),binding)
 return{...port,async rows(){let rows:T[];if(port.native)rows=(await port.invoke<ReviewRow[]>('list')).map(row=>JSON.parse(row.value));else rows=await snapshot();binding.check();rows.forEach(validate);return rows},async restore(rows:T[]){const frozen: T[]=JSON.parse(JSON.stringify(rows));frozen.forEach(validate);binding.check();if(port.native){await port.invoke('restore',{fresh:staged&&kind!=='archives',rows:frozen.map(row=>({uid:row.key,value:JSON.stringify(row)}))});return}const db=await database();try{const tx=db.transaction('drafts','readwrite');try{if(staged&&kind!=='archives'){const prefix=JSON.stringify([scope]).slice(0,-1)+',';const count=await tx.store.count(IDBKeyRange.bound(prefix,prefix+'\uffff'));binding.check();if(count)throw Error('草稿恢复目标不是空空间')}for(const row of frozen){binding.check();const existing=await tx.store.get(row.key);binding.check();if(kind==='archives'&&existing!==undefined&&JSON.stringify(existing)!==JSON.stringify(row))throw Error('恢复档案标识冲突');if(existing===undefined)await tx.store.add(row)}await tx.done;binding.check()}catch(error){try{tx.abort()}catch{}await tx.done.catch(()=>{});throw error}}finally{db.close()}}}
}
/** 显式清理在同一Web写事务内检查身份并删除，失败回滚全部行；原生由Rust一次执行。 */
export async function clearReviewDraftRows(port:Awaited<ReturnType<typeof reviewRepository>>,database:()=>Promise<IDBPDatabase>,scope:string,owner=false){
 port.check();if(port.native){await port.invoke('clear',{owner});return}
 const db=await database()
 try{port.check();const tx=db.transaction('drafts','readwrite')
  try{let cursor=await tx.store.openCursor();while(cursor){port.check();if(cursor.value.scope===scope||owner&&typeof cursor.value.scope==='string'&&cursor.value.scope.startsWith(scope+':reset:'))await cursor.delete();cursor=await cursor.continue()}port.check();await tx.done;port.check()}catch(error){try{tx.abort()}catch{}await tx.done.catch(()=>{});throw error}
 }finally{db.close()}
}
