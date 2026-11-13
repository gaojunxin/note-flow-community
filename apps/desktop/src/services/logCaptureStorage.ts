import {openDB} from 'idb'
import {reviewBinding} from './reviewRepository'
import {trackedInvoke} from './performanceCapture'
import {blobDigest} from './blobDigest'
import {backupValueFingerprint} from './backupSnapshotConsistency'
import type {LogCaptureJournal} from './logCaptureJournal'

/** Web保持原captures表；原生仅把它当只读迁移源，不模拟IDB事务。 */
export function logCaptureDatabase(){
 let rejected=false
 let rejectBlocked!:(error:Error)=>void
 const blocked=new Promise<never>((_,reject)=>{rejectBlocked=reject})
 const opening=openDB('note-flow-log-capture-recovery',2,{upgrade(db){if(!db.objectStoreNames.contains('captures'))db.createObjectStore('captures',{keyPath:'scope'});if(!db.objectStoreNames.contains('archives'))db.createObjectStore('archives');if(!db.objectStoreNames.contains('state'))db.createObjectStore('state')},blocked(){rejected=true;rejectBlocked(Error('日志暂存升级被旧窗口占用，请关闭其他旧版本窗口后重试'))}})
 // IDB升级请求不能取消，失败后若旧窗口释放，关闭迟到连接，不再继续原操作。
 void opening.then(db=>{if(rejected)db.close()},()=>{})
 return Promise.race([opening,blocked])
}
const sourceDatabase=()=>openDB('note-flow-log-capture-recovery',undefined,{upgrade(db){db.createObjectStore('captures',{keyPath:'scope'})}})
type Metadata=Omit<LogCaptureJournal,'files'>&{files:Array<Omit<LogCaptureJournal['files'][number],'blob'>&{sha256:string;sizeBytes:number}>}
const header=(value:unknown)=>{const bytes=new TextEncoder().encode(JSON.stringify(value));return btoa(String.fromCharCode(...bytes))}
/** 句柄捕获profile、生命周期及数据世代；每次本机提交仍须在事务内检查epoch。 */
export async function logCaptureStorage(scope:string,validate:(v:unknown,scope:string)=>void,staged=false,noMigration=false){
 const binding=reviewBinding(scope,staged),{native,profile,check}=binding
 let epoch=0
 async function call<T=void>(action:string,data:Record<string,unknown>={}):Promise<T>{check();await trackedInvoke('core_profile_open',{request:{requestId:crypto.randomUUID(),profileId:profile}});check();const value=await trackedInvoke<T>('native_capture_store',{request:{requestId:crypto.randomUUID(),profileId:profile,scope,epoch,action,...data}});check();return value}
 async function binary(action:string,sha256:string,bytes=new Uint8Array()):Promise<ArrayBuffer>{check();const data={requestId:crypto.randomUUID(),profileId:profile,scope,epoch,sha256,action};const value=await trackedInvoke<ArrayBuffer>('native_capture_bytes',bytes,{headers:{'x-note-flow-capture':header(data)}});check();return value}
 async function encode(row:LogCaptureJournal):Promise<Metadata>{validate(row,scope);const files:Metadata['files']=[];for(const {blob,...metadata} of row.files){check();if(blob.size>64*1024*1024)throw Error('日志附件超过64MiB暂存上限，请保留原文件');const sha256=await blobDigest(blob);check();await binary('upload',sha256,new Uint8Array(await blob.arrayBuffer()));files.push({...metadata,sha256,sizeBytes:blob.size})}return{...row,files}}
 async function decode(row:Metadata):Promise<LogCaptureJournal>{const files:LogCaptureJournal['files']=[];for(const {sha256,sizeBytes,...metadata} of row.files){const bytes=await binary('read',sha256),blob=new Blob([bytes],{type:metadata.type});if(blob.size!==sizeBytes||await blobDigest(blob)!==sha256)throw Error('日志附件校验失败，请保留原材料');check();files.push({...metadata,blob})}const value={...row,files};validate(value,scope);return value}
 async function legacy(){const db=await sourceDatabase();try{const active=await db.get('captures',scope),archives=db.objectStoreNames.contains('archives')?(await db.getAllKeys('archives')).filter(key=>JSON.parse(String(key))[0]===scope):[];const values=await Promise.all(archives.map(key=>db.get('archives',key)));check();return[...(active===undefined?[]:[{kind:'active',value:active}]),...values.map(value=>({kind:'archive',value}))]}finally{db.close()}}
 if(native){const status=await call<{epoch:number;ready:boolean}>('status');epoch=status.epoch;if(!status.ready&&!noMigration){const old=await legacy(),rows=[];for(const row of old){validate(row.value,scope);rows.push({...row,value:await encode(row.value)})}check();await call('migrate',{rows})}}
 else {const db=await logCaptureDatabase();try{epoch=(await db.get('state',scope))?.epoch??0;check()}finally{db.close()}}
 async function web<T>(work:(tx:any)=>Promise<T>){check();const db=await logCaptureDatabase();try{const tx=db.transaction(['captures','archives','state'],'readwrite');try{const status=await tx.objectStore('state').get(scope);check();if((status?.epoch??0)!==epoch)throw Error('日志暂存已清理，请重新加载');const value=await work(tx);check();await tx.done;check();return value}catch(e){try{tx.abort()}catch{}await tx.done.catch(()=>{});throw e}}finally{db.close()}}
 return {
  native,check,
  async read():Promise<LogCaptureJournal|undefined>{const row=native?await call<Metadata|null>('read'):await web<LogCaptureJournal|undefined>(tx=>tx.objectStore('captures').get(scope));if(row==null)return;return native?decode(row as Metadata):row as LogCaptureJournal},
  async archives():Promise<LogCaptureJournal[]>{if(native)return Promise.all((await call<Metadata[]>('archives')).map(decode));return web(async tx=>{const keys=await tx.objectStore('archives').getAllKeys(),rows=[];for(const key of keys)if(JSON.parse(String(key))[0]===scope)rows.push(await tx.objectStore('archives').get(key));return rows})},
  async save(row:LogCaptureJournal){validate(row,scope);if(native)return call('save',{value:await encode(row)});return web(async tx=>{if(await tx.objectStore('captures').get(scope))throw Error('已有未完成日志，请先恢复或放弃');await tx.objectStore('captures').add(row)})},
  async mark(uid:string){if(native)return call('mark',{uid});return web(async tx=>{const row=await tx.objectStore('captures').get(scope);if(!row||row.operationUid!==uid)throw Error('日志恢复记录已改变，已停止写入');await tx.objectStore('captures').put({...row,committed:true})})},
  async clear(uid:string){if(native)return call('clear',{uid});return web(async tx=>{const row=await tx.objectStore('captures').get(scope);if(row?.operationUid===uid)await tx.objectStore('captures').delete(scope)})},
  async archive(rows:LogCaptureJournal[]){for(const row of rows)validate(row,scope);if(native){const values=[];for(const row of rows)values.push(await encode(row));return call('archive',{rows:values})}const prepared:Array<{row:LogCaptureJournal;key:string}>=[];for(const row of rows){const files=[];for(const {blob,...file} of row.files)files.push({...file,sha256:await blobDigest(blob),sizeBytes:blob.size});prepared.push({row,key:JSON.stringify([scope,backupValueFingerprint({...row,files})])})}return web(async tx=>{for(const {row,key} of prepared)if(!await tx.objectStore('archives').get(key))await tx.objectStore('archives').add(row,key)})},
  async erase(){if(native)return call('reset');return web(async tx=>{await tx.objectStore('captures').delete(scope);for(const key of await tx.objectStore('archives').getAllKeys())if(JSON.parse(String(key))[0]===scope)await tx.objectStore('archives').delete(key);await tx.objectStore('state').put({epoch:epoch+1},scope)})},
  async scopes():Promise<string[]>{if(native){const existing=await call<string[]>('scopes'),db=await sourceDatabase();try{return [...new Set([...existing,...(await db.getAllKeys('captures')).map(String)])].filter(s=>s===scope||s.startsWith(scope+':reset:'))}finally{db.close()}}return web(async tx=>{const all=[...(await tx.objectStore('captures').getAllKeys()).map(String),...(await tx.objectStore('state').getAllKeys()).map(String)];for(const key of await tx.objectStore('archives').getAllKeys())all.push(JSON.parse(String(key))[0]);return[...new Set(all)].filter(s=>s===scope||s.startsWith(scope+':reset:'))})},
  async repairInvalid(){if(native)throw Error('原生日志迁移源或附件异常已保留，请先备份核对，不自动删除原材料');return web(async tx=>{const row=await tx.objectStore('captures').get(scope);if(row===undefined)return true;try{validate(row,scope)}catch{await tx.objectStore('captures').delete(scope);return true}return false})},
 }
}
