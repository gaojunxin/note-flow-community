import {businessRecord,businessOwner} from './businessRecord'
import {validateFocusCheckpoint,type FocusCheckpoint} from './focusClock'
import {focusReadBinding} from './focusRecordSource'
const preparations=new Map<string,Promise<void>>()
const records=new Map<string,{binding:string;record:Awaited<ReturnType<typeof businessRecord<FocusCheckpoint>>>}>()
/** 恢复点每秒独立提交，关闭时不依赖pagehide异步写入一定完成；重开总以暂停状态恢复。 */
export const focusCheckpointStorage={
 async prepare(key:string){
  const binding=focusReadBinding(),existing=records.get(key);if(existing?.binding===binding){existing.record.check();return}
  const identity=JSON.stringify([key,binding]);let flight=preparations.get(identity)
  if(!flight){const guard=()=>{if(binding!==focusReadBinding())throw Error('专注空间已切换')};flight=(async()=>{const record=await businessRecord('focus-checkpoint',key,validateFocusCheckpoint,businessOwner(),guard);guard();records.set(key,{binding,record})})().finally(()=>preparations.delete(identity));preparations.set(identity,flight)}
  await flight
 },
 getItem(key:string){const state=records.get(key);if(!state||state.binding!==focusReadBinding())throw Error('专注检查点尚未加载');state.record.check();return state.record.value?JSON.stringify(state.record.value):null},
 async setItem(key:string,value:string){const state=records.get(key);if(!state||state.binding!==focusReadBinding())throw Error('专注空间已切换');state.record.check();await state.record.save(validateFocusCheckpoint(JSON.parse(value)))},
 async removeItem(key:string){const state=records.get(key);if(!state||state.binding!==focusReadBinding())throw Error('专注空间已切换');await state.record.save(null)},
}
