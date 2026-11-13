import {businessState} from './businessState'

/** 为共享消息引擎提供同步已加载视图和异步持久提交；账号身份由调用方捕获。 */
export function createNotificationCacheStorage(owner:()=>string,legacy:Storage=localStorage){
 const tails=new Map<string,Promise<void>>()
 const values=new Map<string,string|null>(),flights=new Map<string,Promise<void>>()
 const validate=(key:string,value:string)=>{const parsed=JSON.parse(value);if(key.startsWith('note-flow-notification-center-v1:')?(!parsed||!Array.isArray(parsed.items)||!Array.isArray(parsed.pending)||parsed.items.some((row:any)=>!row||typeof row.id!=='string'||typeof row.createdAt!=='string')||parsed.pending.some((id:unknown)=>typeof id!=='string')):(!Array.isArray(parsed)||parsed.some((row:any)=>!row||typeof row.id!=='string'||typeof row.createdAt!=='string')))throw Error('消息缓存格式无效，原副本已保留')}
 const failure=(source:unknown,code:string)=>Object.assign(new Error(source instanceof Error?source.message:'消息持久化失败'),{code,notificationStage:'cache',cacheErrorName:(source as {name?:string})?.name||'Error',cause:source})
 const identity=(key:string)=>JSON.stringify([businessState(owner()).scope,key])
 async function prepare(keys:string[]){await Promise.all(keys.map(async key=>{
  const port=businessState(owner()),id=identity(key)
  await tails.get(id)?.catch(()=>{})
  let flight=flights.get(id)
  if(!flight){flight=(async()=>{
   let value=await port.read('notifications:'+key)
   if(value===null){const old=legacy.getItem(key);if(old!==null){validate(key,old);try{await port.write('notifications:'+key,null,old);value=old}catch(error){const competing=await port.read('notifications:'+key);if(competing===null)throw error;value=competing}port.check();if(value===old&&legacy.getItem(key)===old)legacy.removeItem(key)}}
   port.check();if(value!==null)validate(key,value);values.set(id,value)
  })().catch(source=>{throw failure(source,'NOTIFICATION_CACHE_READ')}).finally(()=>flights.delete(id));flights.set(id,flight)}await flight
 }))}
 return {
  prepare,
  getItem(key:string){const id=identity(key);if(!values.has(id))throw Error('消息缓存尚未加载');return values.get(id)!},
  async setItem(key:string,value:string){const port=businessState(owner()),id=identity(key);if(!values.has(id))throw Error('消息缓存尚未加载');const previous=tails.get(id)||Promise.resolve();const write=previous.catch(()=>{}).then(async()=>{port.check();await port.write('notifications:'+key,values.get(id)!,value);port.check();values.set(id,value)});tails.set(id,write);try{await write}catch(source){throw failure(source,'NOTIFICATION_CACHE_WRITE')}finally{if(tails.get(id)===write)tails.delete(id)}},
 }
}
