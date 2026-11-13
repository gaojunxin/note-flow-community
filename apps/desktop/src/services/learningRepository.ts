import {openDB} from 'idb'
import {isTauri} from '@tauri-apps/api/core'
import {validateLearningCache,type LearningSession,type LearningMessage} from '@note-flow/core/ai-learning'
import {aiDataScope} from './aiDataScope'
import {accountLifecycleRevision,readAccountSetting} from './accountStorage'
import {clientOwnerScope} from './clientContext'
import {trackedInvoke} from './performanceCapture'
/** 固定笔记UID须先提交；done仅表示本机笔记写入已确认，不表示云端同步完成。 */
export interface LearningNoteOperation {uid:string;signature:string;noteUid:string;done:boolean;sources?:LearningMessage[]}
type Values={sessions:LearningSession;operations:LearningNoteOperation}
type Kind=keyof Values
type Row={kind:Kind;uid:string;value:string}
const serialize=(value:unknown)=>JSON.stringify(value)
const legacyDatabase=(scope:string)=>openDB(`note-flow-local-learning:${scope}`,1,{upgrade(db){db.createObjectStore('sessions',{keyPath:'uid'});db.createObjectStore('operations',{keyPath:'uid'})}})
function validate<K extends Kind>(kind:K,value:unknown):Values[K]{
 if(kind==='sessions')validateLearningCache({sessions:[value],selectedUid:'',input:'',draft:'',sources:[]})
 else {const op=value as LearningNoteOperation;if(!op||typeof op.uid!=='string'||!op.uid||typeof op.signature!=='string'||typeof op.noteUid!=='string'||!op.noteUid||typeof op.done!=='boolean')throw Error('学习保存记录损坏，原始数据已保留')}
 return value as Values[K]
}
/** 学习正式行仓储：原生走Rust/profile SQLite，Web保留IndexedDB真实事务。
 * 一次compare只提交一行；模型/笔记写入不能包进本库事务，调用方必须先提交操作身份。
 */
export async function learningRepository(){return repository()}
/** 社区恢复可预写未启用的新空间；整个操作仍由发起空间的身份和生命周期围栏保护。 */
export async function stagedLearningRepository(profileId:string,scope=`community-${profileId}`){
 if(!profileId||!(scope===`community-${profileId}`||scope.startsWith(`community-${profileId}:reset:`)))throw Error('学习恢复目标空间无效')
 return repository({profile:`community-${profileId}`,scope})
}
async function repository(staged?:{profile:string;scope:string}){
 const scope=staged?.scope||aiDataScope(),revision=accountLifecycleRevision(),native=isTauri(),sourceProfile=staged?localStorage.getItem('note-flow-community-profile-v1'):null,sourceGeneration=staged?localStorage.getItem(`note-flow-ai-data-generation:community-${sourceProfile}`):null,targetGeneration=staged?localStorage.getItem(`note-flow-ai-data-generation:${staged.profile}`):null
 // Web不依赖原生profile上下文，仍以数据空间和账号生命周期拒绝晚到结果。
 const owner=native&&!staged?String(JSON.parse(readAccountSetting('note-flow-pc-user')||'null')?.userId||'local'):'',profile=staged?.profile||(native?clientOwnerScope(owner):'')
 const check=()=>{if((staged?(localStorage.getItem('note-flow-community-profile-v1')!==sourceProfile||localStorage.getItem(`note-flow-ai-data-generation:community-${sourceProfile}`)!==sourceGeneration||localStorage.getItem(`note-flow-ai-data-generation:${staged.profile}`)!==targetGeneration):scope!==aiDataScope())||revision!==accountLifecycleRevision()||native&&!staged&&profile!==clientOwnerScope(owner))throw Error('账号或学习数据空间已切换')}
 async function invoke<T>(action:string,data:Record<string,unknown>={}):Promise<T>{check();await trackedInvoke('core_profile_open',{request:{requestId:crypto.randomUUID(),profileId:profile}});check();const result=await trackedInvoke<T>('native_learning_repository',{request:{requestId:crypto.randomUUID(),profileId:profile,scope,action,...data}});check();return result}
 async function oldSnapshot(){const db=await legacyDatabase(scope);try{check();const tx=db.transaction(['sessions','operations'],'readonly'),[sessions,operations]=await Promise.all([tx.objectStore('sessions').getAll(),tx.objectStore('operations').getAll()]);await tx.done;check();return{sessions,operations}}finally{db.close()}}
 if(native&&!await invoke<boolean>('status')){
  const old=await oldSnapshot();const rows:Row[]=[]
  // 两张旧表一起校验/提交，迁移标记与新行同事务；旧IndexedDB保留作只读恢复来源，不双写或自动删除。
  for(const kind of ['sessions','operations'] as const)for(const value of old[kind]){if(kind==='sessions')validate(kind,value);else if(!value||typeof value.uid!=='string'||!value.uid)throw Error('学习操作档案身份损坏，原始数据已保留');rows.push({kind,uid:value.uid,value:serialize(value)})}
  check();await invoke('migrate',{rows})
 }
 async function read<K extends Kind>(kind:K,uid:string):Promise<Values[K]|undefined>{
  check();let value:unknown
  if(native){const raw=await invoke<string|null>('read',{kind,uid});value=raw===null?undefined:JSON.parse(raw)}
  else {const db=await legacyDatabase(scope);try{value=await db.get(kind,uid);check()}finally{db.close()}}
  if(value===undefined)return undefined;const checked=validate(kind,value);if(checked.uid!==uid)throw Error('学习记录身份损坏');return checked
 }
 async function compare<K extends Kind>(kind:K,uid:string,before:Values[K]|undefined,value:Values[K]|null){
  check();if(value!==null){validate(kind,value);if(value.uid!==uid)throw Error('学习记录身份不匹配')}
  const expected=before===undefined?null:serialize(before),next=value===null?null:serialize(value)
  if(native){await invoke('compare',{kind,uid,expected,value:next});return}
  const db=await legacyDatabase(scope);try{check();const tx=db.transaction(kind,'readwrite');try{const current=await tx.store.get(uid);if((current===undefined?null:serialize(current))!==expected)throw Error('讨论或保存记录已在其他窗口修改，请重新加载');check();if(value===null)await tx.store.delete(uid);else await tx.store.put(JSON.parse(next!));await tx.done;check()}catch(error){try{tx.abort()}catch{}await tx.done.catch(()=>{});throw error}}finally{db.close()}
 }
 async function snapshot(){
  check();if(!native)return oldSnapshot() as Promise<{sessions:LearningSession[];operations:unknown[]}>
  const rows=await invoke<Row[]>('snapshot'),result:{sessions:LearningSession[];operations:unknown[]}={sessions:[],operations:[]}
  for(const row of rows){const value=JSON.parse(row.value);if(row.kind==='sessions')validate('sessions',value);if(value.uid!==row.uid)throw Error('学习记录身份损坏');(result[row.kind] as Array<LearningSession|LearningNoteOperation>).push(value)}return result
 }
 async function restore(sessions:LearningSession[],fresh=false){
  sessions.forEach(value=>validate('sessions',value));check()
  if(native){const restored=await invoke<number>('restore',{fresh,rows:sessions.map(value=>({kind:'sessions',uid:value.uid,value:serialize(value)}))});return{restored,skipped:sessions.length-restored}}
  const db=await legacyDatabase(scope);try{const tx=db.transaction(['sessions','operations'],'readwrite'),store=tx.objectStore('sessions');let restored=0;try{if(fresh){if(await store.count()||await tx.objectStore('operations').count())throw Error('学习恢复目标不是空空间')}for(const value of sessions){check();if(await store.get(value.uid))continue;await store.add(value);restored++}await tx.done;check();return{restored,skipped:sessions.length-restored}}catch(error){try{tx.abort()}catch{}await tx.done.catch(()=>{});throw error}}finally{db.close()}
 }
 async function reserve(value:LearningNoteOperation){const prior=await read('operations',value.uid);if(prior)return prior;try{await compare('operations',value.uid,undefined,value);return value}catch(error){const peer=await read('operations',value.uid);if(peer)return peer;throw error}}
 return{check,read,compare,snapshot,restore,reserve,async list(){if(!native)return(await snapshot()).sessions;return(await invoke<Row[]>('list')).map(row=>validate('sessions',JSON.parse(row.value)))},scope}
}
