import {openDB,type IDBPDatabase} from 'idb'
import {isTauri} from '@tauri-apps/api/core'
import {digest as sha256} from 'lib0/hash/sha256'
import {aiDataScope} from './aiDataScope'
import {accountLifecycleRevision,readAccountSetting} from './accountStorage'
import {clientOwnerScope} from './clientContext'
import {trackedInvoke} from './performanceCapture'
import {executionKey,validatePlanRecord,validateReceipt,validateExecutionBase,validateExecutionBackup,type PlanRecord,type SkillReceipt,type ExecutionBase,type ExecutionBackup} from './learningExecutionValidation'
type Kind='plans'|'receipts'|'archives'
type Row={kind:Kind;uid:string;value:string}
type Entry=Row&{id:string;scope:string}
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value))
const web=()=>openDB('note-flow-learning-execution',1,{upgrade(db){const entries=db.createObjectStore('entries',{keyPath:'id'});entries.createIndex('scope','scope');db.createObjectStore('migrations')}})
const id=(scope:string,kind:Kind,uid:string)=>JSON.stringify([scope,kind,uid])
const conflict=()=>new Error('工作区方案已变化或仍有未确认执行，不能丢弃或覆盖')
/** 原生执行恢复行仓储；Web也将两类旧全局库迁到同一个有空间索引的事务库，不新增旧库写入。 */
export async function learningExecutionRepository(scope=aiDataScope()){if(scope!==aiDataScope())throw Error('执行空间已切换');return repository(scope)}
/** 社区恢复只能预写惰性档案，调用方不得将旧方案/回执激活到新空间。 */
export async function stagedLearningExecutionRepository(profileId:string,scope=`community-${profileId}`){if(!profileId||!(scope===`community-${profileId}`||scope.startsWith(`community-${profileId}:reset:`)))throw Error('执行恢复目标空间无效');return repository(scope,`community-${profileId}`)}
async function repository(scope:string,target?:string){
 const native=isTauri(),revision=accountLifecycleRevision(),sourceProfile=target?localStorage.getItem('note-flow-community-profile-v1'):null
 const stageBinding=()=>JSON.stringify([localStorage.getItem('note-flow-community-profile-v1'),localStorage.getItem(`note-flow-ai-data-generation:community-${sourceProfile}`),localStorage.getItem(`note-flow-ai-data-generation:${target}`)])
 const bound=target?stageBinding():'',owner=native&&!target?String(JSON.parse(readAccountSetting('note-flow-pc-user')||'null')?.userId||'local'):'',profile=target||(native?clientOwnerScope(owner):'')
 const check=()=>{if(revision!==accountLifecycleRevision()||(target?stageBinding()!==bound:scope!==aiDataScope()||native&&profile!==clientOwnerScope(owner)))throw Error('账号或执行恢复空间已切换')}
 async function invoke<T>(action:string,data:Record<string,unknown>={}):Promise<T>{check();await trackedInvoke('core_profile_open',{request:{requestId:crypto.randomUUID(),profileId:profile}});check();const result=await trackedInvoke<T>('native_learning_execution',{request:{requestId:crypto.randomUUID(),profileId:profile,scope,action,...data}});check();return result}
 function validate(row:Row){const value=JSON.parse(row.value);if(row.kind==='plans'){validatePlanRecord(value,scope);if(executionKey(value.key,scope,2)[1]!==row.uid)throw Error('方案会话身份不匹配')}else if(row.kind==='receipts'){validateReceipt(value,scope);if(value.key!==row.uid)throw Error('技能回执身份不匹配')}else if(row.kind==='archives')validateExecutionBase(value);else throw Error('执行记录类型无效');return value}
 async function legacyRows():Promise<Row[]>{
  const rows:Row[]=[]
  for(const [name,store,kind,size] of [['note-flow-learning-workspace','plans','plans',2],['note-flow-learning-skills','receipts','receipts',3]] as const){
   const db=await openDB(name,1,{upgrade(db){db.createObjectStore(store,{keyPath:'key'})}})
   try{check();const prefix=JSON.stringify([scope]).slice(0,-1)+',';for(const value of await db.getAll(store,IDBKeyRange.bound(prefix,prefix+'\uffff'))){let key:unknown;try{key=JSON.parse(value.key)}catch{throw Error('执行恢复源记录身份无法解析，原始数据已保留')}if(!Array.isArray(key)||key[0]!==scope)continue;executionKey(value.key,scope,size);const row:Row={kind,uid:kind==='plans'?key[1]:value.key,value:JSON.stringify(value)};validate(row);rows.push(row)}check()}finally{db.close()}
  }return rows
 }
 async function webRows(db:IDBPDatabase):Promise<Row[]>{const tx=db.transaction('entries','readonly'),values=await tx.store.index('scope').getAll(scope) as Entry[];await tx.done;check();return values.map(({kind,uid,value})=>({kind,uid,value}))}
 async function prepareWeb(db:IDBPDatabase){
  check();if(await db.get('migrations',scope))return;const rows=await legacyRows();check();const tx=db.transaction(['entries','migrations'],'readwrite')
  try{if(!await tx.objectStore('migrations').get(scope)){for(const row of rows)await tx.objectStore('entries').add({...row,id:id(scope,row.kind,row.uid),scope});await tx.objectStore('migrations').put(true,scope)}await tx.done;check()}catch(error){try{tx.abort()}catch{}await tx.done.catch(()=>{});throw error}
 }
 if(native){if(!await invoke<boolean>('status')){const db=await web();let rows:Row[];try{rows=await db.get('migrations',scope)?await webRows(db):await legacyRows()}finally{db.close()}rows.forEach(validate);check();await invoke('migrate',{rows})}}
 else{const db=await web();try{await prepareWeb(db)}finally{db.close()}}
 async function read(kind:Kind,uid:string){check();let raw:string|null;if(native)raw=await invoke<string|null>('read',{kind,uid});else{const db=await web();try{raw=(await db.get('entries',id(scope,kind,uid)))?.value??null;check()}finally{db.close()}}return raw===null?undefined:validate({kind,uid,value:raw})}
 async function rows(){check();if(native)return invoke<Row[]>('snapshot');const db=await web();try{return await webRows(db)}finally{db.close()}}
 async function savePlan(record:PlanRecord,expected:number,guard?:()=>void,expectedUid?:string){validatePlanRecord(record,scope);const uid=executionKey(record.key,scope,2)[1],captured=copy(record);check();guard?.()
  if(native){await invoke('save',{kind:'plans',uid,expected,expectedUid,value:JSON.stringify(captured)});check();guard?.();return}
  const db=await web();try{const tx=db.transaction('entries','readwrite');try{const key=id(scope,'plans',uid),prior=await tx.store.get(key) as Entry|undefined,before=prior?validate(prior).plan:undefined;check();guard?.();const replaceable=!before||before.status==='completed'||before.status==='draft'&&!before.actions.length;if((before?.revision||0)!==expected||before?.uid!==expectedUid||captured.plan.revision!==expected+1||!replaceable&&(before.uid!==captured.plan.uid||JSON.stringify(before.scope)!==JSON.stringify(captured.plan.scope)))throw conflict();await tx.store.put({id:key,scope,kind:'plans',uid,value:JSON.stringify(captured)});await tx.done;check();guard?.()}catch(error){try{tx.abort()}catch{}await tx.done.catch(()=>{});throw error}}finally{db.close()}
 }
 async function clearPlan(uid:string,expected:number,expectedUid?:string){check();if(native){await invoke('clear',{kind:'plans',uid,expected,expectedUid});return}const db=await web();try{const tx=db.transaction('entries','readwrite');try{const key=id(scope,'plans',uid),row=await tx.store.get(key) as Entry|undefined,before=row?validate(row).plan:undefined;check();if((before?.revision||0)!==expected||before&&before.uid!==expectedUid||before&&['applying','partial'].includes(before.status))throw conflict();await tx.store.delete(key);await tx.done;check()}catch(error){try{tx.abort()}catch{}await tx.done.catch(()=>{});throw error}}finally{db.close()}}
 async function insert(kind:'receipts'|'archives',uid:string,value:SkillReceipt|ExecutionBase){const raw=JSON.stringify(value);validate({kind,uid,value:raw});check();if(native){await invoke('insert',{kind,uid,value:raw});return}const db=await web();try{const tx=db.transaction('entries','readwrite');try{const key=id(scope,kind,uid);if(!await tx.store.get(key)){check();await tx.store.add({id:key,scope,kind,uid,value:raw})}await tx.done;check()}catch(error){try{tx.abort()}catch{}await tx.done.catch(()=>{});throw error}}finally{db.close()}}
 async function backup():Promise<ExecutionBackup>{const result:ExecutionBackup={version:1,scope,plans:[],receipts:[],archives:[]};for(const row of await rows()){const value=validate(row);if(row.kind==='plans')result.plans.push(value);else if(row.kind==='receipts')result.receipts.push(value);else result.archives.push(value)}return validateExecutionBackup(result,scope)}
 async function archive(value:ExecutionBackup){const source=copy(validateExecutionBackup(value));for(const base of [{scope:source.scope,plans:source.plans,receipts:source.receipts},...source.archives]){if(!base.plans.length&&!base.receipts.length)continue;const key=Array.from(sha256(new TextEncoder().encode(JSON.stringify(base))),b=>b.toString(16).padStart(2,'0')).join('');await insert('archives',key,base)}check()}
 async function clearPlans(){check();if(native){await invoke('clearPlans');return}const db=await web();try{const tx=db.transaction('entries','readwrite');try{const records=await tx.store.index('scope').getAll(scope) as Entry[];for(const row of records)if(row.kind==='plans'&&['applying','partial'].includes(validate(row).plan.status))throw conflict();check();for(const row of records)if(row.kind==='plans')await tx.store.delete(row.id);await tx.done;check()}catch(error){try{tx.abort()}catch{}await tx.done.catch(()=>{});throw error}}finally{db.close()}}
 return{scope,check,read,savePlan,clearPlan,insert,backup,archive,clearPlans}
}
