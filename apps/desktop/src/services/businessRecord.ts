import {businessState} from './businessState'
import {readAccountSetting} from './accountStorage'
export const businessOwner=()=>String(JSON.parse(readAccountSetting('note-flow-pc-user')||'null')?.userId||'local')

export type BusinessRecordDomain='notifications'|'knowledge'|'folder-transfer'|'focus-checkpoint'|'task-lists'|'library-cache'
/** 加载或迁移一个JSON聚合；校验失败保留源值。save完成只代表本机提交，null为防止旧副本复活的墓碑。
 * 调用方提供额外世代守卫，不能在持有同库写租约时等待该端口，也不能把本机提交当作远端确认。
 */
export async function businessRecord<T>(namespace:BusinessRecordDomain,legacyKey:string,validate:(value:unknown)=>T,owner=businessOwner(),guard:()=>void=()=>{}){
 const port=businessState(owner),key=namespace+':'+legacyKey
 const check=()=>{port.check();guard()}
 check();let raw=await port.read(key);check()
 if(raw===null){const old=localStorage.getItem(legacyKey)
  if(old!==null){validate(JSON.parse(old));try{await port.write(key,null,old);raw=old}catch(error){const competing=await port.read(key);if(competing===null)throw error;raw=competing}check();if(raw===old&&localStorage.getItem(legacyKey)===old)localStorage.removeItem(legacyKey)}
 }
 let value=raw===null||raw==='null'?null:validate(JSON.parse(raw))
 let tail=Promise.resolve()
 return {
  get value(){return value},check,
  async save(next:T|null){const serialized=JSON.stringify(next);if(next!==null)validate(JSON.parse(serialized));const work=tail.catch(()=>{}).then(async()=>{check();await port.write(key,raw,serialized);check();raw=serialized;value=next});tail=work;await work},
 }
}
