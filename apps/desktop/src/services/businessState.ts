import {openDB} from 'idb'
import {isTauri} from '@tauri-apps/api/core'
import {clientOwnerScope} from './clientContext'
import {accountLifecycleRevision} from './accountStorage'
import {trackedInvoke} from './performanceCapture'

type Commands={native_business_state_list:{request:{key:string};response:Array<[string,string]>};native_business_state_read:{request:{key:string};response:string|null};native_business_state_write:{request:{key:string;expected:string|null;value:string};response:void}}
/** 统一业务状态端口：原生使用profile SQLite，Web使用IndexedDB；不降级写入localStorage。 */
export function businessState(owner:string){
 const scope=clientOwnerScope(owner),revision=accountLifecycleRevision()
 const check=()=>{if(scope!==clientOwnerScope(owner)||revision!==accountLifecycleRevision())throw Error('账号或本机空间已切换，请重新加载')}
 return statePort(scope,check)
}
/** 社区备份可预写尚未启用的新空间；调用方负责目标为空、原空间守卫及最终发布。 */
export function stagedBusinessState(scope:string,assertCurrent:()=>void){
 if(!scope.startsWith('community-'))throw Error('恢复目标空间无效')
 const revision=accountLifecycleRevision()
 return statePort(scope,()=>{assertCurrent();if(revision!==accountLifecycleRevision())throw Error('恢复期间账号已切换')})
}
function statePort(scope:string,check:()=>void){
 async function native<C extends keyof Commands>(command:C,data:Commands[C]['request']):Promise<Commands[C]['response']>{
  check();await trackedInvoke('core_profile_open',{request:{requestId:crypto.randomUUID(),profileId:scope}});check()
  return trackedInvoke<Commands[C]['response']>(command,{request:{requestId:crypto.randomUUID(),profileId:scope,...data}})
 }
 async function read(key:string):Promise<string|null>{
  check()
  if(isTauri()){const value=await native('native_business_state_read',{key});check();return value}
  const db=await openDB('note-flow-business-state',1,{upgrade(db){db.createObjectStore('entries')}})
  try{const value=await db.get('entries',JSON.stringify([scope,key]));check();return value??null}finally{db.close()}
 }
 /** 一次只读事务列出当前空间的业务前缀，保留null墓碑，不触发旧源迁移。 */
 async function list(prefix:string):Promise<Array<[string,string]>>{
  check()
  if(isTauri()){const values=await native('native_business_state_list',{key:prefix});check();return values}
  const db=await openDB('note-flow-business-state',1,{upgrade(db){db.createObjectStore('entries')}})
  try{
   const tx=db.transaction('entries','readonly'),scopePrefix=JSON.stringify([scope]).slice(0,-1)+','
   const values:Array<[string,string]>=[];let bytes=0
   // 先限定当前profile的规范复合键范围，避免扫描其他账号正文。
   let cursor=await tx.store.openCursor(IDBKeyRange.bound(scopePrefix,scopePrefix+'\uffff'))
   while(cursor){const [savedScope,key]=JSON.parse(String(cursor.key));if(savedScope===scope&&typeof key==='string'&&key.startsWith(prefix)){
    const value=cursor.value;if(typeof value!=='string')throw Error('本机状态格式无效')
    bytes+=new TextEncoder().encode(key+value).length
    if(values.length>=20000||bytes>32*1024*1024)throw Error('本机业务状态超过检查上限')
    values.push([key,value])
   }cursor=await cursor.continue()}
   await tx.done;check();return values
  }finally{db.close()}
 }
 async function write(key:string,expected:string|null,value:string){
  check();JSON.parse(value)
  if(isTauri()){await native('native_business_state_write',{key,expected,value});check();return}
  const db=await openDB('note-flow-business-state',1,{upgrade(db){db.createObjectStore('entries')}})
  try{check();const tx=db.transaction('entries','readwrite'),id=JSON.stringify([scope,key]);if((await tx.store.get(id)??null)!==expected){tx.abort();await tx.done.catch(()=>{});throw Error('本机状态已由另一窗口更新，请重新加载')}await tx.store.put(value,id);await tx.done;check()}finally{db.close()}
 }
 return {read,list,write,check,scope}
}
