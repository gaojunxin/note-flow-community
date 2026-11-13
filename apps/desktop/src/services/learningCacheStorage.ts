import {validateLearningCache,type LearningCache} from '@note-flow/core/ai-learning'
import {businessState,stagedBusinessState} from './businessState'
import {businessOwner} from './businessRecord'
import {aiDataScope} from './aiDataScope'

export interface LearningMirror {version:1;value:LearningCache|null;recovery:LearningCache|null}
export const emptyLearningCache=():LearningCache=>({sessions:[],selectedUid:'',input:'',draft:'',sources:[]})
const clone=<T>(value:T):T=>JSON.parse(JSON.stringify(value))
export function validateLearningMirror(value:unknown):LearningMirror{
 const state=value as LearningMirror
 if(!state||state.version!==1||state.value===undefined||state.recovery===undefined)throw Error('学习恢复档案格式无效，原始数据已保留')
 for(const cache of [state.value,state.recovery])if(cache!==null)validateLearningCache(cache)
 return state
}
/** 输入镜像与重载前副本作为一个聚合提交，保留发送/保存操作身份。
 * 调用方必须等待save完成再执行副作用；提交只表示本机持久化，不表示模型或服务端确认。
 */
export async function openLearningCache(legacyKey=`note-flow-ai-local:v1:${aiDataScope()}`){
 if(legacyKey!==`note-flow-ai-local:v1:${aiDataScope()}`)throw Error('学习档案不属于当前数据空间')
 const scope=aiDataScope(),owner=businessOwner(),port=businessState(owner)
 return loadLearningCache(legacyKey,port,()=>{port.check();if(aiDataScope()!==scope||businessOwner()!==owner)throw Error('账号或学习数据空间已切换，请重新打开讨论')})
}
/** 社区整库恢复先写入尚未发布的新空间，发布前仍受原空间身份/生命周期保护；调用方须验证目标为空。 */
export async function openStagedLearningCache(profileId:string,dataScope=`community-${profileId}`){
 if(!profileId||!(dataScope===`community-${profileId}`||dataScope.startsWith(`community-${profileId}:reset:`)))throw Error('恢复目标空间无效')
 const original=localStorage.getItem('note-flow-community-profile-v1'),sourceGeneration=localStorage.getItem(`note-flow-ai-data-generation:community-${original}`),generation=localStorage.getItem(`note-flow-ai-data-generation:${dataScope.split(':reset:')[0]}`)
 const port=stagedBusinessState(`community-${profileId}`,()=>{if(localStorage.getItem('note-flow-community-profile-v1')!==original||localStorage.getItem(`note-flow-ai-data-generation:community-${original}`)!==sourceGeneration||localStorage.getItem(`note-flow-ai-data-generation:${dataScope.split(':reset:')[0]}`)!==generation)throw Error('学习恢复期间空间已变化')})
 return loadLearningCache(`note-flow-ai-local:v1:${dataScope}`,port,port.check)
}
async function loadLearningCache(legacyKey:string,port:ReturnType<typeof businessState>,check:()=>void){
 const key='learning-cache:'+legacyKey
 check();let raw=await port.read(key);check()
 if(raw===null){
  const old=localStorage.getItem(legacyKey),recovery=localStorage.getItem(legacyKey+':recovery')
  if(old!==null||recovery!==null){
   const migrated:LearningMirror=validateLearningMirror({version:1,value:old===null?null:JSON.parse(old),recovery:recovery===null?null:JSON.parse(recovery)}),serialized=JSON.stringify(migrated)
   try{await port.write(key,null,serialized);raw=serialized}catch(error){const competing=await port.read(key);if(competing===null)throw error;raw=competing}check()
   // 两份旧源均验证后一次提交；只清理逐字匹配的已提交副本，不能顺带清理未知缓存。
   if(raw===serialized)for(const [source,value] of [[legacyKey,old],[legacyKey+':recovery',recovery]] as const)if(value!==null&&localStorage.getItem(source)===value)localStorage.removeItem(source)
  }
 }
 let state:LearningMirror=raw===null?{version:1,value:null,recovery:null}:validateLearningMirror(JSON.parse(raw))
 type Job={kind:'value'|'recovery'|'clear'|'restore';value?:LearningCache;recovery?:LearningCache|null;resolve:Array<()=>void>;reject:Array<(error:unknown)=>void>}
 const queue:Job[]=[];let running=false
 async function drain(){
  if(running)return;running=true
  try{while(queue.length){const job=queue.shift()!;try{
   check();let next=clone(state)
   if(job.kind==='clear')next={version:1,value:null,recovery:null}
   else if(job.kind==='value')next.value=job.value!
   else if(job.kind==='recovery')next.recovery=job.value!
   else {if(next.value===null)next.value=job.value||null;if(next.recovery===null)next.recovery=job.recovery||null}
   const serialized=JSON.stringify(validateLearningMirror(next));await port.write(key,raw,serialized);check();raw=serialized;state=next;job.resolve.forEach(done=>done())
  }catch(error){job.reject.forEach(fail=>fail(error));for(const pending of queue.splice(0))pending.reject.forEach(fail=>fail(error));break}}}finally{running=false}
 }
 function enqueue(kind:Job['kind'],value?:LearningCache,recovery?:LearningCache|null){
  check();const captured=value===undefined?undefined:clone(validateLearningCache(value)),copy=recovery?clone(validateLearningCache(recovery)):recovery
  return new Promise<void>((resolve,reject)=>{
   const pending=queue.at(-1)
   // 输入与流式内容可能连续变化，只合并尚未开始的相邻输入快照，恢复/清理屏障不能跨越。
   if(kind==='value'&&pending?.kind==='value'){pending.value=captured;pending.resolve.push(resolve);pending.reject.push(reject)}
   else queue.push({kind,value:captured,recovery:copy,resolve:[resolve],reject:[reject]})
   void drain()
  })
 }
 return {check,get value(){check();return clone(state.value)},get recovery(){check();return clone(state.recovery)},
  save:(value:LearningCache)=>enqueue('value',value),saveRecovery:(value:LearningCache)=>enqueue('recovery',value),
  clear:()=>enqueue('clear'),restoreMissing:(value:LearningCache|null,recovery:LearningCache|null)=>enqueue('restore',value||undefined,recovery)}
}

/** 整库备份恢复只补缺失内容，不恢复历史操作的执行资格。 */
export async function restoreMissingLearningMirrors(value:unknown){
 const source=validateLearningMirror(value),mirror=await openLearningCache()
 const safe=(cache:LearningCache|null)=>{if(!cache)return null;const copied=clone(cache);delete copied.pendingSend;delete copied.operation;return copied}
 await mirror.restoreMissing(safe(source.value),safe(source.recovery))
}
