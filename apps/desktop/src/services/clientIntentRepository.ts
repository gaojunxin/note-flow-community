import {backupValueFingerprint} from './backupSnapshotConsistency'
import {openDB} from 'idb'
import {isTauri} from '@tauri-apps/api/core'
import {clientOwnerScope} from './clientContext'
import {accountLifecycleRevision} from './accountStorage'
import {trackedInvoke} from './performanceCapture'
import type {TaskNoteSyncDatabase} from '../../../../packages/core/src/taskNoteStore'
export type IntentDomain='task-notes'|'reading'
export interface IntentRow {kind:string;uid:string;value:any}
export interface TaskNoteResetObservation {profile:string;epoch:number;pending:any[]}
const database=()=>openDB('note-flow-client-intents',1,{upgrade(db){db.createObjectStore('records');db.createObjectStore('state')}})
/** 旧页面可能长期持有v1连接；升级被阻塞时显式失败，不能让保存一直等待。
 * 无法取消的IDB打开请求若稍后成功，仅关闭本次连接，不删除任何来源。
 */
async function taskWebDatabase(profile:string){
 let blocked=false,rejectBlocked!:(error:Error)=>void
 const failure=new Promise<never>((_,reject)=>{rejectBlocked=reject})
 const opening=openDB(`jiyu-task-notes:${profile}:v2`,2,{blocked(){blocked=true;rejectBlocked(Error('任务关联存储升级被旧窗口占用，请关闭其他旧版本窗口后重试'))},upgrade(db){for(const name of ['relations','pending'])if(!db.objectStoreNames.contains(name))db.createObjectStore(name,{keyPath:'uid'});if(!db.objectStoreNames.contains('state'))db.createObjectStore('state');if(!db.objectStoreNames.contains('intent_archives'))db.createObjectStore('intent_archives')}})
 void opening.then(db=>{if(blocked)db.close()}).catch(()=>{})
 return Promise.race([opening,failure])
}
export function validateIntentRow(domain:IntentDomain,row:IntentRow){
 const v=row?.value
 if(!row||typeof row.uid!=='string'||!row.uid||!v||typeof v!=='object')throw Error('本机意图记录格式无效，原始数据已保留')
 if(new TextEncoder().encode(JSON.stringify(v)).length>32*1024*1024)throw Error('本机意图记录超过写入上限')
 if(row.kind==='archive')return
 if(domain==='reading'){
  if(row.kind!=='reading'||!/^[a-f\d]{64}$/i.test(row.uid)||!Number.isInteger(v.page)||!Number.isInteger(v.pages)||v.page<1||v.pages<v.page||!Number.isFinite(v.offset)||v.offset<0||v.offset>1||!Number.isFinite(v.zoom)||v.zoom<.25||v.zoom>3||!Number.isSafeInteger(v.version)||v.version<0||typeof v.operationId!=='string'||!v.operationId||typeof v.dirty!=='boolean')throw Error('阅读进度格式无效，原始数据已保留')
 }else{
  const relation=row.kind==='pending'?v.value:v
  if(!['relations','pending'].includes(row.kind)||!relation||['uid','taskUid','noteUid','relationType'].some(key=>typeof relation[key]!=='string'||!relation[key])||!Number.isSafeInteger(relation.version)||relation.version<0||relation.deleted!==undefined&&typeof relation.deleted!=='boolean'||v.uid!==row.uid||row.kind==='pending'&&(!['create','delete'].includes(v.action)||v.value.uid!==row.uid))throw Error('任务关联格式无效，原始数据已保留')
 }
}
/** 原生SQLite/Web IDB的异步意图端口；epoch在同一事务内阻止清理前的句柄回写。
 * inspectOnly仅检查新权威或尚未迁移的旧源，不提交迁移标记或执行队列。
 */
export async function clientIntentRepository(domain:IntentDomain,owner:string,options:{stagedProfile?:string;inspectOnly?:boolean}={}){
 const native=isTauri(),profile=options.stagedProfile||clientOwnerScope(owner),revision=accountLifecycleRevision(),source=localStorage.getItem('note-flow-community-profile-v1'),generation=localStorage.getItem('note-flow-ai-data-generation:'+profile),sourceGeneration=localStorage.getItem(`note-flow-ai-data-generation:community-${source}`)
 if(options.stagedProfile&&!/^community-[^:]+$/.test(profile))throw Error('意图恢复目标空间无效')
 const check=()=>{if(revision!==accountLifecycleRevision()||!options.stagedProfile&&profile!==clientOwnerScope(owner)||source!==localStorage.getItem('note-flow-community-profile-v1')||generation!==localStorage.getItem('note-flow-ai-data-generation:'+profile)||options.stagedProfile&&sourceGeneration!==localStorage.getItem(`note-flow-ai-data-generation:community-${source}`))throw Error('账号或本机空间已切换，请重新加载')}
 const taskWeb=!native&&domain==='task-notes'
 const webDatabase=()=>taskWeb?taskWebDatabase(profile):database()
 const stores=taskWeb?['relations','pending','intent_archives','state']:['records','state']
 const stateKey=JSON.stringify([profile,domain]),prefix=JSON.stringify([profile,domain]).slice(0,-1)+','
 const id=(kind:string,uid:string)=>JSON.stringify([profile,domain,kind,uid])
 let epoch=0,legacyView:IntentRow[]|undefined
 async function nativeCall<T>(action:string,data:Record<string,unknown>={}):Promise<T>{check();await trackedInvoke('core_profile_open',{request:{requestId:crypto.randomUUID(),profileId:profile}});check();const value=await trackedInvoke<T>('native_client_intents',{request:{requestId:crypto.randomUUID(),profileId:profile,domain,action,epoch,...data}});check();return value}
 async function status(){check();if(native)return nativeCall<{epoch:number;ready:boolean}>('status');const db=await webDatabase();try{const value=await db.get('state',stateKey);check();return value??{epoch:0,ready:false}}finally{db.close()}}
 async function legacy(){
  check();const rows:IntentRow[]=[]
  if(domain==='reading'){const prefix=`note-flow-reading:${encodeURIComponent(profile)}:`;for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith(prefix)){const raw=localStorage.getItem(key);if(raw!==null){const value=JSON.parse(raw)
    // 旧客户端采用“云端无位置”时会保存空operationId；它不是待发送请求，只补本机身份并保留原始键。
    if(value?.version===0&&value.operationId===''&&value.dirty===false&&value.page===1&&value.pages===1&&value.offset===0&&value.zoom===1)value.operationId=crypto.randomUUID()
    rows.push({kind:'reading',uid:key.slice(prefix.length),value})}}}}
  else{const db=await openDB(`jiyu-task-notes:${profile}:v2`,undefined,{upgrade(db){db.createObjectStore('relations',{keyPath:'uid'});db.createObjectStore('pending',{keyPath:'uid'})}});try{const tx=db.transaction(['relations','pending'],'readonly');for(const kind of ['relations','pending'])for(const value of await tx.objectStore(kind).getAll())rows.push({kind,uid:value.uid,value});await tx.done}finally{db.close()}}
  check();validateRows(rows);return rows
 }
 function validateRows(rows:IntentRow[]){if(rows.length>20000||new TextEncoder().encode(JSON.stringify(rows)).length>64*1024*1024)throw Error('本机意图超过迁移/读取上限');rows.forEach(row=>validateIntentRow(domain,row))}
 const initial=await status();epoch=initial.epoch
 if(!initial.ready){const rows=await legacy();if(options.inspectOnly)legacyView=rows;else if(native)await nativeCall('migrate',{rows});else{const db=await webDatabase();try{check();const tx=db.transaction(stores,'readwrite');try{const current=await tx.objectStore('state').get(stateKey)??{epoch:0,ready:false};if(current.epoch!==epoch)throw Error('本机意图已清理，请重新加载');if(!current.ready){if(taskWeb){const currentRows:IntentRow[]=[];for(const kind of ['relations','pending'])for(const value of await tx.objectStore(kind).getAll())currentRows.push({kind,uid:value.uid,value});validateRows(currentRows)}else for(const row of rows){check();await tx.objectStore('records').add(row.value,id(row.kind,row.uid))}await tx.objectStore('state').put({epoch,ready:true},stateKey)}await tx.done;check()}catch(error){try{tx.abort()}catch{}await tx.done.catch(()=>{});throw error}}finally{db.close()}}}
 async function web<T>(work:(tx:any)=>Promise<T>):Promise<T>{check();const db=await webDatabase();try{const tx=db.transaction(stores,'readwrite');try{const state=await tx.objectStore('state').get(stateKey)??{epoch:0,ready:false};check();if(state.epoch!==epoch)throw Error('本机意图已清理，请重新加载');const value=await work(tx);check();await tx.done;check();return value}catch(error){try{tx.abort()}catch{}await tx.done.catch(()=>{});throw error}}finally{db.close()}}
 async function invoke<T=void>(action:string,data:Record<string,any>={}):Promise<T>{data=JSON.parse(JSON.stringify(data));check();if(options.inspectOnly&& !['rows','read','snapshot'].includes(action))throw Error('检查句柄不能修改本机意图');if(native)return nativeCall<T>(action,data)
  return web(async tx=>{if(taskWeb){if(action==='rows'){const all:IntentRow[]=[];for(const kind of ['relations','pending','archive']){const store=tx.objectStore(kind==='archive'?'intent_archives':kind),keys=await store.getAllKeys(),values=await store.getAll();keys.forEach((uid:string,index:number)=>all.push({kind,uid,value:values[index]}))}return all}if(action==='archive'){validateIntentRow(domain,{kind:'archive',uid:data.uid,value:data.value});const store=tx.objectStore('intent_archives'),current=await store.get(data.uid);if(current!==undefined&&backupValueFingerprint(current)!==backupValueFingerprint(data.value))throw Error('意图档案身份冲突');if(current===undefined)await store.add(data.value,data.uid);return}if(action==='clear'){const pending=await tx.objectStore('pending').getAll();if(data.expected!==undefined&&backupValueFingerprint(pending)!==backupValueFingerprint(data.expected))throw Error('任务关联队列已变化，请重新检查');for(const kind of ['relations','pending'])await tx.objectStore(kind).clear();if(data.value){validateIntentRow(domain,{kind:'archive',uid:data.uid,value:data.value});await tx.objectStore('intent_archives').put(data.value,data.uid)}await tx.objectStore('state').put({epoch:epoch+1,ready:true},stateKey);return}throw Error('请使用任务关联原子端口')}const records=tx.objectStore('records');if(action==='rows'){const keys=await records.getAllKeys(IDBKeyRange.bound(prefix,prefix+'\uffff')),values=await records.getAll(IDBKeyRange.bound(prefix,prefix+'\uffff'));return keys.map((key:string,index:number)=>{const parts=JSON.parse(key);return{kind:parts[2],uid:parts[3],value:values[index]}})}
   if(action==='read'){const value=await records.get(id('reading',data.uid));if(value!==undefined)validateIntentRow(domain,{kind:'reading',uid:data.uid,value});return value??null}
   if(action==='compare'){validateIntentRow(domain,{kind:'reading',uid:data.uid,value:data.value});const current=await records.get(id('reading',data.uid))??null;if(JSON.stringify(current)!==JSON.stringify(data.expected))throw Error('阅读位置已由另一窗口更新，请重试');check();await records.put(data.value,id('reading',data.uid));return}
   if(action==='archive'){validateIntentRow(domain,{kind:'archive',uid:data.uid,value:data.value});const current=await records.get(id('archive',data.uid));if(current!==undefined&&backupValueFingerprint(current)!==backupValueFingerprint(data.value))throw Error('意图恢复档案身份冲突');if(current===undefined)await records.add(data.value,id('archive',data.uid));return}
   if(action==='clear'){for(const key of await records.getAllKeys(IDBKeyRange.bound(prefix,prefix+'\uffff'))){check();if(JSON.parse(String(key))[2]!=='archive')await records.delete(key)}await tx.objectStore('state').put({epoch:epoch+1,ready:true},stateKey);return}
   throw Error('不支持的本机意图操作')
  }) as Promise<T>
 }
 async function rows(){if(legacyView){const current=await status();if(current.epoch!==epoch)throw Error('本机意图已清理，请重新检查');if(!current.ready)return legacyView;legacyView=undefined}const values=await invoke<IntentRow[]>('rows');validateRows(values);return values}
 /** Web两类关系表映射到同一records事务，state校验也在该事务中，不能跨库检查后再写。 */
 function taskDatabase():TaskNoteSyncDatabase<any>{
  if(native||options.inspectOnly)throw Error('此句柄不提供Web写事务')
  return{getAll:async(kind:any)=>(await rows()).filter(row=>row.kind===kind).map(row=>row.value),put:async()=>{throw Error('请使用原子关系仓储')},delete:async()=>{throw Error('请使用原子关系仓储')},transaction(){
   check();let db:any,tx:any;const gate=webDatabase().then(async value=>{db=value;tx=db.transaction(stores,'readwrite');tx.done.catch(()=>{});const state=await tx.objectStore('state').get(stateKey)??{epoch:0,ready:false};check();if(state.epoch!==epoch){tx.abort();throw Error('本机意图已清理，请重新加载')}})
   const done=gate.then(()=>tx.done).finally(()=>db?.close());done.catch(()=>{})
   const action=async(method:string,kind:string,value?:any)=>{await gate;check();const store=tx.objectStore(kind);if(method==='getAll'){const [keys,values]=await Promise.all([store.getAllKeys(),store.getAll()]);check();values.forEach((value:any,index:number)=>validateIntentRow(domain,{kind,uid:keys[index],value}));return values}if(method==='get'){const result=await store.get(value);check();if(result!==undefined)validateIntentRow(domain,{kind,uid:value,value:result});return result;}if(method==='delete')return store.delete(value);validateIntentRow(domain,{kind,uid:value.uid,value});return store.put(value)}
   return{done,abort:()=>tx?.abort(),objectStore:(kind:string)=>({get:(uid:string)=>action('get',kind,uid),getAll:()=>action('getAll',kind),put:(value:any)=>action('put',kind,value),delete:(uid:string)=>action('delete',kind,uid)})}
  }}
 }
 return{native,profile,epoch,check,invoke,rows,taskDatabase}
}
