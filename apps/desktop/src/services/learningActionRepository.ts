import {openDB} from 'idb'
import {isTauri} from '@tauri-apps/api/core'
import {aiDataScope} from './aiDataScope'
import {accountLifecycleRevision,readAccountSetting} from './accountStorage'
import {clientOwnerScope} from './clientContext'
import {trackedInvoke} from './performanceCapture'
import {validateLearningActions} from './learningActionValidation'
import type {LearningActionProposal,LearningActionOperation} from '@note-flow/core/ai-learning'
type Values={drafts:LearningActionProposal;operations:LearningActionOperation}
type Kind=keyof Values
type Archive={drafts:LearningActionProposal[];operations:LearningActionOperation[]}
type Row={kind:Kind;uid:string;value:string}
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value))
const legacy=(scope:string)=>openDB('note-flow-ai-actions:'+scope,1,{upgrade(db){db.createObjectStore('drafts',{keyPath:'uid'});db.createObjectStore('operations',{keyPath:'uid'})}})
/** 成果行与租约以完整旧记录比较提交；外部任务/知识写入必须在事务之外，且先提交固定成果UID。 */
export async function learningActionRepository(){return repository()}
/** 预写尚未启用的社区空间，仍绑定发起空间、双方数据代次及账号生命周期。 */
export async function stagedLearningActionRepository(profileId:string,scope=`community-${profileId}`){
 if(!profileId||!(scope===`community-${profileId}`||scope.startsWith(`community-${profileId}:reset:`)))throw Error('成果恢复目标空间无效')
 return repository({profile:`community-${profileId}`,scope})
}
async function repository(staged?:{profile:string;scope:string}){
 const native=isTauri(),scope=staged?.scope||aiDataScope(),revision=accountLifecycleRevision(),sourceProfile=staged?localStorage.getItem('note-flow-community-profile-v1'):null
 const stageBinding=()=>JSON.stringify([localStorage.getItem('note-flow-community-profile-v1'),localStorage.getItem(`note-flow-ai-data-generation:community-${sourceProfile}`),localStorage.getItem(`note-flow-ai-data-generation:${staged?.profile}`)])
 const original=staged?stageBinding():'',owner=native&&!staged?String(JSON.parse(readAccountSetting('note-flow-pc-user')||'null')?.userId||'local'):'',profile=staged?.profile||(native?clientOwnerScope(owner):'')
 const check=()=>{if(revision!==accountLifecycleRevision()||(staged?stageBinding()!==original:scope!==aiDataScope()||native&&profile!==clientOwnerScope(owner)))throw Error('账号或成果空间已切换，请重新打开成果')}
 async function invoke<T>(action:string,data:Record<string,unknown>={}):Promise<T>{check();await trackedInvoke('core_profile_open',{request:{requestId:crypto.randomUUID(),profileId:profile}});check();const result=await trackedInvoke<T>('native_learning_actions',{request:{requestId:crypto.randomUUID(),profileId:profile,scope,action,...data}});check();return result}
 const validate=<K extends Kind>(kind:K,value:unknown):Values[K]=>{validateLearningActions({drafts:kind==='drafts'?[value]:[],operations:kind==='operations'?[value]:[]},scope);return value as Values[K]}
 async function oldSnapshot():Promise<Archive>{const db=await legacy(scope);try{check();const tx=db.transaction(['drafts','operations'],'readonly'),[drafts,operations]=await Promise.all([tx.objectStore('drafts').getAll(),tx.objectStore('operations').getAll()]);await tx.done;check();return validateLearningActions({drafts,operations},scope)}finally{db.close()}}
 if(native&&!await invoke<boolean>('status')){const source=await oldSnapshot();check();await invoke('migrate',{rows:rows(source)})}
 function rows(source:Archive):Row[]{return(['drafts','operations'] as const).flatMap(kind=>source[kind].map(value=>({kind,uid:value.uid,value:JSON.stringify(value)})))}
 async function read<K extends Kind>(kind:K,uid:string):Promise<Values[K]|undefined>{
  check();let value:unknown;if(native){const raw=await invoke<string|null>('read',{kind,uid});value=raw===null?undefined:JSON.parse(raw)}else{const db=await legacy(scope);try{value=await db.get(kind,uid);check()}finally{db.close()}}
  if(value===undefined)return undefined;const result=validate(kind,value);if(result.uid!==uid)throw Error('成果记录身份损坏');return result
 }
 async function compare<K extends Kind>(kind:K,before:Values[K]|undefined,value:Values[K]){
  check();const next=copy(validate(kind,value)),uid=next.uid,expected=before===undefined?null:JSON.stringify(before)
  if(before&&before.uid!==uid)throw Error('成果身份不能修改')
  if(native){await invoke('compare',{kind,uid,expected,value:JSON.stringify(next)});return}
  const db=await legacy(scope);try{check();const tx=db.transaction(['drafts','operations'],'readwrite'),store=tx.objectStore(kind);try{
   const current=await store.get(uid);if((current===undefined?null:JSON.stringify(current))!==expected)throw Error('成果已被其他窗口修改、确认或接管，请重新打开')
   if(kind==='drafts'){const confirmed=await tx.objectStore('operations').get(uid);if(confirmed&&confirmed.signature!==JSON.stringify(next))throw Error('已确认成果不能修改，请新建一份草稿')}
   if(kind==='operations'){const op=next as LearningActionOperation;if(current?current.signature!==op.signature:JSON.stringify(await tx.objectStore('drafts').get(uid))!==op.signature)throw Error('成果已确认或草稿已变化，请重新打开')}
   check();await store.put(next);await tx.done;check()
  }catch(error){try{tx.abort()}catch{}await tx.done.catch(()=>{});throw error}}finally{db.close()}
 }
 async function snapshot(){
  check();if(!native)return oldSnapshot();const source:Archive={drafts:[],operations:[]}
  for(const row of await invoke<Row[]>('snapshot')){const value=validate(row.kind,JSON.parse(row.value));if(value.uid!==row.uid)throw Error('成果记录身份损坏');(source[row.kind] as Array<LearningActionProposal|LearningActionOperation>).push(value)}return validateLearningActions(source,scope)
 }
 async function restore(value:Archive,fresh=false){
  const valid=copy(validateLearningActions(value,scope));for(const operation of valid.operations){delete operation.lease;delete operation.leaseUntil}check()
  if(native){await invoke('restore',{rows:rows(valid),fresh});return}
  const db=await legacy(scope);try{const tx=db.transaction(['drafts','operations'],'readwrite');try{
   if(fresh&&(await tx.objectStore('drafts').count()||await tx.objectStore('operations').count()))throw Error('成果恢复目标不是空空间')
   for(const kind of ['drafts','operations'] as const)for(const record of valid[kind]){check();const store=tx.objectStore(kind);if(!await store.get(record.uid))await store.add(record)}await tx.done;check()
  }catch(error){try{tx.abort()}catch{}await tx.done.catch(()=>{});throw error}}finally{db.close()}
 }
 return{scope,check,read,compare,snapshot,restore}
}
